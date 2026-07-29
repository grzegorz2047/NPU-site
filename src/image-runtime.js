import{MODEL_ID,MODEL_SIZE,MODEL_VARIANTS,backendCandidates,runtimeKind,transformerLoadOptions,tensorToMask}from'./image-core.js';

const TRANSFORMERS_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
const modelBytes=new Map();

function errorMessage(error){return error instanceof Error?error.message:String(error)}

async function fetchModel(url,onProgress=()=>{}){
 if(modelBytes.has(url))return modelBytes.get(url).slice();
 const response=await fetch(url,{cache:'force-cache'});
 if(!response.ok)throw Error(`Model HTTP ${response.status}`);
 const total=Number(response.headers.get('content-length'))||0;
 if(!response.body){
  const bytes=new Uint8Array(await response.arrayBuffer());
  modelBytes.set(url,bytes);
  onProgress({stage:'model',loaded:bytes.byteLength,total:bytes.byteLength,progress:100});
  return bytes.slice();
 }
 const reader=response.body.getReader(),chunks=[];let loaded=0;
 for(;;){const{done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.byteLength;onProgress({stage:'model',loaded,total,progress:total?loaded/total*100:null})}
 const bytes=new Uint8Array(loaded);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 modelBytes.set(url,bytes);
 onProgress({stage:'model',loaded,total:total||loaded,progress:100});
 return bytes.slice();
}

function normalizeProgress(event={}){
 const loaded=Number(event.loaded)||0,total=Number(event.total)||0;
 const progress=Number.isFinite(Number(event.progress))?Number(event.progress):total?loaded/total*100:null;
 return{stage:event.status||event.stage||'model',file:event.file||event.name||'',loaded,total,progress};
}

export class PortraitEngine{
 constructor({status=()=>{},progress=()=>{}}={}){this.status=status;this.progress=progress;this.backend=null;this.preference=null;this.runtime=null;this.runtimeLabel='';this.session=null;this.model=null;this.processor=null;this.RawImage=null}
 capabilities(){return{webnn:Boolean(navigator.ml?.createContext),webgpu:Boolean(navigator.gpu),wasm:Boolean(globalThis.WebAssembly)}}
 async disposeCurrent(){
  try{if(this.session?.release)await this.session.release()}catch{}
  try{if(this.model?.dispose)await this.model.dispose()}catch{}
  this.session=null;this.model=null;this.processor=null;this.RawImage=null;this.backend=null;this.runtime=null;this.runtimeLabel='';
 }
 async dispose(){await this.disposeCurrent();this.preference=null}
 async initialize(preference='auto'){
  if(this.backend&&this.preference===preference)return this.backend;
  await this.dispose();
  const candidates=backendCandidates(preference,this.capabilities());
  if(!candidates.length)throw Error('Wybrany akcelerator nie jest dostępny w tej przeglądarce.');
  const errors=[];
  for(const backend of candidates){
   try{
    const variant=MODEL_VARIANTS[backend];
    this.status(`Ładowanie ${variant.label} · ${variant.download}`);
    if(runtimeKind(backend)==='direct-webnn')await this.initializeNpu(variant);
    else await this.initializeTransformers(backend);
    this.backend=backend;this.preference=preference;this.runtime=runtimeKind(backend);this.runtimeLabel=this.runtime==='direct-webnn'?'WebNN direct':'Transformers.js';
    return backend;
   }catch(error){errors.push(`${backend}: ${errorMessage(error)}`);await this.disposeCurrent()}
  }
  throw Error(errors.join(' | '));
 }
 async initializeNpu(variant){
  if(!globalThis.ort)throw Error('ONNX Runtime Web nie został załadowany.');
  const bytes=await fetchModel(variant.url,event=>this.progress(event));
  this.status('Tworzenie sesji NPU / WebNN…');
  this.session=await ort.InferenceSession.create(bytes,{executionProviders:[{name:'webnn',deviceType:'npu',powerPreference:'low-power'}],graphOptimizationLevel:'all',freeDimensionOverrides:{batch_size:1,num_channels:3,height:MODEL_SIZE,width:MODEL_SIZE}});
 }
 async initializeTransformers(backend){
  const{AutoModel,AutoProcessor,RawImage,env}=await import(TRANSFORMERS_URL);
  if(env.backends?.onnx?.wasm){env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false}
  const progress_callback=event=>this.progress(normalizeProgress(event));
  const options={...transformerLoadOptions(backend),progress_callback};
  this.status(`Tworzenie runtime ${backend==='webgpu'?'WebGPU':'CPU / WASM'} przez Transformers.js…`);
  this.model=await AutoModel.from_pretrained(MODEL_ID,options);
  this.processor=await AutoProcessor.from_pretrained(MODEL_ID,{progress_callback});
  this.RawImage=RawImage;
 }
 async run({nchw,source}){
  if(this.runtime==='direct-webnn'){
   if(!nchw)throw Error('Brak wejścia NCHW dla NPU.');
   const tensor=new ort.Tensor('float32',nchw,[1,3,MODEL_SIZE,MODEL_SIZE]);
   const outputs=await this.session.run({[this.session.inputNames[0]]:tensor});
   return tensorToMask(outputs[this.session.outputNames[0]]||Object.values(outputs)[0]);
  }
  if(!this.model||!this.processor||!this.RawImage)throw Error('Runtime Transformers.js nie został zainicjalizowany.');
  const image=await this.RawImage.read(source);
  const{pixel_values}=await this.processor(image);
  const outputs=await this.model({input:pixel_values});
  const output=outputs.output||Object.values(outputs).find(value=>value?.data&&value?.dims);
  return tensorToMask(output);
 }
}
