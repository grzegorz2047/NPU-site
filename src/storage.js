const DB='localfind-npu';
let opened;
function db(){if(opened)return opened;opened=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('documents'))d.createObjectStore('documents',{keyPath:'id'});if(!d.objectStoreNames.contains('chunks')){const s=d.createObjectStore('chunks',{keyPath:'id'});s.createIndex('docId','docId');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return opened}
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const done=t=>new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
export async function saveDocument(document,chunks){const d=await db(),t=d.transaction(['documents','chunks'],'readwrite');t.objectStore('documents').put(document);for(const c of chunks)t.objectStore('chunks').put(c);await done(t)}
export async function listDocuments(){const d=await db();return req(d.transaction('documents').objectStore('documents').getAll())}
export async function listChunks(){const d=await db();return req(d.transaction('chunks').objectStore('chunks').getAll())}
export async function removeDocument(id){const d=await db(),t=d.transaction(['documents','chunks'],'readwrite');t.objectStore('documents').delete(id);const r=t.objectStore('chunks').index('docId').openCursor(IDBKeyRange.only(id));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue()}};await done(t)}
export async function clearAll(){const d=await db(),t=d.transaction(['documents','chunks'],'readwrite');t.objectStore('documents').clear();t.objectStore('chunks').clear();await done(t)}
