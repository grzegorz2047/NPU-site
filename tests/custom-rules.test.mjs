import test from'node:test';
import assert from'node:assert/strict';
import{validateCustomRule,scanCustomRules,loadCustomRules,saveCustomRules,CUSTOM_RULES_STORAGE_KEY}from'../src/custom-rules.js';

test('matches exact text and escapes regex characters',()=>{const result=scanCustomRules('Kod A+B i AAB',[{id:'1',name:'Kod',mode:'literal',pattern:'A+B',mask:'[CODE]',ignoreCase:false,enabled:true}]);assert.deepEqual(result.findings.map(x=>x.value),['A+B']);assert.equal(result.findings[0].mask,'[CODE]')});

test('matches regex globally and ignores letter case',()=>{const result=scanCustomRules('KLIENT-123456 oraz klient-654321',[{id:'1',name:'Klient',mode:'regex',pattern:'\\bKLIENT-\\d{6}\\b',mask:'[CLIENT]',ignoreCase:true,enabled:true}]);assert.deepEqual(result.findings.map(x=>x.value),['KLIENT-123456','klient-654321'])});

test('skips disabled rules',()=>{const result=scanCustomRules('SEKRET',[{id:'1',name:'Sekret',mode:'literal',pattern:'SEKRET',mask:'[SECRET]',enabled:false}]);assert.equal(result.findings.length,0)});

test('reports invalid and empty-matching regex without throwing',()=>{const broken=scanCustomRules('tekst',[{id:'1',name:'Błędna',mode:'regex',pattern:'(',mask:'[X]',enabled:true}]);const empty=scanCustomRules('tekst',[{id:'2',name:'Pusta',mode:'regex',pattern:'.*',mask:'[X]',enabled:true}]);assert.equal(broken.findings.length,0);assert.equal(broken.errors.length,1);assert.equal(empty.findings.length,0);assert.equal(empty.errors.length,1);assert.equal(validateCustomRule({name:'Pusta',mode:'regex',pattern:'.*'}).valid,false)});

test('preserves line and column for every match',()=>{const result=scanCustomRules('pierwsza\nID-42 i ID-43',[{id:'1',name:'ID',mode:'regex',pattern:'ID-\\d+',mask:'[ID]',ignoreCase:false,enabled:true}]);assert.deepEqual(result.findings.map(x=>({line:x.line,column:x.column,value:x.value})),[{line:2,column:1,value:'ID-42'},{line:2,column:9,value:'ID-43'}])});

test('saves and loads rules from local storage adapter',()=>{const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};const rules=[{id:'1',name:'Projekt',mode:'literal',pattern:'ALFA',mask:'[PROJECT]',ignoreCase:true,enabled:true}];assert.equal(saveCustomRules(rules,storage),true);assert.ok(data.has(CUSTOM_RULES_STORAGE_KEY));assert.deepEqual(loadCustomRules(storage),rules)});