import type { JSONContent } from '@tiptap/core'
export type Version = { id: string; at: number; title: string; content: JSONContent }
export type Script = { id: string; title: string; content: JSONContent; updated: number; revision: number; deletedAt?: number; versions: Version[] }
export type Project = { id: string; name: string; scripts: Script[]; deletedAt?: number }
export type Settings = { size: number; speed: number; countdown: number; mirrorX: boolean; mirrorY: boolean; proportional: boolean; font: string }
export type Workspace = { schemaVersion: 2; projects: Project[]; settings: Settings; selectedProject?: string; selectedScript?: string }
export const defaults: Settings = { size:54,speed:35,countdown:3,mirrorX:false,mirrorY:false,proportional:true,font:'sans-serif' }
export const uid = () => {
 if (crypto.randomUUID) return crypto.randomUUID()
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
export function blockIds(node: JSONContent, fresh = false, seen = new Set<string>()): JSONContent {
 const copy = structuredClone(node)
 function visit(n: JSONContent) { if (['paragraph','heading','listItem'].includes(n.type || '')) { const id = n.attrs?.id; n.attrs = { ...n.attrs, id: !fresh && typeof id === 'string' && !seen.has(id) ? id : uid() }; seen.add(n.attrs.id) } n.content?.forEach(visit) }
 visit(copy); return copy
}
export function validateWorkspace(value: unknown): value is Workspace {
 const w = value as Workspace
 function validNode(n: JSONContent, depth = 0): boolean { return !!n && depth < 50 && typeof n.type === 'string' && (!n.text || typeof n.text === 'string') && (!n.content || (Array.isArray(n.content) && n.content.every(c => validNode(c,depth+1)))) }
 return !!w && w.schemaVersion === 2 && Array.isArray(w.projects) && w.projects.every(p => typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.scripts) && p.scripts.every(s => typeof s.id === 'string' && typeof s.title === 'string' && s.content?.type === 'doc' && validNode(s.content) && Array.isArray(s.versions) && s.versions.every(v => typeof v.id === 'string' && typeof v.title === 'string' && Number.isFinite(v.at) && v.content?.type === 'doc' && validNode(v.content)))) && !!w.settings
}
export function snapshot(script: Script) {
 const last = script.versions[script.versions.length-1]
 if (!last || JSON.stringify(last.content) !== JSON.stringify(script.content) || last.title !== script.title) script.versions.push({id:uid(),at:Date.now(),title:script.title,content:structuredClone(script.content)})
 script.versions = script.versions.slice(-30)
}
export function copyProjects(projects: Project[]) { return projects.map(p => ({...p,id:uid(),scripts:p.scripts.map(s => ({...s,id:uid(),content:blockIds(s.content,true),versions:[]}))})) }
