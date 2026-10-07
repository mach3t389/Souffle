import {test} from 'node:test'
import assert from 'node:assert/strict'
import {blockIds,snapshot,validateWorkspace,copyProjects} from '../src/model.ts'
test('stable anchors survive edits, duplicate anchors are replaced',()=>{
 const doc={type:'doc',content:[{type:'paragraph',attrs:{id:'a'},content:[{type:'text',text:'Un'}]},{type:'paragraph',attrs:{id:'a'}}]}
 const fixed=blockIds(doc)
 assert.equal(fixed.content[0].attrs.id,'a');assert.notEqual(fixed.content[1].attrs.id,'a');assert.equal(doc.content[1].attrs.id,'a')
 const copy=blockIds(fixed,true);assert.notEqual(copy.content[0].attrs.id,'a')
})
test('restorable history is copied, deduplicated and capped',()=>{
 const script={id:'s',title:'Script',content:{type:'doc',content:[]},updated:0,revision:1,versions:[]}
 snapshot(script);snapshot(script);assert.equal(script.versions.length,1)
 for(let i=0;i<40;i++){script.title='Version '+i;snapshot(script)}
 assert.equal(script.versions.length,30);script.content.content.push({type:'paragraph'});assert.equal(script.versions[29].content.content.length,0)
 const projects=copyProjects([{id:'p',name:'Projet',scripts:[script]}]);assert.notEqual(projects[0].id,'p');assert.equal(projects[0].scripts[0].versions.length,0)
})
test('invalid backup content and invalid history are rejected',()=>{
 const valid={schemaVersion:2,projects:[{id:'p',name:'Projet',scripts:[{id:'s',title:'Script',content:{type:'doc',content:[]},versions:[]}]}],settings:{}}
 assert.equal(validateWorkspace(valid),true)
 valid.projects[0].scripts[0].versions=[{id:'v',title:'Bad',at:0,content:{type:'doc',content:[null]}}]
 assert.equal(validateWorkspace(valid),false)
})
