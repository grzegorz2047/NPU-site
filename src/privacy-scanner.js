const TYPES={
apiKey:{pl:'Klucz API / token',en:'API key / token',risk:'critical',mask:'[API_KEY]'},
pesel:{pl:'PESEL',en:'Polish national ID',risk:'critical',mask:'[PESEL]'},
card:{pl:'Karta płatnicza',en:'Payment card',risk:'critical',mask:'[CARD]'},
iban:{pl:'Numer rachunku / IBAN',en:'Bank account / IBAN',risk:'high',mask:'[IBAN]'},
email:{pl:'Adres e-mail',en:'Email address',risk:'medium',mask:'[EMAIL]'},
phone:{pl:'Numer telefonu',en:'Phone number',risk:'medium',mask:'[PHONE]'},
ip:{pl:'Adres IPv4',en:'IPv4 address',risk:'medium',mask:'[IP]'}
};
export function validatePesel(value){const digits=value.replace(/\D/g,'');if(!/^\d{11}$/.test(digits))return false;const w=[1,3,7,9,1,3,7,9,1,3];const check=(10-w.reduce((sum,n,i)=>sum+n*Number(digits[i]),0)%10)%10;return check===Number(digits[10])}
export function validateLuhn(value){const digits=value.replace(/\D/g,'');if(!/^\d{13,19}$/.test(digits))return false;let sum=0,alt=false;for(let i=digits.length-1;i>=0;i--){let n=Number(digits[i]);if(alt){n*=2;if(n>9)n-=9}sum+=n;alt=!alt}return sum%10===0}
export function validateIban(value){const iban=value.replace(/\s/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban))return false;const moved=iban.slice(4)+iban.slice(0,4);let remainder=0;for(const ch of moved){const expanded=/\d/.test(ch)?ch:String(ch.charCodeAt(0)-55);for(const digit of expanded)remainder=(remainder*10+Number(digit))%97}return remainder===1}
function lineColumn(text,index){const before=text.slice(0,index),lines=before.split('\n');return{line:lines.length,column:lines.at(-1).length+1}}
function collect(text,regex,type,validate=()=>true){const out=[];regex.lastIndex=0;for(const match of text.matchAll(regex)){const value=match[0];if(!validate(value))continue;const location=lineColumn(text,match.index);out.push({type,value,start:match.index,end:match.index+value.length,...location,...TYPES[type]})}return out}
function validIp(value){return value.split('.').every(part=>Number(part)>=0&&Number(part)<=255)}
export function scanSensitiveData(text){const input=String(text??'');const candidates=[
...collect(input,/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,'apiKey'),
...collect(input,/\b\d{11}\b/g,'pesel',validatePesel),
...collect(input,/\b(?:[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9][ ]?){11,30})\b/g,'iban',validateIban),
...collect(input,/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,'card',validateLuhn),
...collect(input,/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'email'),
...collect(input,/(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.])/g,'ip',validIp),
...collect(input,/(?<!\w)(?:\+?48[ -]?)?(?:\d{3}[ -]?\d{3}[ -]?\d{3})(?!\w)/g,'phone',value=>value.replace(/\D/g,'').length>=9)
].sort((a,b)=>a.start-b.start||b.end-a.end);
const accepted=[];for(const item of candidates){if(accepted.some(other=>item.start<other.end&&item.end>other.start))continue;accepted.push(item)}return accepted}
export function redactSensitiveData(text,findings=scanSensitiveData(text)){let output=String(text??'');for(const finding of [...findings].sort((a,b)=>b.start-a.start))output=output.slice(0,finding.start)+finding.mask+output.slice(finding.end);return output}
export function summarizeFindings(findings){return findings.reduce((summary,item)=>{summary[item.type]=(summary[item.type]||0)+1;return summary},{})}
export function typeLabel(type,lang='pl'){return TYPES[type]?.[lang]||type}
