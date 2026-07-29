import{MODEL_CONFIGS,normalizeVector}from'./search-core.js';
const TF='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
export class EmbeddingEngine{
 constructor(status=()=>{}){this.status=status;this.session=null;this.tokenizer=null;this.backend=null;this.modelKey=null}
 capabilities(){return{secure:isSecureContext,webnn:Boolean(navigator.ml?.createContext),webgpu:Boolean(navigator.gpu),wasm:Boolean(WebAssembly)}}
 async initialize(modelKey='multilingual',preference='auto'){
  const cfg=MODEL_CONFIGS[modelKey];if(!globalThis.ort)throw Error('ONNX Runtime Web nie został załadowany.');
  this.status('Pobieranie tokenizera i modelu…');const{AutoTokenizer}=await import(TF);this.tokenizer=await AutoTokenizer.from_pretrained(cfg.modelId);
  const candidates=preference==='npu'?['npu']:preference==='gpu'?['webgpu']:preference==='cpu'?['wasm']:[...(navigator.ml?.createContext?['npu']:[]),...(navigator.gpu?['webgpu']:[]),'wasm'];
  const errors=[];for(const backend of candidates){try{this.status(`Uruchamianie przez ${backend.toUpperCase()}…`);const providers=backend==='npu'?[{name:'webnn',deviceType:'npu',powerPreference:'low-power'},'wasm']:backend==='webgpu'?['webgpu','wasm']:['wasm'];this.session=await ort.InferenceSession.create(cfg.modelUrl,{executionProviders:providers,graphOptimizationLevel:'all'});this.backend=backend;this.modelKey=modelKey;return backend}catch(e){errors.push(`${backend}: ${e.message}`)}}throw Error(errors.join(' | '))
 }
 async embed(texts,kind='passage'){
  const cfg=MODEL_CONFIGS[this.modelKey],list=(Array.isArray(texts)?texts:[texts]).map(t=>(kind==='query'?cfg.queryPrefix:cfg.passagePrefix)+t);const encoded=await this.tokenizer(list,{padding:true,truncation:true,max_length:cfg.maxLength});const feeds={};for(const name of this.session.inputNames){const t=encoded[name];if(t)feeds[name]=new ort.Tensor('int64',t.data instanceof BigInt64Array?t.data:BigInt64Array.from(t.data,v=>BigInt(v)),t.dims)}const outputs=await this.session.run(feeds);const out=Object.values(outputs).find(t=>t.dims.length===2)||Object.values(outputs).find(t=>t.dims.length===3)||Object.values(outputs)[0];if(out.dims.length===2){const[b,d]=out.dims;return Array.from({length:b},(_,i)=>normalizeVector(out.data.slice(i*d,(i+1)*d)))}const[b,s,d]=out.dims,mask=encoded.attention_mask?.data,result=[];for(let row=0;row<b;row++){const v=new Float32Array(d);let n=0;for(let token=0;token<s;token++){if(mask&&!Number(mask[row*s+token]))continue;n++;const o=(row*s+token)*d;for(let i=0;i<d;i++)v[i]+=Number(out.data[o+i])}for(let i=0;i<d;i++)v[i]/=n||1;result.push(normalizeVector(v))}return result
 }
}
