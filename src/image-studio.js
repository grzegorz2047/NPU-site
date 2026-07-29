import{MODEL_SIZE,rgbaToNchw,applyMaskAlpha,scaledDimensions,outputFilename,clamp}from'./image-core.js';
import{PortraitEngine}from'./image-runtime.js';

const $=selector=>document.querySelector(selector);
const EXAMPLE_URL='https://images.pexels.com/photos/5965592/pexels-photo-5965592.jpeg?auto=compress&cs=tinysrgb&w=1200';
const LANG_KEY='locallab-language',BACKEND_KEY='portraitlab-backend';
const copy={
 pl:{none:'Nie wybrano zdjęcia.',initial:'Dodaj zdjęcie, aby rozpocząć.',run:'Wytnij osobę',running:'Analiza portretu…',ready:'Gotowe',fileTooLarge:'Plik przekracza limit 20 MB.',badFile:'Wybierz plik JPG, PNG albo WebP.',downloaded:'Plik został przygotowany.',loadingExample:'Pobieranie zdjęcia przykładowego…',exampleCredit:'Przykład z Pexels',backendNpu:'Tylko NPU',backendAuto:'NPU → GPU → CPU',backendGpu:'GPU',backendCpu:'CPU'},
 en:{none:'No photo selected.',initial:'Add a photo to begin.',run:'Cut out person',running:'Analyzing portrait…',ready:'Done',fileTooLarge:'The file exceeds the 20 MB limit.',badFile:'Choose a JPG, PNG or WebP file.',downloaded:'The file is ready.',loadingExample:'Downloading example photo…',exampleCredit:'Example from Pexels',backendNpu:'NPU only',backendAuto:'NPU → GPU → CPU',backendGpu:'GPU',backendCpu:'CPU'}
};

let lang=(localStorage.getItem(LANG_KEY)||navigator.language||'pl').toLowerCase().startsWith('pl')?'pl':'en';
let bitmap=null,sourceName='portrait',sourcePixels=null,maskSmall=null,maskFull=null,renderFrame=0;
const before=$('#before'),after=$('#after');
const beforeContext=before.getContext('2d',{willReadFrequently:true}),afterContext=after.getContext('2d');
const maskCanvas=document.createElement('canvas'),maskFullCanvas=document.createElement('canvas'),foregroundCanvas=document.createElement('canvas');
maskCanvas.width=maskCanvas.height=MODEL_SIZE;

function t(){return copy[lang]}
function setStatus(message){$('#status').textContent=message||''}
function showProgress(show){$('#model-progress').hidden=!show;if(!show){$('#progress').value=0;$('#progress-value').textContent='0%'}}
function updateProgress(event={}){
 showProgress(true);
 const percent=Number.isFinite(Number(event.progress))?Math.max(0,Math.min(100,Number(event.progress))):event.total?Math.max(0,Math.min(100,event.loaded/event.total*100)):null;
 if(percent==null){$('#progress').removeAttribute('value');$('#progress-value').textContent='…'}else{$('#progress').value=percent;$('#progress-value').textContent=`${Math.round(percent)}%`}
 $('#progress-label').textContent=event.file||event.stage||'Model';
}

const engine=new PortraitEngine({status:setStatus,progress:updateProgress});

function applyLanguage(next){
 lang=next==='en'?'en':'pl';localStorage.setItem(LANG_KEY,lang);document.documentElement.lang=lang;$('#language').value=lang;
 const options=$('#backend').options,c=t();options[0].textContent=c.backendNpu;options[1].textContent=c.backendAuto;options[2].textContent=c.backendGpu;options[3].textContent=c.backendCpu;
 document.title=lang==='pl'?'PortraitLab NPU — lokalne studio obrazu':'PortraitLab NPU — local image studio';
 if(!bitmap){$('#file-meta').textContent=c.none;setStatus(c.initial)}
}
function setCanvasSize(width,height){for(const canvas of[before,after,maskFullCanvas,foregroundCanvas]){canvas.width=width;canvas.height=height}}
async function loadBlob(blob,name='portrait.jpg'){
 if(blob.size>20*1024*1024)throw Error(t().fileTooLarge);
 if(!/^image\/(jpeg|png|webp)$/i.test(blob.type))throw Error(t().badFile);
 bitmap?.close?.();bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});sourceName=name;
 const size=scaledDimensions(bitmap.width,bitmap.height);setCanvasSize(size.width,size.height);
 beforeContext.clearRect(0,0,before.width,before.height);beforeContext.drawImage(bitmap,0,0,before.width,before.height);sourcePixels=beforeContext.getImageData(0,0,before.width,before.height);
 maskSmall=null;maskFull=null;afterContext.clearRect(0,0,after.width,after.height);$('#before-empty').hidden=true;$('#after-empty').hidden=false;$('#run').disabled=false;setResultEnabled(false);
 $('#file-meta').textContent=`${name} · ${bitmap.width}×${bitmap.height} · ${(blob.size/1024/1024).toFixed(1)} MB`;setStatus(t().run);scrollPreview();
}
function setResultEnabled(enabled){$('#mode-field').disabled=!enabled;$('#download-png').disabled=!enabled;$('#download-jpg').disabled=!enabled;$('#reset').disabled=!enabled;$('#after-empty').hidden=enabled}
function buildModelInput(){const canvas=document.createElement('canvas');canvas.width=canvas.height=MODEL_SIZE;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,MODEL_SIZE,MODEL_SIZE);return rgbaToNchw(context.getImageData(0,0,MODEL_SIZE,MODEL_SIZE).data,MODEL_SIZE,MODEL_SIZE)}
function buildFullMask(){
 const contextSmall=maskCanvas.getContext('2d'),image=contextSmall.createImageData(MODEL_SIZE,MODEL_SIZE);
 for(let index=0;index<MODEL_SIZE*MODEL_SIZE;index++){const value=Math.round(clamp(maskSmall[index])*255),offset=index*4;image.data[offset]=image.data[offset+1]=image.data[offset+2]=value;image.data[offset+3]=255}
 contextSmall.putImageData(image,0,0);
 const context=maskFullCanvas.getContext('2d',{willReadFrequently:true});context.clearRect(0,0,maskFullCanvas.width,maskFullCanvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(maskCanvas,0,0,maskFullCanvas.width,maskFullCanvas.height);
 const data=context.getImageData(0,0,maskFullCanvas.width,maskFullCanvas.height).data;maskFull=new Float32Array(maskFullCanvas.width*maskFullCanvas.height);for(let index=0;index<maskFull.length;index++)maskFull[index]=data[index*4]/255;
}
async function runModel(){
 if(!bitmap)return;$('#run').disabled=true;showProgress(true);
 try{
  const backend=await engine.initialize($('#backend').value);$('#hardware').textContent=backend==='npu'?'NPU / WebNN':backend==='webgpu'?'GPU / Transformers.js':'CPU / Transformers.js';setStatus(t().running);
  const started=performance.now();maskSmall=await engine.run({nchw:backend==='npu'?buildModelInput():null,source:before});buildFullMask();setResultEnabled(true);renderOutput();showProgress(false);
  setStatus(`${t().ready} · ${Math.round(performance.now()-started)} ms · ${backend.toUpperCase()} · ${engine.runtimeLabel}`);
 }catch(error){showProgress(false);const selected=$('#backend').value.toUpperCase();setStatus(`${selected}: ${error instanceof Error?error.message:String(error)}`)}finally{$('#run').disabled=false}
}
function currentMode(){return(document.querySelector('input[name="mode"]:checked')||{}).value||'transparent'}
function renderOutput(){
 if(!sourcePixels||!maskFull)return;
 const threshold=Number($('#threshold').value)/100,softness=Number($('#softness').value)/100,foreground=applyMaskAlpha(sourcePixels.data,maskFull,{threshold,softness}),foregroundContext=foregroundCanvas.getContext('2d');
 foregroundContext.putImageData(new ImageData(foreground,foregroundCanvas.width,foregroundCanvas.height),0,0);afterContext.clearRect(0,0,after.width,after.height);
 const mode=currentMode();if(mode==='color'){afterContext.fillStyle=$('#color').value;afterContext.fillRect(0,0,after.width,after.height)}else if(mode==='blur'){const blur=Number($('#blur').value);afterContext.save();afterContext.filter=`blur(${blur}px)`;const pad=blur*2;afterContext.drawImage(before,-pad,-pad,after.width+pad*2,after.height+pad*2);afterContext.restore()}else if(mode==='original')afterContext.drawImage(before,0,0);afterContext.drawImage(foregroundCanvas,0,0);
}
function scheduleRender(){cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(renderOutput)}
function resetSettings(){document.querySelector('input[name="mode"][value="transparent"]').checked=true;$('#color').value='#f2f4f7';$('#blur').value=18;$('#threshold').value=50;$('#softness').value=18;updateOutputs();renderOutput()}
function updateOutputs(){$('#blur-value').value=`${$('#blur').value} px`;$('#threshold-value').value=`${$('#threshold').value}%`;$('#softness-value').value=`${$('#softness').value}%`}
function scrollPreview(){if(matchMedia('(max-width: 980px)').matches)$('.preview-panel').scrollIntoView({behavior:'smooth',block:'start'})}
async function loadExample(){try{setStatus(t().loadingExample);const response=await fetch(EXAMPLE_URL,{mode:'cors',cache:'force-cache'});if(!response.ok)throw Error(`Example HTTP ${response.status}`);await loadBlob(await response.blob(),lang==='pl'?'przyklad-portretu.jpg':'example-portrait.jpg');$('#file-meta').textContent+=` · ${t().exampleCredit}`;await runModel()}catch(error){setStatus(error instanceof Error?error.message:String(error))}}
function download(type){const transparent=currentMode()==='transparent',canvas=document.createElement('canvas');canvas.width=after.width;canvas.height=after.height;const context=canvas.getContext('2d');if(type==='jpeg'&&transparent){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height)}context.drawImage(after,0,0);canvas.toBlob(blob=>{if(!blob)return;const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=outputFilename(sourceName,type==='jpeg'?'jpg':'png');link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);setStatus(t().downloaded)},type==='jpeg'?'image/jpeg':'image/png',.92)}

const caps=engine.capabilities();$('#hardware').textContent=caps.webnn?'WebNN available':caps.webgpu?'WebGPU available':'CPU / WASM';
$('#backend').value=['npu','auto','gpu','cpu'].includes(localStorage.getItem(BACKEND_KEY))?localStorage.getItem(BACKEND_KEY):'auto';
$('#language').onchange=event=>applyLanguage(event.target.value);$('#pick-hero').onclick=()=>$('#file').click();
$('#file').onchange=event=>event.target.files[0]&&loadBlob(event.target.files[0],event.target.files[0].name).catch(error=>setStatus(error.message));
$('#drop').ondragover=event=>{event.preventDefault();$('#drop').classList.add('dragging')};$('#drop').ondragleave=()=>$('#drop').classList.remove('dragging');$('#drop').ondrop=event=>{event.preventDefault();$('#drop').classList.remove('dragging');const file=event.dataTransfer.files[0];if(file)loadBlob(file,file.name).catch(error=>setStatus(error.message))};
$('#backend').onchange=async event=>{localStorage.setItem(BACKEND_KEY,event.target.value);await engine.dispose();if(bitmap)setStatus(t().run)};$('#run').onclick=runModel;$('#example').onclick=loadExample;$('#example-inline').onclick=loadExample;
document.querySelectorAll('input[name="mode"],#color,#blur,#threshold,#softness').forEach(control=>control.oninput=()=>{updateOutputs();scheduleRender()});$('#reset').onclick=resetSettings;$('#download-png').onclick=()=>download('png');$('#download-jpg').onclick=()=>download('jpeg');
updateOutputs();applyLanguage(lang);if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});
