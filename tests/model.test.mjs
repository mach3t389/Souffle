import {test} from 'node:test'
import assert from 'node:assert/strict'
import {blockIds,snapshot,validateWorkspace,copyProjects,recoverConflict} from '../src/model.ts'
test('conflict recovery preserves cloud and local history without hiding drafts',()=>{
 const content={type:'doc',content:[{type:'paragraph',attrs:{id:'line'},content:[{type:'text',text:'Brouillon local'}]}]}
 const local={schemaVersion:2,settings:{size:54},projects:[{id:'p',name:'Projet',scripts:[{id:'s',title:'Essai',content,updated:2,revision:2,deletedAt:123,versions:[{id:'v',at:1,title:'Ancienne',content}]}]}]}
 const remote={schemaVersion:2,settings:{size:42},projects:[{id:'p',name:'Projet',scripts:[{id:'s',title:'Essai',content:{type:'doc',content:[]},updated:1,revision:1,versions:[]}]}]}
 const {workspace,recovered}=recoverConflict(local,remote)
 assert.equal(recovered,1);assert.equal(workspace.projects.length,2)
 assert.deepEqual(workspace.projects[0],remote.projects[0]);assert.equal(workspace.projects[1].name,'Projet — brouillon récupéré')
 assert.notEqual(workspace.projects[1].id,'p');assert.notEqual(workspace.projects[1].scripts[0].id,'s')
 assert.equal(workspace.projects[1].scripts[0].deletedAt,undefined)
 assert.equal(workspace.projects[1].scripts[0].versions.length,1)
 assert.notEqual(workspace.projects[1].scripts[0].versions[0].id,'v')
 assert.equal(local.projects[0].scripts[0].deletedAt,123)
 const unchanged=recoverConflict(remote,remote)
 assert.equal(unchanged.recovered,0);assert.equal(unchanged.workspace.projects.length,1)
})
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
