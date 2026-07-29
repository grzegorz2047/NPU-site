export const MODEL_SIZE=256;
export const MODEL_ID='onnx-community/modnet-webnn';
const FULL_MODEL='https://huggingface.co/onnx-community/modnet-webnn/resolve/main/onnx/model.onnx';
export const MODEL_VARIANTS=Object.freeze({
 npu:{url:FULL_MODEL,label:'MODNet FP32 · WebNN direct',download:'25.9 MB'},
 webgpu:{label:'MODNet FP32 · Transformers.js',download:'25.9 MB'},
 wasm:{label:'MODNet Q8 · Transformers.js',download:'6.6 MB'}
});
export function clamp(value,min=0,max=1){return Math.min(max,Math.max(min,Number(value)||0))}
export function alphaFromMask(value,threshold=.5,softness=.18){const mask=clamp(value),edge=clamp(threshold),width=Math.max(.005,clamp(softness,.005,.5)),low=edge-width,high=edge+width;if(mask<=low)return 0;if(mask>=high)return 1;const t=(mask-low)/(high-low);return t*t*(3-2*t)}
export function rgbaToNchw(data,width,height){if(!data||data.length!==width*height*4)throw Error('Nieprawidłowe dane obrazu.');const pixels=width*height,output=new Float32Array(pixels*3);for(let i=0;i<pixels;i++){output[i]=data[i*4]/127.5-1;output[pixels+i]=data[i*4+1]/127.5-1;output[pixels*2+i]=data[i*4+2]/127.5-1}return output}
export function parseHexColor(value){const match=/^#([0-9a-f]{6})$/i.exec(String(value||''));if(!match)return[255,255,255];const number=parseInt(match[1],16);return[(number>>16)&255,(number>>8)&255,number&255]}
export function applyMaskAlpha(rgba,mask,{threshold=.5,softness=.18}={}){if(!rgba||!mask||rgba.length/4!==mask.length)throw Error('Maska i obraz mają różne rozmiary.');const output=new Uint8ClampedArray(rgba);for(let i=0;i<mask.length;i++)output[i*4+3]=Math.round((rgba[i*4+3]/255)*alphaFromMask(mask[i],threshold,softness)*255);return output}
export function backendCandidates(preference,{webnn=false,webgpu=false,wasm=true}={}){if(preference==='npu')return webnn?['npu']:[];if(preference==='gpu')return webgpu?['webgpu']:[];if(preference==='cpu')return wasm?['wasm']:[];return[...(webnn?['npu']:[]),...(webgpu?['webgpu']:[]),...(wasm?['wasm']:[])]}
export function runtimeKind(backend){return backend==='npu'?'direct-webnn':'transformers-js'}
export function transformerLoadOptions(backend){if(backend==='webgpu')return{device:'webgpu',dtype:'fp32'};if(backend==='wasm')return{dtype:'q8'};throw Error(`Brak konfiguracji Transformers.js dla ${backend}.`)}
export function tensorToMask(tensor,expectedPixels=MODEL_SIZE*MODEL_SIZE){const data=tensor?.data??tensor;if(!data||typeof data.length!=='number')throw Error('Model nie zwrócił prawidłowej maski.');if(data.length<expectedPixels)throw Error(`Maska ma ${data.length} wartości, oczekiwano ${expectedPixels}.`);const start=data.length-expectedPixels,output=new Float32Array(expectedPixels);for(let i=0;i<expectedPixels;i++)output[i]=clamp(Number(data[start+i]));return output}
export function scaledDimensions(width,height,maxSide=1600){const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1),scale=Math.min(1,maxSide/Math.max(w,h));return{width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale)),scale}}
export function outputFilename(sourceName='portrait',extension='png'){const base=String(sourceName).replace(/\.[^.]+$/,'').replace(/[^a-z0-9ąćęłńóśźż_-]+/gi,'-').replace(/^-+|-+$/g,'')||'portrait';return`${base}-locallab.${extension}`}
