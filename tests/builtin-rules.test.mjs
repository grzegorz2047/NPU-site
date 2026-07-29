import test from'node:test';
import assert from'node:assert/strict';
import{BUILT_IN_VALIDATED_RULES,scanSensitiveData}from'../src/privacy-scanner.js';
import{BUILT_IN_SEMANTIC_RULES,extractSemanticSpans}from'../src/semantic-spans.js';

const catalog=[...BUILT_IN_VALIDATED_RULES,...BUILT_IN_SEMANTIC_RULES];

test('exposes a complete immutable built-in catalog',()=>{assert.equal(BUILT_IN_VALIDATED_RULES.length,7);assert.equal(BUILT_IN_SEMANTIC_RULES.length,6);assert.equal(new Set(catalog.map(rule=>rule.id)).size,13);assert.ok(Object.isFrozen(BUILT_IN_VALIDATED_RULES));assert.ok(Object.isFrozen(BUILT_IN_SEMANTIC_RULES));for(const rule of catalog){assert.ok(Object.isFrozen(rule),rule.id);assert.ok(rule.pl&&rule.en,rule.id);assert.match(rule.mask,/^\[[A-Z_]+\]$/,rule.id);assert.ok(rule.format.pl&&rule.format.en,rule.id);assert.ok(rule.validation.pl&&rule.validation.en,rule.id)}});

test('validated scanner uses masks from the exported catalog',()=>{const input='PESEL 44051401458, e-mail jan@example.com, token sk-demoOnly1234567890ABCDEF';const findings=scanSensitiveData(input);for(const finding of findings){const rule=BUILT_IN_VALIDATED_RULES.find(item=>item.type===finding.type);assert.ok(rule,finding.type);assert.equal(finding.mask,rule.mask)}});

test('semantic extraction uses rules from the exported catalog',()=>{const input='Jan Kowalski mieszka w Poznaniu przy ulicy Długiej 12 w mieszkaniu 5a.';const finding={type:'identity',value:input,start:0,end:input.length,line:1,score:.9,source:'semantic-model'};const spans=extractSemanticSpans(input,[finding]);for(const type of['person','city','address']){const span=spans.find(item=>item.type===type),rule=BUILT_IN_SEMANTIC_RULES.find(item=>item.type===type);assert.ok(span,type);assert.equal(span.mask,rule.mask)}});

test('catalog does not expose edit or disable controls',()=>{for(const rule of catalog){assert.equal('enabled'in rule,false,rule.id);assert.equal('editable'in rule,false,rule.id)}});