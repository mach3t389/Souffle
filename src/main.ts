import { Editor, generateHTML, generateJSON, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import UniqueID from '@tiptap/extension-unique-id'
import type { User } from '@supabase/supabase-js'
import { blockIds, cloneJson, copyProjects, defaults, recoverConflict, reconcileEquivalent, sameDocuments, snapshot, uid, validateWorkspace, type Project, type Script, type Workspace } from './model'
import { cloud, cloudKey, cloudUrl, fetchWorkspace, saveWorkspace } from './cloud'
import './style.css'
import './theme.css'
import './workspace.css'

const extensions = () => [StarterKit,TextStyleKit,TextAlign.configure({types:['heading','paragraph']}),UniqueID.configure({types:['paragraph','heading','listItem']})]
const $ = <T extends HTMLElement = HTMLElement>(q:string) => document.querySelector<T>(q)!
const esc = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const blank = ():JSONContent => blockIds({type:'doc',content:[{type:'paragraph'}]})
const newScript = (title:string,content=blank()):Script => ({id:uid(),title,content,updated:Date.now(),revision:1,versions:[]})
const empty = ():Workspace => ({schemaVersion:2,projects:[],settings:{...defaults}})
type Envelope = { workspace:Workspace; baseRevision:number; dirty:boolean }
let user:User|null=null, scope='souffle.workspace.v2.local', baseRevision=0, dirty=false, storageError=false, cloudStatus='', conflict=false
let workspace=empty(), lastStored:string|null=null, remoteConflict: {data:Workspace;revision:number}|null=null
let editor:Editor|undefined, timer=0, syncing=false, generation=0, editSerial=0
let page:'workspace'|'library'|'trash'='workspace', collapsed=false, scriptsHidden=true
let search='', notice='', authMessage='', authError=false, authBusy=false, changingAccount=false
const authRequired=import.meta.env.PROD||!!cloud
let authLoaded=!cloud&&!import.meta.env.PROD
let remotePoll=0
let readingStart:{scriptId:string;blockId:string}|null=null
const app=$('#app')
function parseContent(html:string) { return blockIds(generateJSON(html,extensions())) }
function migrate(value:any):Workspace {
 if(validateWorkspace(value))return cloneJson(value)
 if(!value || !Array.isArray(value.projects))throw new Error('Format de sauvegarde invalide.')
 const result=empty()
 result.projects=value.projects.map((p:any)=>{
  if(typeof p.name!=='string'||!Array.isArray(p.scripts))throw new Error('Projet invalide.')
  return {id:typeof p.id==='string'?p.id:uid(),name:p.name,scripts:p.scripts.map((s:any)=>{
   if(typeof s.title!=='string'||typeof s.html!=='string')throw new Error('Script invalide.')
   return {...newScript(s.title,parseContent(s.html)),id:typeof s.id==='string'?s.id:uid(),updated:s.updated||Date.now()}
  })}
 })
 result.settings={...defaults,...value.settings};result.selectedProject=value.selectedProject;result.selectedScript=value.selectedScript
 return result
}
function loadLocal() {
 lastStored=localStorage.getItem(scope)
 if(lastStored){const e=JSON.parse(lastStored) as Envelope;if(!validateWorkspace(e.workspace))throw new Error('Sauvegarde invalide.');workspace=e.workspace;baseRevision=e.baseRevision||0;dirty=e.dirty===true;return}
 if(!user){const legacy=localStorage.getItem('souffle.workspace.v1');if(legacy){workspace=migrate(JSON.parse(legacy));return}}
 workspace=empty();baseRevision=0;dirty=false
}
try{collapsed=localStorage.getItem('souffle.sidebar')==='collapsed';loadLocal()}catch{storageError=true;notice='La sauvegarde locale est illisible. Elle est conservée; exporte ou restaure une sauvegarde avant de remplacer les données.'}
function activeProject():Project|undefined { return workspace.projects.find(p=>p.id===workspace.selectedProject&&!p.deletedAt)||workspace.projects.find(p=>!p.deletedAt) }
function activeScript():Script|undefined { const p=activeProject();return p?.scripts.find(s=>s.id===workspace.selectedScript&&!s.deletedAt)||p?.scripts.find(s=>!s.deletedAt) }
function select(p:Project,s?:Script){workspace.selectedProject=p.id;workspace.selectedScript=(s||p.scripts.find(s=>!s.deletedAt))?.id;page='workspace';search='';store(false);render()}
function toast(text:string){notice=text;const node=document.querySelector('#toast');if(node){node.textContent=text;node.classList.add('visible');window.setTimeout(()=>node.classList.remove('visible'),6000)}}
function status(){const node=document.querySelector<HTMLButtonElement>('#save-state');if(!node)return;const full=storageError?'Sauvegarde locale impossible':conflict?'Conflit à résoudre':user?(cloudStatus||(dirty?'Modifications locales':'Synchronisé')):'Sauvegardé sur cet appareil';node.innerHTML='<span class="save-symbol" aria-hidden="true">'+(storageError||conflict?'!':user?'↻':'✓')+'</span><span class="save-copy">'+esc(!user&&!storageError&&!conflict?'Sauvegardé':full)+'</span>';node.disabled=!user||syncing||conflict||storageError;node.setAttribute('aria-label',user?'Synchroniser maintenant. État : '+full:full);node.setAttribute('title',user?'Synchroniser maintenant — '+full:full);node.classList.toggle('save-warning',storageError||conflict);node.classList.toggle('save-pending',dirty)}

function store(markDirty=true){
 if(markDirty){dirty=true;editSerial++;if(user)cloudStatus='Modifications locales'}
 if(conflict||storageError){status();return false}
 try{
  const current=localStorage.getItem(scope)
  if(current!==lastStored){try{const other=current?JSON.parse(current) as Envelope:null;if(other&&validateWorkspace(other.workspace)&&sameDocuments(workspace,other.workspace)){lastStored=current;baseRevision=Math.max(baseRevision,other.baseRevision||0)}else{conflict=true;toast('Ce projet a changé dans un autre onglet. Résous le conflit avant de continuer.');renderConflict();return false}}catch{conflict=true;renderConflict();return false}}
  lastStored=JSON.stringify({workspace,baseRevision,dirty} satisfies Envelope);localStorage.setItem(scope,lastStored);status()
  return true
 }catch{storageError=true;toast('Sauvegarde impossible. Exporte tes projets pour conserver ton travail.');status();return false}
}
function capture(){if(editor){const s=activeScript();if(s)s.content=blockIds(editor.getJSON())}}
function flush(){window.clearTimeout(timer);capture();return store(false)}
 function refreshApp(){if(!navigator.onLine){toast("Connecte cet appareil à Internet pour actualiser Souffle.");return}if(conflict){capture();try{localStorage.setItem(`souffle.conflict.backup.${user?.id||'local'}`,JSON.stringify({at:Date.now(),workspace:cloneJson(workspace)}))}catch{toast("Actualisation arrêtée : impossible de conserver le brouillon local.");return}}else if(!flush()){toast("Actualisation arrêtée : conserve d’abord ton brouillon local ou résous le conflit.");return}window.location.replace(window.location.pathname+"?actualisation="+Date.now()+window.location.hash)}
function mutate(action:()=>void){capture();action();store();render()}
async function synchronize(){
 if(!user||!cloud||syncing||conflict||storageError||changingAccount)return
 if(!navigator.onLine){cloudStatus='Hors connexion · brouillon local';status();return}
 const mine=generation,owner=user.id,serial=editSerial;syncing=true;cloudStatus='Synchronisation…';status()
 try{
  if(dirty){const result=await saveWorkspace(cloneJson(workspace),baseRevision,owner);if(mine!==generation)return;if(result.conflict){const latest=await fetchWorkspace(owner);if(latest&&validateWorkspace(latest.data)&&sameDocuments(workspace,latest.data)){const merged=reconcileEquivalent(workspace,latest.data);workspace=merged.workspace;baseRevision=latest.revision;dirty=merged.changed;remoteConflict=null;cloudStatus=dirty?'Historique local à synchroniser':'Synchronisé';store(false);render();return}remoteConflict=latest;conflict=true;renderConflict();throw new Error('Une autre version existe dans le cloud.')}baseRevision=result.revision;if(serial===editSerial)dirty=false;store(false)}
  else{const remote=await fetchWorkspace(owner);if(mine!==generation)return;if(remote&&remote.revision!==baseRevision){if(!validateWorkspace(remote.data))throw new Error('Données cloud invalides.');if(serial!==editSerial||dirty)return;workspace=remote.data;baseRevision=remote.revision;store(false);render()}}
  cloudStatus=dirty?'Modifications locales':'Synchronisé';status()
 }catch(e){if(mine===generation){cloudStatus=navigator.onLine?`Cloud indisponible · brouillon local`:'Hors connexion · brouillon local';status();if(conflict)toast(message(e))}}
 finally{syncing=false;status()}
}
function message(e:unknown){return e instanceof Error?e.message:typeof (e as any)?.message==='string'?(e as any).message:'Une erreur est survenue. Réessaie.'}
function renderConflict(){editor?.setEditable(!conflict && !changingAccount);const b=document.querySelector('#conflict-banner');if(b){b.innerHTML=conflict?'<strong>Deux versions du projet diffèrent.</strong><span>Ton brouillon reste sur cet appareil. Tu peux conserver les deux versions ou reprendre celle du cloud; une copie locale de ton brouillon sera alors gardée dans Mon compte.</span><button id="keep-both" class="button secondary">Conserver les deux</button><button id="export-conflict" class="button secondary">Exporter mon brouillon</button><button id="use-cloud" class="button secondary">Utiliser la version cloud</button>':'';const both=document.querySelector<HTMLButtonElement>('#keep-both');if(both)both.onclick=resolveConflict;const exportButton=document.querySelector<HTMLButtonElement>('#export-conflict');if(exportButton)exportButton.onclick=exportWorkspace;const useCloud=document.querySelector<HTMLButtonElement>('#use-cloud');if(useCloud)useCloud.onclick=()=>void useCloudVersion()}status()}
async function useCloudVersion(){
 try{
  if(!user)throw new Error('Connecte-toi pour charger la version cloud.')
  const remote=await fetchWorkspace(user.id)
  if(!remote||!validateWorkspace(remote.data))throw new Error('Version cloud indisponible.')
  if(localStorage.getItem(scope)!==lastStored)throw new Error('Le brouillon a changé dans un autre onglet. Ferme cet onglet ou exporte ton brouillon.')
  const backupKey=`souffle.conflict.backup.${user.id}`
  localStorage.setItem(backupKey,JSON.stringify({at:Date.now(),workspace:cloneJson(workspace)}))
  const previous={workspace,baseRevision,dirty,conflict,remoteConflict}
  workspace=remote.data;baseRevision=remote.revision;dirty=false;conflict=false;remoteConflict=null;cloudStatus='Synchronisé'
  if(!store(false)){workspace=previous.workspace;baseRevision=previous.baseRevision;dirty=previous.dirty;conflict=previous.conflict;remoteConflict=previous.remoteConflict;renderConflict();return}
  render();toast('Version cloud chargée. Ton brouillon précédent reste dans Mon compte.')
 }catch(e){toast('Impossible de remplacer le brouillon local : '+message(e))}
}
async function resolveConflict(){
 try{
  if(!user)throw new Error('Connecte-toi pour résoudre le conflit.')
  const remote=await fetchWorkspace(user.id)
  if(!remote||!validateWorkspace(remote.data))throw new Error('Version distante indisponible. Exporte ton brouillon.')
  if(localStorage.getItem(scope)!==lastStored)throw new Error('Ce brouillon a changé dans un autre onglet. Exporte-le avant de continuer.')
  const merged=recoverConflict(workspace,remote.data)
  const previous={workspace,baseRevision,conflict,remoteConflict}
  workspace=merged.workspace;baseRevision=remote.revision;conflict=false;remoteConflict=null
  if(!store()){workspace=previous.workspace;baseRevision=previous.baseRevision;conflict=previous.conflict;remoteConflict=previous.remoteConflict;renderConflict();return}
  render()
  await synchronize()
  if(!conflict)toast(dirty?'Brouillon conservé sur cet appareil. Réessaie Synchroniser pour le voir ailleurs.':merged.recovered?'Brouillon récupéré et synchronisé dans un projet séparé.':'Version cloud synchronisée.')
 }catch(e){toast(message(e))}
}
const theme=()=>document.documentElement.dataset.theme==='dark'
function themeIcon(){return theme()
 ? '<svg class="theme-illustration sun" width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path class="theme-icon-fill" d="M22.2 15.8c0 3.6-2.5 6.6-6.1 6.6-3.8 0-6.4-2.8-6.4-6.4 0-3.5 2.6-6.3 6.2-6.3 3.5 0 6.3 2.5 6.3 6.1Z"/><path d="M22.2 15.8c0 3.6-2.5 6.6-6.1 6.6-3.8 0-6.4-2.8-6.4-6.4 0-3.5 2.6-6.3 6.2-6.3 3.5 0 6.3 2.5 6.3 6.1ZM16 3.5v2.4m0 20.2v2.4M3.5 16h2.4m20.2 0h2.4M7.2 7.2l1.7 1.7m14.2 14.2 1.7 1.7M7.2 24.8l1.7-1.7M23.1 8.9l1.7-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 12.5a4 4 0 0 1 3-.7" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/></svg>'
 : '<svg class="theme-illustration moon" width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path class="theme-icon-fill" d="M18.8 4.5a11.7 11.7 0 1 0 8.4 17.8c-7.6 1.5-13.6-6.8-8.4-17.8Z"/><path d="M18.8 4.5a11.7 11.7 0 1 0 8.4 17.8c-7.6 1.5-13.6-6.8-8.4-17.8Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m25.4 5.5.8 2.6 2.6.8-2.6.8-.8 2.6-.8-2.6-2.6-.8 2.6-.8.8-2.6Z" fill="currentColor"/><circle cx="24.2" cy="16" r="1" fill="currentColor" opacity=".6"/><path d="M9 19.5c.6 1.7 1.7 2.8 3.3 3.4" stroke="currentColor" stroke-opacity=".4" stroke-width="1.2" stroke-linecap="round"/></svg>'}
function render(){
 editor?.destroy();editor=undefined;window.clearInterval(remotePoll)
 const p=activeProject(),s=activeScript();if(p)workspace.selectedProject=p.id;if(s)workspace.selectedScript=s.id;if(readingStart?.scriptId!==s?.id)readingStart=null
 app.innerHTML=`<div class="workbench ${collapsed?'sidebar-collapsed':''} ${scriptsHidden?'scripts-hidden':''}"><aside class="sidebar"><div class="side-brand"><a href="#" class="brand" aria-label="Mes projets">souffle<span class="brand-dot">.</span></a><button id="close-menu" class="icon-button" aria-label="Replier le menu">‹</button></div><button id="library" class="nav-item ${page==='library'?'active':''}">▦ <span>Mes projets</span></button><div class="section-row"><span>PROJETS</span><button id="new-project" class="icon-button" aria-label="Créer un projet">＋</button></div><div class="project-list">${workspace.projects.filter(p=>!p.deletedAt).map(item=>`<button data-project="${esc(item.id)}" class="nav-item ${p?.id===item.id&&page==='workspace'?'active':''}">▱ <span>${esc(item.name)}</span></button>`).join('')||'<p class="small muted">Aucun projet</p>'}</div><div class="side-bottom"><button id="trash" class="nav-item">♲ Corbeille</button><button id="account" class="nav-item">◎ ${user?'Mon compte':'Se connecter'}</button><div class="backup-actions"><button id="export" class="text-button" title="Télécharger tous les projets en fichier JSON">Télécharger une sauvegarde</button><button id="restore" class="text-button" title="Ajouter les projets d’une sauvegarde JSON">Importer une sauvegarde</button></div><small>${user?esc(user.email||'Compte connecté'):'Stockage sur cet appareil'}</small></div></aside><button class="menu-scrim" id="menu-scrim" aria-label="Fermer le menu"></button><main class="workspace-main"><header class="topbar"><div class="header-start"><button id="toggle-menu" class="square-button" aria-label="${collapsed?'Ouvrir':'Replier'} le menu" aria-expanded="${!collapsed}">☰</button>${p&&page==='workspace'?`<button id="rename-project" class="project-name" aria-label="Renommer le projet ${esc(p.name)}" title="Renommer le projet">${esc(p.name)}</button>`:`<div class="breadcrumb">${page==='trash'?'Corbeille':'Mes projets'}</div>`}</div><div class="top-actions">${user?'<button id="join-reader" class="button secondary" aria-haspopup="dialog">Rejoindre une lecture</button>':''}<button id="save-state" type="button"></button><button id="refresh-app" class="theme-toggle" type="button" aria-label="Actualiser Souffle" title="Actualiser Souffle"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="theme-toggle" class="theme-toggle" aria-label="Activer le thème ${theme()?'clair':'sombre'}" title="Activer le thème ${theme()?'clair':'sombre'}">${themeIcon()}</button><button id="account-top" class="button secondary" aria-label="${user?'Mon compte':'Connexion'}" title="${user?'Mon compte':'Connexion'}"><svg class="account-symbol" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="account-label">${user?'Compte':'Connexion'}</span></button></div></header><div id="conflict-banner" class="conflict-banner" role="alert"></div>${page==='library'?libraryHTML():page==='trash'?trashHTML():workspaceHTML(p,s)}</main></div><div id="toast" role="status"></div><input id="file-input" type="file" accept=".docx,.txt" hidden><input id="backup-input" type="file" accept=".json" hidden><dialog id="dialog"></dialog>`
 $('#toggle-menu').onclick=()=>toggleMenu();$('#close-menu').onclick=()=>toggleMenu();$('#menu-scrim').onclick=()=>toggleMenu(true)
 $('#library').onclick=()=>{flush();page='library';if(innerWidth<=850)collapsed=true;render()};$('.brand').onclick=e=>{e.preventDefault();flush();page='library';if(innerWidth<=850)collapsed=true;render()}
 $('#new-project').onclick=()=>createProject();$('#trash').onclick=()=>{flush();page='trash';if(innerWidth<=850)collapsed=true;render()}
 $('#export').onclick=exportWorkspace;$('#restore').onclick=()=>$('#backup-input').click();$('#backup-input').onchange=restore;$('#file-input').onchange=importFile
 $('#account').onclick=showAccount;$('#account-top').onclick=showAccount
 const joinButton=document.querySelector<HTMLButtonElement>('#join-reader');if(joinButton)joinButton.onclick=joinProjectReader
 $('#save-state').onclick=()=>{flush();void synchronize()}
  $('#refresh-app').onclick=refreshApp
 $('#theme-toggle').onclick=()=>{document.documentElement.dataset.theme=theme()?'light':'dark';try{localStorage.setItem('souffle.theme',document.documentElement.dataset.theme!)}catch{}flush();render()}
 document.querySelectorAll<HTMLButtonElement>('[data-project]').forEach(b=>b.onclick=()=>{flush();const target=workspace.projects.find(p=>p.id===b.dataset.project)!;if(innerWidth<=850)collapsed=true;select(target)})
 if(p&&page==='workspace'){
  $('#rename-project').onclick=()=>renameProject(p)
  $('#new-script').onclick=()=>createScriptDialog(p)
  const remoteButton=document.querySelector<HTMLButtonElement>('#project-remote');if(remoteButton&&s)remoteButton.onclick=()=>void remoteDialog(s)
  bindScriptPicker()
  const menu=document.querySelector<HTMLButtonElement>('#script-menu');if(menu&&s)menu.onclick=()=>{capture();scriptMenu(s)}
  const plan=document.querySelector<HTMLButtonElement>('#toggle-outline');if(plan)plan.onclick=()=>{if(innerWidth<=850){chaptersDialog();return}flush();scriptsHidden=!scriptsHidden;render()}
  $('#close-outline').onclick=()=>{flush();scriptsHidden=true;render()}
  if(s)setupEditor(s)
 }
 document.querySelectorAll<HTMLButtonElement>('[data-restore-script]').forEach(b=>b.onclick=()=>mutate(()=>{for(const project of workspace.projects){const item=project.scripts.find(s=>s.id===b.dataset.restoreScript);if(item){delete item.deletedAt;delete project.deletedAt}}}))
 document.querySelectorAll<HTMLButtonElement>('[data-restore-project]').forEach(b=>b.onclick=()=>mutate(()=>{const item=workspace.projects.find(p=>p.id===b.dataset.restoreProject)!;delete item.deletedAt}))
 document.querySelectorAll<HTMLButtonElement>('[data-rename-project]').forEach(b=>b.onclick=()=>renameProject(workspace.projects.find(p=>p.id===b.dataset.renameProject)!))
 document.querySelectorAll<HTMLButtonElement>('[data-project-menu]').forEach(b=>b.onclick=()=>projectMenu(workspace.projects.find(p=>p.id===b.dataset.projectMenu)!))
 const make=document.querySelector<HTMLButtonElement>('#create-project');if(make)make.onclick=()=>createProject()
 $('.sidebar').inert=collapsed
 renderConflict();status()
 if(notice){toast(notice);notice=''}
}
function toggleMenu(force?:boolean){collapsed=force??!collapsed;$('.workbench').classList.toggle('sidebar-collapsed',collapsed);$('.sidebar').inert=collapsed;$('#toggle-menu').setAttribute('aria-expanded',String(!collapsed));$('#toggle-menu').setAttribute('aria-label',collapsed?'Ouvrir le menu':'Replier le menu');try{localStorage.setItem('souffle.sidebar',collapsed?'collapsed':'open')}catch{}}
function createProject(){nameDialog('Nouveau projet','','Créer',name=>mutate(()=>{const added:Project={id:uid(),name,scripts:[]};workspace.projects.push(added);workspace.selectedProject=added.id;workspace.selectedScript=undefined;page='workspace'}))}
function renameProject(p:Project){nameDialog('Renommer le projet',p.name,'Enregistrer',name=>mutate(()=>p.name=name))}
function createScriptDialog(p:Project){
 const d=dialog('Nouveau script',`<form id="new-script-form" class="new-script-form"><label for="new-script-name">Nom du script<input id="new-script-name" required maxlength="120" placeholder="Donne un titre à ton script" autocomplete="off"></label><button class="button primary">Créer un script vierge</button></form><div class="creation-divider"><span>ou</span></div><button id="import-script" class="import-script-option"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5M12 17v-6m-3 3 3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span><strong>Importer un document</strong><small>Fichier Word (.docx) ou texte (.txt)</small></span><span aria-hidden="true">→</span></button><p id="import-error" class="danger" role="alert"></p>`)
 $('#new-script-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#new-script-name').value.trim();if(!title)return;d.close();mutate(()=>{const added=newScript(title);p.scripts.push(added);workspace.selectedScript=added.id;search=''})}
 $('#import-script').onclick=()=>{const input=$<HTMLInputElement>('#file-input');input.value='';$('#import-error').textContent='';input.click()}
 $('#new-script-name').focus()
}
function libraryHTML(){return `<section class="library-view"><div class="list-heading"><h1>Mes projets</h1><button id="create-project" class="button primary">＋ Nouveau projet</button></div><div class="library-grid">${workspace.projects.filter(p=>!p.deletedAt).map(p=>{const count=p.scripts.filter(s=>!s.deletedAt).length;return `<article class="project-card"><button class="project-open" data-project="${esc(p.id)}" aria-label="Ouvrir le projet ${esc(p.name)}"><h2>${esc(p.name)}</h2><p>${count} script${count===1?'':'s'}</p><span>Ouvrir le projet →</span></button><div class="project-card-actions"><button class="text-button" data-rename-project="${esc(p.id)}" aria-label="Renommer le projet ${esc(p.name)}">Renommer</button><button class="square-button" data-project-menu="${esc(p.id)}" aria-label="Actions du projet ${esc(p.name)}">⋯</button></div></article>`}).join('')||'<div class="empty-state"><h2>Aucun projet</h2><p>Crée un projet pour regrouper tes scripts.</p></div>'}</div></section>`}
function workspaceHTML(p:Project|undefined,s:Script|undefined){
 if(!p)return `<section class="empty-state"><h1>Mes projets</h1><p>Crée un projet pour commencer.</p><button id="create-project" class="button primary">＋ Nouveau projet</button></section>`
 const scripts=p.scripts.filter(s=>!s.deletedAt)
 return `<div class="script-bar" aria-label="Navigation et actions du script"><div class="script-selection">${scriptPickerHTML(scripts,s)}</div>${s?'<button id="project-remote" class="button remote-entry" aria-haspopup="dialog">Télécommande</button>':''}<button id="new-script" class="button secondary" aria-haspopup="dialog" aria-label="Nouveau script" title="Nouveau script"><span aria-hidden="true">＋</span><span class="new-script-label">Nouveau script</span><span class="new-script-label-short" aria-hidden="true">Nouveau</span></button>${s?'<button id="script-menu" class="square-button" aria-label="Actions du script sélectionné" title="Actions du script" aria-haspopup="dialog">⋯</button><div class="reading-actions"><button id="toggle-outline" class="square-button" aria-label="Plan du script" title="Plan du script" aria-expanded="'+!scriptsHidden+'"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><button id="start" class="button primary">▷ Lecture</button></div>':''}</div>
 <div class="editor-layout"><aside class="scripts-panel" aria-label="Plan du script"><div class="list-heading"><h2>Plan du script</h2><button id="close-outline" class="square-button" aria-label="Fermer le plan">×</button></div><div id="script-outline"></div></aside>${s?`<section class="document-panel" aria-label="Script : ${esc(s.title)}"><div id="reading-start" class="reading-start" hidden></div>${toolbarHTML()}<div id="editor"></div><footer class="document-footer"><span id="word-count"></span><span id="duration"></span></footer></section>`:'<section class="empty-state"><h2>Aucun script sélectionné</h2><p>Utilise Nouveau script pour écrire ou importer un document.</p></section>'}</div>`

}
function toolbarHTML(){return `<div class="toolbar" role="toolbar" aria-label="Mise en forme"><select id="block" aria-label="Style du paragraphe"><option value="p">Texte courant</option><option value="h1">Titre principal</option><option value="h2">Chapitre</option><option value="h3">Sous-titre</option></select><span class="separator"></span><button data-format="bold" aria-label="Gras"><b>B</b></button><button data-format="italic" aria-label="Italique"><i>I</i></button><button data-format="underline" aria-label="Souligné"><u>U</u></button><select id="font" aria-label="Police du document"><option value="sans-serif">Sans sérif</option><option value="Georgia">Georgia</option><option value="monospace">Mono</option></select><select id="font-size" aria-label="Taille du texte"><option value="18px">18</option><option value="24px">24</option><option value="32px">32</option><option value="40px">40</option></select><button data-format="bulletList" aria-label="Liste à puces">☷</button><button data-format="undo" aria-label="Annuler">↶</button><button data-format="redo" aria-label="Rétablir">↷</button></div>`}
function scriptPickerHTML(scripts:Script[],selected?:Script){return `<span id="script-picker-label" class="script-picker-label">Script <span>${scripts.length}</span></span><div class="script-picker"><button id="script-picker" class="script-picker-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="script-picker-options" aria-label="Choisir un script" title="${esc(selected?.title||'Aucun script')}" ${!scripts.length?'disabled':''}><span id="script-picker-value">${esc(selected?.title||'Aucun script')}</span><svg class="picker-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div id="script-picker-options" class="script-picker-options" role="listbox" aria-labelledby="script-picker-label" hidden>${scripts.map(item=>`<button role="option" id="picker-${esc(item.id)}" data-picker-script="${esc(item.id)}" aria-selected="${item.id===selected?.id}" tabindex="-1"><span class="picker-option-title">${esc(item.title)}</span><svg class="picker-check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div></div>`}
function closeScriptPicker(focus=false){const list=document.querySelector<HTMLElement>('#script-picker-options'),trigger=document.querySelector<HTMLButtonElement>('#script-picker');if(!list||!trigger)return;list.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus()}
function bindScriptPicker(){
 const trigger=$<HTMLButtonElement>('#script-picker'),list=$('#script-picker-options'),wrap=trigger.parentElement!,options=Array.from(list.querySelectorAll<HTMLButtonElement>('[data-picker-script]'))
 const open=(last=false)=>{if(trigger.disabled)return;list.hidden=false;trigger.setAttribute('aria-expanded','true');(last?options[options.length-1]:options.find(o=>o.getAttribute('aria-selected')==='true')||options[0])?.focus()}
 trigger.onclick=()=>list.hidden?open():closeScriptPicker()
 trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(e.key==='ArrowUp')}}
 options.forEach(option=>option.onclick=()=>{chooseScript(option.dataset.pickerScript!);$('#script-picker').focus()})
 let query='',typedAt=0
 list.onkeydown=e=>{const index=options.indexOf(document.activeElement as HTMLButtonElement);let next=index;if(e.key==='ArrowDown')next=(index+1)%options.length;else if(e.key==='ArrowUp')next=(index-1+options.length)%options.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=options.length-1;else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeScriptPicker(true);return}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key!==' '){query=Date.now()-typedAt<700?query+e.key:e.key;typedAt=Date.now();const match=options.find(o=>o.textContent?.trim().toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));if(match){e.preventDefault();match.focus()}return}else return;e.preventDefault();options[next]?.focus()}
 wrap.addEventListener('focusout',e=>{if(!wrap.contains(e.relatedTarget as Node|null))closeScriptPicker()})
}
// Ferme le menu sans déplacer le focus de l’action choisie.
document.addEventListener('pointerdown',e=>{if(!(e.target as Element).closest('.script-picker'))closeScriptPicker()})
const wideViewport=window.matchMedia('(min-width:1101px)')
const onWideViewport=(e:MediaQueryListEvent|MediaQueryList)=>{if(e.matches)closeScriptPicker()}
if(wideViewport.addEventListener)wideViewport.addEventListener('change',onWideViewport)
else wideViewport.addListener(onWideViewport)
function chooseScript(id:string){if(!flush())return;workspace.selectedScript=id;store(false);render()}
function setupEditor(s:Script){
 editor=new Editor({element:$('#editor'),extensions:extensions(),content:s.content,editorProps:{attributes:{'aria-label':'Contenu du script',role:'textbox','aria-multiline':'true'}},onUpdate:()=>{if(conflict)return;const now=Date.now();if(!s.versions.length||now-s.versions[s.versions.length-1].at>60000)snapshot(s);s.content=blockIds(editor!.getJSON());s.updated=now;s.revision++;dirty=true;editSerial++;if(user)cloudStatus='Modifications locales';window.clearTimeout(timer);timer=window.setTimeout(()=>store(false),500);status();stats()},onSelectionUpdate:updateToolbar})
 $('#start').onclick=openReader
 document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>{const c=editor!.chain().focus();switch(b.dataset.format){case'bold':c.toggleBold().run();break;case'italic':c.toggleItalic().run();break;case'underline':c.toggleUnderline().run();break;case'bulletList':c.toggleBulletList().run();break;case'undo':c.undo().run();break;case'redo':c.redo().run();break}updateToolbar()}})
 $('#block').onchange=()=>{const v=($('#block') as HTMLSelectElement).value;v==='p'?editor!.chain().focus().setParagraph().run():editor!.chain().focus().setHeading({level:Number(v.slice(1)) as 1|2|3}).run()}
 $('#font').onchange=()=>editor!.chain().focus().setFontFamily(($('#font') as HTMLSelectElement).value).run();$('#font-size').onchange=()=>editor!.chain().focus().setFontSize(($('#font-size') as HTMLSelectElement).value).run()
 editor.setEditable(!conflict&&!changingAccount);stats();updateToolbar()
}
function stats(){const words=editor!.getText({blockSeparator:' '}).trim().split(/\s+/).filter(Boolean).length;$('#word-count').textContent=`${words} mots`;$('#duration').textContent=`≈ ${Math.max(1,Math.ceil(words/130))} min`;updateOutline()}
function updateToolbar(){if(!editor)return;document.querySelectorAll<HTMLElement>('[data-format]').forEach(b=>{const pressed=editor!.isActive(b.dataset.format!);b.classList.toggle('pressed',pressed);b.setAttribute('aria-pressed',String(pressed))});($('#block') as HTMLSelectElement).value=editor.isActive('heading')?`h${editor.getAttributes('heading').level}`:'p';const attrs=editor.getAttributes('textStyle');if(attrs.fontFamily)($('#font') as HTMLSelectElement).value=attrs.fontFamily;if(attrs.fontSize)($('#font-size') as HTMLSelectElement).value=attrs.fontSize}
function dialog(title:string,html:string){const d=$<HTMLDialogElement>('#dialog');d.classList.remove('remote-stage');d.innerHTML=`<div class="dialog-header"><h2>${esc(title)}</h2><button id="close-dialog" class="square-button" aria-label="Fermer">×</button></div>${html}`;$('#close-dialog').onclick=()=>d.close();d.onclose=()=>window.clearInterval(remotePoll);if(typeof d.showModal==='function')d.showModal();else{d.classList.add('legacy-dialog');d.setAttribute('open','');document.body.classList.add('legacy-dialog-open');(d as any).close=()=>{d.removeAttribute('open');document.body.classList.remove('legacy-dialog-open');if(d.onclose)d.onclose(new Event('close'))};Object.defineProperty(d,'open',{get:()=>d.hasAttribute('open')})}return d}
function nameDialog(title:string,value:string,action:string,done:(name:string)=>void){const d=dialog(title,`<form id="name-form"><label>Nom<input id="name-input" required maxlength="120" value="${esc(value)}" autocomplete="off"></label><div class="dialog-actions"><button class="button primary">${esc(action)}</button></div></form>`);$('#name-form').onsubmit=e=>{e.preventDefault();const name=($('#name-input') as HTMLInputElement).value.trim();if(name){d.close();done(name)}};$('#name-input').focus()}
function scriptMenu(s:Script){const p=activeProject()!;const d=dialog(s.title,`<div class="action-list"><button id="rename-script">Renommer</button><button id="duplicate-script">Dupliquer</button><button id="script-history">Historique</button><button id="script-remote">Télécommande</button><label>Déplacer vers<select id="move-target"><option value="">Choisir un projet</option>${workspace.projects.filter(x=>!x.deletedAt&&x.id!==p.id).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><button id="delete-script" class="danger">Mettre à la corbeille</button></div>`);$('#rename-script').onclick=()=>{d.close();nameDialog('Renommer le script',s.title,'Enregistrer',name=>mutate(()=>{snapshot(s);s.title=name;s.revision++;s.updated=Date.now()}))};$('#script-history').onclick=()=>{d.close();historyDialog(s)};$('#script-remote').onclick=()=>{d.close();void remoteDialog(s)};$('#duplicate-script').onclick=()=>{d.close();mutate(()=>{const added=newScript(s.title+' — copie',blockIds(s.content,true));p.scripts.push(added);workspace.selectedScript=added.id})};$('#move-target').onchange=()=>{const target=workspace.projects.find(p=>p.id===($('#move-target') as HTMLSelectElement).value);if(target){d.close();mutate(()=>{p.scripts=p.scripts.filter(x=>x!==s);target.scripts.push(s);workspace.selectedProject=target.id;workspace.selectedScript=s.id})}};$('#delete-script').onclick=()=>{d.close();mutate(()=>{snapshot(s);s.deletedAt=Date.now();workspace.selectedScript=undefined});toast('Script déplacé dans la corbeille.')};}
function projectMenu(p:Project){const d=dialog(p.name,'<div class="action-list"><button id="rename-p">Renommer le projet</button><button id="delete-p" class="danger">Mettre le projet à la corbeille</button></div>');$('#rename-p').onclick=()=>{d.close();renameProject(p)};$('#delete-p').onclick=()=>{d.close();mutate(()=>{p.deletedAt=Date.now();workspace.selectedProject=undefined;workspace.selectedScript=undefined;page='library'})}}
function trashHTML(){return `<section class="library-view"><h1>Corbeille</h1><p class="muted">Les éléments restent récupérables.</p><div class="trash-list">${workspace.projects.flatMap(p=>[...(p.deletedAt?[`<div><strong>Projet : ${esc(p.name)}</strong><button class="button secondary" data-restore-project="${esc(p.id)}">Restaurer le projet</button></div>`]:[]),...(!p.deletedAt?p.scripts.filter(s=>s.deletedAt).map(s=>`<div><span>${esc(p.name)} / <strong>${esc(s.title)}</strong></span><button class="button secondary" data-restore-script="${esc(s.id)}">Restaurer le script</button></div>`):[])]).join('')||'<p>La corbeille est vide.</p>'}</div></section>`}
function historyDialog(s:Script){capture();const d=dialog('Historique du script',`<p class="muted">30 versions récentes au maximum. Une version est conservée avant les changements importants et environ chaque minute d’édition.</p><button id="save-version" class="button primary">Créer un point de sauvegarde</button><div class="version-list">${s.versions.slice().reverse().map(v=>`<div><span><strong>${esc(v.title)}</strong><small>${new Date(v.at).toLocaleString('fr-CA')}</small></span><button class="button secondary" data-version="${esc(v.id)}">Restaurer</button></div>`).join('')||'<p>Aucune ancienne version.</p>'}</div>`);$('#save-version').onclick=()=>{snapshot(s);store();d.close();historyDialog(s)};document.querySelectorAll<HTMLButtonElement>('[data-version]').forEach(b=>b.onclick=()=>{const v=s.versions.find(v=>v.id===b.dataset.version)!;d.close();mutate(()=>{snapshot(s);s.content=cloneJson(v.content);s.title=v.title;s.revision++;s.updated=Date.now()});toast('Version restaurée. Le contenu précédent reste dans l’historique.')})}
function headings(){return Array.from(editor?.view.dom.querySelectorAll<HTMLElement>('h1,h2,h3')||[])}
function outlineHTML(){const heads=headings();return '<button class="outline-item" data-outline="">Depuis le début</button>'+ (heads.map(h=>`<button class="outline-item level-${h.tagName.slice(1)}" data-outline="${esc(h.dataset.id||'')}" aria-pressed="${readingStart?.blockId===h.dataset.id}">${esc(h.textContent?.trim()||'Sans titre')}</button>`).join('')||'<p class="outline-empty">Ajoute des titres avec les styles « Chapitre » ou « Sous-titre » pour créer le plan.</p>')}
function jumpToChapter(id:string){const s=activeScript();if(!s||!editor)return;const heading=headings().find(h=>h.dataset.id===id);readingStart=heading?{scriptId:s.id,blockId:id}:null;updateOutline();const target=heading||editor.view.dom;target.scrollIntoView({behavior:'smooth',block:'center'});let pos=1;if(heading)editor.state.doc.descendants((node,position)=>{if(node.attrs.id===id)pos=position+1});editor.commands.setTextSelection(pos);editor.commands.focus(undefined,{scrollIntoView:false})}
function bindOutline(root:HTMLElement,close?:()=>void){root.querySelectorAll<HTMLButtonElement>('[data-outline]').forEach(b=>b.onclick=()=>{close?.();jumpToChapter(b.dataset.outline||'')})}
function updateOutline(){const heads=headings();const current=heads.find(h=>h.dataset.id===readingStart?.blockId);if(readingStart&&!current)readingStart=null;const panel=document.querySelector<HTMLElement>('#script-outline');if(panel){panel.innerHTML=outlineHTML();bindOutline(panel)}const marker=document.querySelector<HTMLElement>('#reading-start');if(marker){marker.hidden=!current;marker.innerHTML=current?`<span>Lecture depuis : <strong>${esc(current.textContent?.trim()||'Sans titre')}</strong></span><button id="clear-reading-start" class="text-button">Revenir au début</button>`:'';const reset=document.querySelector<HTMLButtonElement>('#clear-reading-start');if(reset)reset.onclick=()=>jumpToChapter('')}}
function chaptersDialog(){if(!editor)return;const d=dialog('Plan du script','<p class="muted">Choisis une section, puis lance la lecture pour démarrer à cet endroit.</p><div class="outline-list">'+outlineHTML()+'</div>');bindOutline(d,()=>d.close())}
async function importFile(){const file=$<HTMLInputElement>('#file-input').files?.[0],projectId=activeProject()?.id;if(!file||!projectId)return;const mine=generation;try{if(file.size>10*1024*1024)throw new Error('Le fichier dépasse 10 Mo.');let html='';if(/\.docx$/i.test(file.name)){const m=await import('mammoth');html=(await m.convertToHtml({arrayBuffer:await file.arrayBuffer()})).value}else if(/\.txt$/i.test(file.name))html=(await file.text()).split(/\r?\n/).map(l=>`<p>${esc(l)}</p>`).join('');else throw new Error('Choisis un fichier .docx ou .txt.');if(mine!==generation)return;mutate(()=>{const s=newScript(file.name.replace(/\.[^.]+$/,''),parseContent(html));workspace.projects.find(p=>p.id===projectId)!.scripts.push(s);workspace.selectedProject=projectId;workspace.selectedScript=s.id});toast('Document importé. Vérifie les polices, tailles et mises en page complexes.')}catch(e){const error=document.querySelector<HTMLElement>('#import-error');if(error)error.textContent=message(e);else toast(message(e))}}
function download(data:string,name:string){const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportWorkspace(){capture();download(JSON.stringify(workspace,null,2),'souffle-sauvegarde.json')}
async function restore(){const file=$<HTMLInputElement>('#backup-input').files?.[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('Sauvegarde trop volumineuse.');const restored=migrate(JSON.parse(await file.text()));mutate(()=>workspace.projects.push(...copyProjects(restored.projects)));toast('Projets ajoutés à la bibliothèque.');page='library';render()}catch(e){toast(message(e))}}
function openReader(){capture();const s=activeScript()!;if(!store(false))return;try{const previous=JSON.parse(localStorage.getItem('souffle.reader.v1')||'null');let remembered=null;try{remembered=JSON.parse(localStorage.getItem('souffle.reader.settings.v1.'+scope)||'null')}catch{}const settings=remembered&&typeof remembered==='object'?{...workspace.settings,...remembered}:previous?.workspaceKey===scope&&previous.settings?{...workspace.settings,...previous.settings}:workspace.settings;localStorage.setItem('souffle.reader.v1',JSON.stringify({title:s.title,html:editor!.getHTML(),settings,workspaceKey:scope,startBlockId:readingStart?.scriptId===s.id?readingStart.blockId:undefined}));window.location.assign('/lecteur.html')}catch{toast('Impossible de préparer la lecture. Exporte une sauvegarde.')}}

function authView(){
 editor?.destroy();editor=undefined;const title='Se connecter'
 const siteKey=import.meta.env.VITE_TURNSTILE_SITE_KEY||''
 app.innerHTML=`<main class="auth-page"><a class="brand" href="#">souffle<span class="brand-dot">.</span></a><section class="auth-card"><h1>${title}</h1><p>Retrouve tes projets sur tes appareils.</p>${authRequired&&!cloud?'<div class="setup-note"><strong>Connexion temporairement indisponible</strong><p>La connexion sécurisée n’est pas configurée. Réessaie plus tard.</p></div>':''}<form id="auth-form"><label>Adresse courriel<input id="auth-email" type="email" autocomplete="email" required></label><label>Mot de passe<input id="auth-password" type="password" minlength="8" autocomplete="current-password" required></label>${siteKey?'<div id="turnstile-widget" class="turnstile-widget"></div>':''}<p id="auth-message" class="${authError?'form-error':'form-message'}" role="status">${esc(authMessage)}</p><button class="button primary" ${!cloud||authBusy||!!siteKey?'disabled':''}>${authBusy?'En cours…':title}</button></form>${!authRequired?'<div class="auth-links"><a href="#">Continuer sur cet appareil</a></div>':''}</section></main>`
 let captchaToken=''
 const renderCaptcha=()=>{const api=(window as any).turnstile,el=document.querySelector('#turnstile-widget');if(!siteKey||!api||!el)return;api.render(el,{sitekey:siteKey,callback:(token:string)=>{captchaToken=token;const button=document.querySelector<HTMLButtonElement>('#auth-form button');if(button)button.disabled=false},'expired-callback':()=>{captchaToken='';const button=document.querySelector<HTMLButtonElement>('#auth-form button');if(button)button.disabled=true},'error-callback':()=>{captchaToken='';const node=document.querySelector<HTMLElement>('#auth-message');if(node){node.textContent='La vérification anti-robot a échoué. Réessaie.';node.className='form-error'}}})}
 if(siteKey){if(!(window as any).turnstile){const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.onload=renderCaptcha;document.head.append(script)}else renderCaptcha()}
 $('#auth-form').onsubmit=async e=>{e.preventDefault();if(!cloud||authBusy||siteKey&&!captchaToken)return;const email=$<HTMLInputElement>('#auth-email').value,password=$<HTMLInputElement>('#auth-password').value;authBusy=true;const submit=$<HTMLButtonElement>('#auth-form button');submit.disabled=true;submit.textContent='En cours…';try{const {error}=await cloud.auth.signInWithPassword({email,password,options:captchaToken?{captchaToken}:{}});if(error)throw error;authError=false;authMessage='';window.location.hash='';await switchAccount((await cloud.auth.getUser()).data.user)}catch(e){authError=true;authMessage=message(e);$('#auth-message').textContent=authMessage;$('#auth-message').className='form-error'}finally{authBusy=false;if(document.body.contains(submit)){submit.textContent=title;submit.disabled=!cloud||!!siteKey;if(siteKey&&(window as any).turnstile){captchaToken='';try{(window as any).turnstile.reset()}catch{}}}}}
}
function showAccount(){
 if(!user){location.hash='connexion';return}
 let conflictBackup:string|null=null;try{conflictBackup=localStorage.getItem(`souffle.conflict.backup.${user.id}`)}catch{}
 dialog('Mon compte',`<p>${esc(user.email||'Compte connecté')}</p><p class="muted">${esc(cloudStatus||'Connecté')}</p><div class="action-list"><button id="sync-now">Synchroniser maintenant</button><button id="import-local">Importer mes projets de cet appareil</button>${conflictBackup?'<button id="download-conflict-backup">Télécharger le brouillon précédent</button>':''}<button id="change-password">Changer mon mot de passe</button><button id="logout" class="danger">Se déconnecter</button></div><p id="account-message" role="status"></p>`)
 $('#sync-now').onclick=()=>{flush();void synchronize().then(()=>$('#account-message').textContent=cloudStatus)}
 const downloadBackup=document.querySelector<HTMLButtonElement>('#download-conflict-backup');if(downloadBackup)downloadBackup.onclick=()=>{try{const saved=JSON.parse(conflictBackup!);if(!validateWorkspace(saved.workspace))throw new Error('Sauvegarde illisible.');download(JSON.stringify(saved.workspace,null,2),'souffle-brouillon-precedent.json')}catch(e){$('#account-message').textContent=message(e)}}
 $('#import-local').onclick=()=>{try{const raw=localStorage.getItem('souffle.workspace.v2.local');const data=raw?JSON.parse(raw).workspace:migrate(JSON.parse(localStorage.getItem('souffle.workspace.v1')||'null'));if(!validateWorkspace(data))throw new Error('Aucun projet local à importer.');const marker=`souffle.imported.${user!.id}`;if(localStorage.getItem(marker))throw new Error('Les projets locaux ont déjà été importés. Utilise Restaurer pour importer une autre sauvegarde.');workspace.projects.push(...copyProjects(data.projects));if(store()){localStorage.setItem(marker,'1');render();toast('Projets locaux copiés dans ton compte.')}}catch(e){$('#account-message').textContent=message(e)}}
 $('#change-password').onclick=()=>{
  $<HTMLDialogElement>('#dialog').close()
  dialog('Changer mon mot de passe',`<form id="password-form"><p>Choisis un mot de passe unique d’au moins 12 caractères.</p><label>Nouveau mot de passe<input id="new-password" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirmer le mot de passe<input id="confirm-password" type="password" autocomplete="new-password" minlength="12" required></label><p id="password-message" role="status"></p><button class="button primary" type="submit">Enregistrer</button></form>`)
  $('#password-form').onsubmit=async event=>{event.preventDefault();const password=$<HTMLInputElement>('#new-password').value,confirmation=$<HTMLInputElement>('#confirm-password').value,feedback=$('#password-message'),button=$<HTMLButtonElement>('#password-form button');if(password!==confirmation){feedback.textContent='Les mots de passe ne correspondent pas.';return}button.disabled=true;try{const {error}=await cloud!.auth.updateUser({password});if(error)throw error;feedback.textContent='Mot de passe enregistré.';$<HTMLFormElement>('#password-form').reset()}catch(error){feedback.textContent=message(error)}finally{button.disabled=false}}
 }
 $('#logout').onclick=async()=>{flush();const {error}=await cloud!.auth.signOut();if(error){$('#account-message').textContent=error.message;return}try{localStorage.removeItem('souffle.remote.reader.v1')}catch{}await switchAccount(null)}
}
async function switchAccount(next:User|null){
 if(user?.id===next?.id)return
 flush();generation++;const mine=generation;changingAccount=true;try{localStorage.removeItem('souffle.reader.v1')}catch{}user=next;scope=next?`souffle.workspace.v2.${next.id}`:'souffle.workspace.v2.local';conflict=false;remoteConflict=null;storageError=false;workspace=empty();baseRevision=0;dirty=false;cloudStatus='Chargement…'
 try{loadLocal();if(next){const remote=await fetchWorkspace(next.id);if(mine!==generation)return;if(remote){if(!validateWorkspace(remote.data))throw new Error('Données cloud invalides.');if(dirty&&baseRevision!==remote.revision){if(sameDocuments(workspace,remote.data)){const merged=reconcileEquivalent(workspace,remote.data);workspace=merged.workspace;baseRevision=remote.revision;dirty=merged.changed}else{conflict=true;remoteConflict=remote}}else if(!dirty){workspace=remote.data;baseRevision=remote.revision}}cloudStatus=dirty?'Modifications locales':'Synchronisé'}}catch(e){cloudStatus='Cloud indisponible · brouillon local';notice=message(e)}finally{if(mine===generation){changingAccount=false;store(false);page='library';route()}}
}
function route(){const hash=location.hash.slice(1);if(authRequired&&(!authLoaded||!user)){authView();return}if(hash==='connexion'&&!user)authView();else render()}
window.addEventListener('hashchange',()=>{authMessage='';authError=false;route()})
window.addEventListener('beforeunload',()=>{if(!authRequired||user)flush()});window.addEventListener('online',()=>{cloudStatus=dirty?'Connexion rétablie · synchroniser':'Synchronisé';status()});window.addEventListener('offline',()=>{cloudStatus='Hors connexion · brouillon local';status()})
window.addEventListener('storage',e=>{
 if(e.key!==scope||e.newValue===lastStored)return
 try{
  const incoming=e.newValue?JSON.parse(e.newValue) as Envelope:null
  if(incoming&&validateWorkspace(incoming.workspace)){
   if(sameDocuments(workspace,incoming.workspace)){const merged=reconcileEquivalent(workspace,incoming.workspace);workspace=merged.workspace;baseRevision=Math.max(baseRevision,incoming.baseRevision||0);dirty=dirty||merged.changed;lastStored=e.newValue;if(!dirty&&incoming.dirty)store(false);render();return}
   if(!dirty){workspace=incoming.workspace;baseRevision=incoming.baseRevision||0;dirty=incoming.dirty===true;lastStored=e.newValue;render();return}
  }
 }catch{}
 conflict=true;editor?.setEditable(false);renderConflict()
})
const narrowViewport=window.matchMedia('(max-width:850px)')
const onNarrowViewport=(event:MediaQueryListEvent|MediaQueryList)=>{if(event.matches&&!collapsed){if(document.querySelector('.workbench'))toggleMenu(true);else collapsed=true}}
if(narrowViewport.addEventListener)narrowViewport.addEventListener('change',onNarrowViewport)
else narrowViewport.addListener(onNarrowViewport)
if(innerWidth<=850)collapsed=true
if(!authRequired)store(false)
route()
if(cloud){void cloud.auth.getSession().then(({data})=>{authLoaded=true;void switchAccount(data.session?.user||null);if(!data.session?.user)route()}).catch(()=>{authLoaded=true;route()});cloud.auth.onAuthStateChange((event,session)=>{window.setTimeout(()=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT'){authLoaded=true;void switchAccount(session?.user||null)}},0)})}

function joinProjectReader(){
 if(!cloud||!user){toast('Connecte-toi avant de rejoindre une lecture.');return}
 const d=dialog('Rejoindre une lecture',`<p>Sur l’appareil qui contrôle la lecture, ouvre un projet et choisis « Télécommande ». Saisis ici son code à six chiffres.</p><form id="pair-form"><label for="pair-code">Code du projet<input id="pair-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required placeholder="000000"></label><div class="dialog-actions"><button class="button primary">Ouvrir le lecteur</button></div></form><p id="pair-error" class="form-error" role="alert"></p>`)
 const input=d.querySelector<HTMLInputElement>('#pair-code')!,button=d.querySelector<HTMLButtonElement>('#pair-form button')!,error=d.querySelector<HTMLElement>('#pair-error')!
 d.querySelector<HTMLFormElement>('#pair-form')!.onsubmit=async event=>{
  event.preventDefault();const code=input.value.trim();if(!/^[0-9]{6}$/.test(code)){error.textContent='Saisis les six chiffres du code.';return}
  button.disabled=true;error.textContent=''
  try{
   const {data,error:joinError}=await cloud!.rpc('join_project_reading_session',{p_pair_code:code})
   if(joinError)throw joinError
   if(data?.error==='limited')throw new Error('Trop d’essais. Réessaie dans dix minutes.')
   if(data?.error||!/^[a-f0-9]{64}$/.test(data?.token||''))throw new Error('Code invalide ou session terminée.')
   localStorage.setItem('souffle.remote.reader.v1',JSON.stringify({server:cloudUrl,key:cloudKey,token:data.token}))
   d.close();window.location.assign('/lecteur.html#paired')
  }catch(e){error.textContent=message(e);button.disabled=false}
 }
 input.focus()
}
async function remoteDialog(s:Script){
 if(!cloud||!user){dialog('Télécommande','<p>Connecte ton compte Supabase pour associer un appareil à une session.</p><a class="button primary" href="#connexion">Se connecter</a>');return}
 const project=activeProject()!
 capture();if(!store(false))return
 const html=editor!.getHTML()
 const blocks=Array.from(editor!.view.dom.querySelectorAll<HTMLElement>('p,h1,h2,h3')).filter(node=>node.dataset.id)
 const d=dialog('Télécommande',`<div class="remote-intro" id="remote-intro"><p>Préparation du code pour le projet <strong>${esc(project.name)}</strong>…</p><button id="create-session" class="button primary" hidden>Réessayer</button></div><div id="remote-content" hidden></div><p id="remote-message" role="status" aria-live="polite"></p>`)
 d.classList.add('remote-stage')
 const within=<T extends HTMLElement>(selector:string)=>d.querySelector<T>(selector)!
 const feedback=within<HTMLElement>('#remote-message')
 if(!d.open)return
 within<HTMLButtonElement>('#create-session').onclick=async()=>{
  const createButton=within<HTMLButtonElement>('#create-session')
  createButton.disabled=true
  try{
   const {data,error}=await cloud!.rpc('create_project_reading_session',{p_project_id:project.id,p_script_id:s.id,p_snapshot:{title:s.title,html,revision:s.revision,settings:workspace.settings,scriptId:s.id}})
   if(error)throw error
   if(!d.open)return
   const sessionId=data.id as string
   const code=data.code as string
   if(data.scriptId!==s.id){const switched=await cloud!.rpc('switch_project_reading_script',{p_session_id:sessionId,p_script_id:s.id,p_snapshot:{title:s.title,html,revision:s.revision,settings:workspace.settings,scriptId:s.id}});if(switched.error)throw switched.error;data.sequence=switched.data}
   if(!d.open)return
   let sequence=Number(data.sequence||0),busy=false
   const content=within<HTMLElement>('#remote-content')
   content.hidden=false
   within<HTMLElement>('#remote-intro').hidden=true
   content.innerHTML=`<div class="remote-stage-top"><span class="remote-kicker">PROJET EN COURS</span><strong>${esc(project.name)}</strong></div>
     <div class="remote-connection"><label class="remote-script-choice">Script<select id="remote-script">${project.scripts.filter(item=>!item.deletedAt).map(item=>`<option value="${esc(item.id)}" ${item.id===s.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select></label><span id="remote-status" class="remote-status" role="status" title="Lecteur en attente">Lecteur en attente</span></div></div>
    <div class="remote-preview-shell"><div class="remote-preview-head"><div><strong>Aperçu du lecteur</strong><span>Fais défiler le texte ou choisis un passage pour la reprise.</span></div><label>Position<select id="remote-position"><option value="">Début du script</option>${blocks.map(node=>`<option value="${esc(node.dataset.id!)}">${esc((node.textContent||'Paragraphe').slice(0,70))}</option>`).join('')}</select></label></div><div id="remote-preview" class="remote-preview" tabindex="0" aria-label="Aperçu du script et choix du passage"><article id="remote-preview-content">${html}</article></div></div>
     <div class="remote-console" id="remote-console"><div class="remote-mini"><button id="remote-mini-play" class="button primary" aria-label="Lancer la lecture">▷ Lire</button><button id="remote-expand" class="button secondary" aria-expanded="false">⌃ Réglages</button></div><div class="remote-console-body"><div class="remote-console-head"><strong>Lecture</strong><span>Choisis le passage, puis lance la lecture sur l’iPad.</span></div><div class="remote-primary-controls"><div class="remote-field"><span>Vitesse</span><div class="remote-stepper"><button id="remote-speed-minus" aria-label="Diminuer la vitesse">−</button><input id="remote-speed" aria-label="Vitesse en pixels par seconde" type="number" inputmode="numeric" min="5" max="120" value="${workspace.settings.speed}"><small>px/s</small><button id="remote-speed-plus" aria-label="Augmenter la vitesse">+</button></div><input id="remote-speed-range" type="range" min="5" max="120" value="${workspace.settings.speed}" aria-label="Régler la vitesse"></div><div class="remote-transport"><button id="remote-pause" class="button secondary">Ⅱ Pause</button><button id="remote-seek" class="button secondary">Aller ici</button><button id="remote-play" class="button primary">▷ Lire</button></div></div>
     <details class="remote-more"><summary>••• Réglages et code iPad</summary><details class="remote-pairing"><summary>Associer l’iPad <span>· Voir le code</span></summary><div class="remote-pairing-content"><div class="remote-pair-code"><span>Code pour rejoindre sur l’iPad</span><strong>${esc(code)}</strong><small>Même compte · session de deux heures</small></div><button id="revoke-session" class="remote-text-button">Terminer la session</button></div></details><div class="remote-control-grid"><section class="remote-control-section"><h3>Décompte</h3><label class="remote-field">Décompte<select id="remote-countdown"><option value="0">Aucun</option><option value="3">3 s</option><option value="5">5 s</option><option value="10">10 s</option></select></label></section>
     <section class="remote-control-section"><h3>Texte</h3><div class="remote-field-grid"><div class="remote-field"><span>Taille du texte</span><div class="remote-stepper"><button id="remote-size-minus" aria-label="Diminuer la taille du texte">−</button><input id="remote-size" aria-label="Taille du texte en pixels" type="number" inputmode="numeric" min="28" max="100" value="${workspace.settings.size}"><small>px</small><button id="remote-size-plus" aria-label="Augmenter la taille du texte">+</button></div></div><label class="remote-field">Police<select id="remote-font"><option value="sans-serif">Sans sérif</option><option value="Georgia">Georgia</option><option value="original">Polices du document</option></select></label></div><label class="remote-check"><input id="remote-proportional" type="checkbox"> Tailles relatives du script</label></section>
     <section class="remote-control-section"><h3>Affichage</h3><span class="remote-field-caption">Miroirs</span><div class="remote-mirrors"><button id="remote-mirror-x" type="button" aria-pressed="false">↔ Horizontal</button><button id="remote-mirror-y" type="button" aria-pressed="false">↕ Vertical</button></div></section>
    </div><div class="remote-console-footer"><button id="remote-apply-settings" class="button secondary">Appliquer les réglages</button><span>Taille, police, décompte et miroirs.</span></div></details></div></div>`
   within<HTMLSelectElement>('#remote-script').onchange=async event=>{
    const picker=event.currentTarget as HTMLSelectElement
    const target=project.scripts.find(item=>item.id===picker.value&&!item.deletedAt)
    if(!target||target.id===s.id)return
    picker.disabled=true;feedback.textContent='Chargement du script sur l’iPad…'
    try{
     const nextHtml=generateHTML(target.content,extensions())
     const {data:nextSequence,error:switchError}=await cloud!.rpc('switch_project_reading_script',{p_session_id:sessionId,p_script_id:target.id,p_snapshot:{title:target.title,html:nextHtml,revision:target.revision,settings:workspace.settings,scriptId:target.id}})
     if(switchError)throw switchError
     sequence=Number(nextSequence)||sequence;s=target
     previewContent.innerHTML=nextHtml
     position.innerHTML='<option value="">Début du script</option>'+Array.from(previewContent.querySelectorAll<HTMLElement>('[data-id]')).map(node=>`<option value="${esc(node.dataset.id!)}">${esc((node.textContent||'Paragraphe').slice(0,70))}</option>`).join('')
     position.value='';preview.scrollTop=0;syncPreview();markPosition()
     remotePlaying=false;showPlayState();picker.disabled=false
     feedback.textContent='Script envoyé sur l’iPad · même code de connexion.'
    }catch(e){feedback.textContent=message(e);picker.disabled=false;picker.value=s.id}
   }
   const speed=within<HTMLInputElement>('#remote-speed'),speedRange=within<HTMLInputElement>('#remote-speed-range')
   const size=within<HTMLInputElement>('#remote-size'),position=within<HTMLSelectElement>('#remote-position')
   const preview=within<HTMLElement>('#remote-preview'),previewContent=within<HTMLElement>('#remote-preview-content')
   const consolePanel=within<HTMLElement>('#remote-console'),expand=within<HTMLButtonElement>('#remote-expand'),miniPlay=within<HTMLButtonElement>('#remote-mini-play')
   if(window.matchMedia('(max-width: 600px)').matches){consolePanel.classList.add('is-collapsed');within<HTMLElement>('.remote-console-body').prepend(within<HTMLElement>('.remote-preview-head label'))}
   expand.onclick=()=>{const collapsed=consolePanel.classList.toggle('is-collapsed');expand.setAttribute('aria-expanded',String(!collapsed));expand.textContent=collapsed?'⌃ Réglages':'⌄ Replier'}
   const countdown=within<HTMLSelectElement>('#remote-countdown'),font=within<HTMLSelectElement>('#remote-font')
   const mirrorX=within<HTMLButtonElement>('#remote-mirror-x'),mirrorY=within<HTMLButtonElement>('#remote-mirror-y')
   const proportional=within<HTMLInputElement>('#remote-proportional')
   countdown.value=String(workspace.settings.countdown);font.value=workspace.settings.font
   proportional.checked=workspace.settings.proportional
   mirrorX.setAttribute('aria-pressed',String(workspace.settings.mirrorX))
   mirrorY.setAttribute('aria-pressed',String(workspace.settings.mirrorY))
   position.value=readingStart?.scriptId===s.id?readingStart.blockId:''
   const clamp=(value:number,min:number,max:number,fallback:number)=>Math.round(Math.max(min,Math.min(max,Number.isFinite(value)?value:fallback)))
   const syncSpeed=()=>{speed.value=String(clamp(Number(speed.value),5,120,35));speedRange.value=speed.value}
   const syncSize=()=>{size.value=String(clamp(Number(size.value),28,100,54));previewContent.style.fontSize=`${window.matchMedia('(max-width: 600px)').matches?clamp(Number(size.value)*.62,20,64,34):size.value}px`}
   const syncPreview=()=>{syncSize();previewContent.style.fontFamily=font.value==='Georgia'?'Georgia,serif':font.value==='original'?'inherit':'Arial,Helvetica,sans-serif';previewContent.classList.toggle('remote-proportional',proportional.checked);previewContent.style.transform=`scale(${mirrorX.getAttribute('aria-pressed')==='true'?-1:1},${mirrorY.getAttribute('aria-pressed')==='true'?-1:1})`}
   const markPosition=()=>{previewContent.querySelectorAll<HTMLElement>('.remote-selected').forEach(node=>node.classList.remove('remote-selected'));if(position.value)Array.from(previewContent.querySelectorAll<HTMLElement>('[data-id]')).find(node=>node.dataset.id===position.value)?.classList.add('remote-selected')}
   syncSpeed();syncPreview();markPosition()
   if(position.value)previewContent.querySelector<HTMLElement>(`[data-id="${CSS.escape(position.value)}"]`)?.scrollIntoView({block:'center'})
   speed.onchange=syncSpeed
   speedRange.oninput=()=>{speed.value=speedRange.value}
   speedRange.onchange=()=>void command('speed')
   within<HTMLButtonElement>('#remote-speed-minus').onclick=()=>{speed.value=String(clamp(Number(speed.value)-1,5,120,35));syncSpeed();void command('speed')}
   within<HTMLButtonElement>('#remote-speed-plus').onclick=()=>{speed.value=String(clamp(Number(speed.value)+1,5,120,35));syncSpeed();void command('speed')}
   size.onchange=syncPreview
   within<HTMLButtonElement>('#remote-size-minus').onclick=()=>{size.value=String(clamp(Number(size.value)-1,28,100,54));syncPreview()}
   within<HTMLButtonElement>('#remote-size-plus').onclick=()=>{size.value=String(clamp(Number(size.value)+1,28,100,54));syncPreview()}
   font.onchange=syncPreview;proportional.onchange=syncPreview
   ;[mirrorX,mirrorY].forEach(button=>button.onclick=()=>{button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));syncPreview()})
   position.onchange=()=>{markPosition();if(position.value)previewContent.querySelector<HTMLElement>(`[data-id="${CSS.escape(position.value)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});else preview.scrollTo({top:0,behavior:'smooth'})}
   const selectTappedBlock=(target:EventTarget|null)=>{const block=(target as HTMLElement).closest<HTMLElement>('[data-id]');if(block?.dataset.id){position.value=block.dataset.id;markPosition()}}
   let lastTouch=0,touchStart:{x:number,y:number,at:number}|null=null
   preview.addEventListener('touchstart',event=>{if(event.touches.length===1)touchStart={x:event.touches[0].clientX,y:event.touches[0].clientY,at:Date.now()};else touchStart=null},{passive:true})
   preview.addEventListener('touchmove',event=>{if(!touchStart||!event.touches.length)return;if(Math.abs(event.touches[0].clientX-touchStart.x)>=12||Math.abs(event.touches[0].clientY-touchStart.y)>=12)touchStart=null},{passive:true})
   preview.addEventListener('touchcancel',()=>{touchStart=null},{passive:true})
   preview.addEventListener('touchend',event=>{if(!touchStart||!event.changedTouches.length)return;const end=event.changedTouches[0];const tapped=Math.abs(end.clientX-touchStart.x)<12&&Math.abs(end.clientY-touchStart.y)<12&&Date.now()-touchStart.at<650;touchStart=null;if(!tapped)return;lastTouch=Date.now();event.preventDefault();selectTappedBlock(event.target);void command(remotePlaying?'pause':'play')},{passive:false})
   preview.onclick=event=>{if(Date.now()-lastTouch<650)return;selectTappedBlock(event.target);if(window.matchMedia('(max-width: 600px)').matches)void command(remotePlaying?'pause':'play')}
   preview.addEventListener('scroll',()=>{
    if(preview.scrollTop<16){if(position.value){position.value='';markPosition()}return}
    const line=preview.getBoundingClientRect().top+preview.clientHeight*.52
    let current:HTMLElement|null=null
    for(const block of previewContent.querySelectorAll<HTMLElement>('[data-id]')){
     if(block.getBoundingClientRect().top>line)break
     current=block
    }
    if(current?.dataset.id&&position.value!==current.dataset.id){position.value=current.dataset.id;markPosition()}
   },{passive:true})
   let remotePlaying=false
   const showPlayState=()=>{miniPlay.textContent=remotePlaying?'Ⅱ Pause':'▷ Lire';miniPlay.setAttribute('aria-label',remotePlaying?'Mettre en pause':'Lancer la lecture')}
   const command=async(action:string)=>{
    if(busy)return
    busy=true
    try{
     syncSpeed();syncPreview()
     const settings={speed:Number(speed.value),countdown:Number(countdown.value),size:Number(size.value),font:font.value,mirrorX:mirrorX.getAttribute('aria-pressed')==='true',mirrorY:mirrorY.getAttribute('aria-pressed')==='true',proportional:proportional.checked}
     const {data:result,error:sendError}=await cloud!.rpc('send_reading_command',{session_id:sessionId,expected_sequence:sequence,command:{action,blockId:position.value,speed:settings.speed,countdown:settings.countdown,settings}})
     if(sendError)throw sendError
     if(result.conflict)throw new Error('La session a changé. Réessaie après sa mise à jour.')
     sequence=result.sequence
     if(action==='play'||action==='pause'){remotePlaying=action==='play';showPlayState()}
     feedback.textContent='Commande envoyée · confirmation en attente.'
    }catch(e){feedback.textContent=message(e)}finally{busy=false}
   }
   miniPlay.onclick=()=>void command(remotePlaying?'pause':'play')
   within<HTMLButtonElement>('#remote-pause').onclick=()=>void command('pause')
   within<HTMLButtonElement>('#remote-seek').onclick=()=>void command('seek')
   within<HTMLButtonElement>('#remote-play').onclick=()=>void command('play')
   within<HTMLButtonElement>('#remote-apply-settings').onclick=()=>void command('settings')
   within<HTMLButtonElement>('#revoke-session').onclick=async()=>{const {error:revokeError}=await cloud!.rpc('revoke_reading_session',{session_id:sessionId});if(revokeError){feedback.textContent=revokeError.message;return}d.close();toast('Session terminée.')}
   remotePoll=window.setInterval(async()=>{
    if(document.hidden||!d.open)return
    const {data:state,error:pollError}=await cloud!.from('reading_sessions').select('sequence,ack_sequence,last_seen,reader_state,revoked').eq('id',sessionId).single()
    if(!d.open)return
    const status=within<HTMLElement>('#remote-status')
    if(pollError){status.textContent='Connexion interrompue';return}
    sequence=state.sequence
    if(state.ack_sequence===state.sequence&&(state.reader_state==='playing'||state.reader_state==='paused')){remotePlaying=state.reader_state==='playing';showPlayState()}
    const connected=state.last_seen&&Date.now()-new Date(state.last_seen).getTime()<15000
    status.textContent=state.revoked?'Session terminée':!connected?'Lecteur déconnecté ou en attente':state.ack_sequence===state.sequence?`Connecté · ${state.reader_state==='playing'?'lecture':state.reader_state==='countdown'?'décompte':'en pause'}`:'Connecté · commande en attente'
    status.classList.toggle('connected',!!connected&&!state.revoked)
    status.title=status.textContent||''
   },5000)
  }catch(e){feedback.textContent=message(e);createButton.disabled=false;createButton.hidden=false}
 }
 within<HTMLButtonElement>('#create-session').click()
}
