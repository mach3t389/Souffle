import { createClient } from '@supabase/supabase-js'
import type { Workspace } from './model'
export const cloudUrl = import.meta.env.VITE_SUPABASE_URL || ''
export const cloudKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
export const cloud = cloudUrl && cloudKey ? createClient(cloudUrl,cloudKey) : null
export async function fetchWorkspace(owner: string) {
 if (!cloud) throw new Error('Supabase n’est pas configuré.')
 const {data,error} = await cloud.from('workspaces').select('data,revision').eq('owner_id',owner).maybeSingle()
 if(error) throw error
 return data as {data:Workspace;revision:number} | null
}
export async function saveWorkspace(data:Workspace,revision:number,owner:string) {
 if(!cloud) throw new Error('Supabase n’est pas configuré.')
 const result = await cloud.rpc('save_workspace',{payload:data,expected_revision:revision,expected_owner:owner})
 if(result.error) throw result.error
 return result.data as {revision:number;conflict:boolean}
}
