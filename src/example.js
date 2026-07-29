import{chunkText,escapeHtml}from'./search-core.js';import{reviewContract,contractSummary}from'./contract-review.js';import{detectLanguage,setLanguage}from'./i18n.js';
const $=s=>document.querySelector(s);const texts={pl:{title:'Przykład: ryzykowna umowa abonamentowa',intro:'Dokument zawiera osiem celowo dodanych zapisów. Uruchom analizę i sprawdź, czy każdy został odnaleziony wraz ze źródłem.',doc:'Dokument testowy',test:'Test działania',run:'Uruchom prawdziwą analizę',method:'Co jest naprawdę testowane?',methodCopy:'Strona dzieli dokument na fragmenty i uruchamia tę samą checklistę co główna aplikacja. Każdy oczekiwany obszar musi mieć status „znaleziono” i fragment źródłowy.',pass:'TEST ZALICZONY',fail:'TEST NIEZALICZONY',source:'Fragment źródłowy'},en:{title:'Example: risky subscription agreement',intro:'The document contains eight intentionally added clauses. Run the analysis and verify that each one is found with a source passage.',doc:'Test document',test:'Functional test',run:'Run real analysis',method:'What is actually tested?',methodCopy:'The page chunks the document and runs the same checklist as the main app. Every expected area must have a found status and a source passage.',pass:'TEST PASSED',fail:'TEST FAILED',source:'Source passage'}};
const contracts={pl:`UMOWA ABONAMENTOWA
1. Umowa zostaje zawarta na 12 miesięcy i automatycznie przedłuża się na kolejny okres 12 miesięcy, jeżeli klient nie złoży wypowiedzenia.

2. Wypowiedzenie wymaga formy pisemnej i trzymiesięcznego okresu wypowiedzenia.

3. Miesięczna opłata wynosi 129 zł. Usługodawca może raz w roku podwyższyć cenę zgodnie z inflacją.

4. Za rozwiązanie umowy przed końcem okresu klient zapłaci karę umowną 600 zł.

5. Usługodawca nie odpowiada za utracone korzyści, a jego odpowiedzialność jest ograniczona do trzech miesięcznych opłat.

6. Klient musi zgłosić zmianę adresu w terminie 7 dni.

7. Dane osobowe są przetwarzane w celu realizacji umowy; zgoda marketingowa jest dobrowolna.

8. Spory rozstrzyga sąd właściwy dla siedziby usługodawcy, a prawem właściwym jest prawo polskie.`,en:`SUBSCRIPTION AGREEMENT
1. This agreement is for 12 months and automatically renews for another 12-month period unless the customer gives notice.

2. Termination requires written notice and a three-month notice period.

3. The monthly fee is $39. The provider may increase the price once per year based on inflation.

4. Early termination triggers a contractual penalty of $200.

5. The provider is not liable for lost profits and limits liability to three monthly fees.

6. The customer must notify an address change within 7 days.

7. Personal data is processed to perform the agreement; marketing consent is optional.

8. Disputes are subject to the courts at the provider's registered office and the governing law is Polish law.`};
let lang=setLanguage(detectLanguage());function apply(next){lang=setLanguage(next);$('#language').value=lang;const t=texts[lang];$('#example-title').textContent=t.title;$('#example-intro').textContent=t.intro;$('#document-title').textContent=t.doc;$('#test-title').textContent=t.test;$('#run-example').textContent=t.run;$('#method-title').textContent=t.method;$('#method-copy').textContent=t.methodCopy;$('#contract-text').textContent=contracts[lang];$('#example-results').innerHTML='';$('#example-results').classList.add('empty');$('#verification').hidden=true}
function run(){const t=texts[lang],chunks=chunkText(contracts[lang],{maxChars:260,overlapChars:30}).map((text,i)=>({id:String(i),docName:t.doc,chunkIndex:i,text,vector:null}));const results=reviewContract(chunks,lang),summary=contractSummary(results),valid=summary.found===results.length&&results.every(r=>r.findings.length>0);$('#verification').hidden=false;$('#verification').className=`verification ${valid?'pass':'fail'}`;$('#verification').innerHTML=`<b>${valid?t.pass:t.fail}</b><span>${summary.found}/${summary.total}</span>`;$('#example-results').classList.remove('empty');$('#example-results').innerHTML=results.map(r=>`<article class="check ${r.status}"><header><div><small>${r.status}</small><h3>${escapeHtml(r.check.title)}</h3></div><span>${r.status==='found'?'✓':'×'}</span></header><p>${escapeHtml(r.check.why)}</p>${r.findings.map(f=>`<blockquote><b>${t.source}</b><p>${escapeHtml(f.text)}</p></blockquote>`).join('')}</article>`).join('')}
$('#language').onchange=e=>apply(e.target.value);$('#run-example').onclick=run;apply(lang);
