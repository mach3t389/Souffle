import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
const db=new PGlite({extensions:{pgcrypto}})
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222'
const payload={schemaVersion:2,projects:[],settings:{}}
before(async()=>{
 await db.exec(`create schema auth;create schema extensions;create role anon;create role authenticated;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`)
 for(const name of ['001_workspace.sql','002_reading_sessions.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'))
})
after(()=>db.close())
async function as(role,id,action){await db.exec(`set role ${role};set request.jwt.claim.sub='${id||''}';`);try{return await action()}finally{await db.exec('reset role;reset request.jwt.claim.sub;')}}
test('workspace creation, compare-and-swap, and owner isolation',async()=>{
 const save=rev=>db.query('select public.save_workspace($1,$2,$3) as result',[JSON.stringify(payload),rev,alice])
 await as('authenticated',alice,async()=>{
  assert.deepEqual((await save(0)).rows[0].result,{revision:1,conflict:false})
  assert.deepEqual((await save(0)).rows[0].result,{revision:1,conflict:true})
  assert.deepEqual((await save(1)).rows[0].result,{revision:2,conflict:false})
  await assert.rejects(db.query('update public.workspaces set revision=99'))
 })
 await as('authenticated',bob,async()=>{
  assert.equal((await db.query('select * from public.workspaces')).rows.length,0)
  await assert.rejects(save(2),/Authentication required/)
 })
 await as('anon',null,async()=>{await assert.rejects(save(2));await assert.rejects(db.query('select * from public.workspaces'))})
})
test('reading sessions: private snapshot, commands, acknowledgments, revocation',async()=>{
 let session
 await as('authenticated',alice,async()=>{
  session=(await db.query('select public.create_reading_session($1) as result',[JSON.stringify({html:'<p data-id="p1">Bonjour</p>',title:'Prise 1',settings:{}})])).rows[0].result
  assert.match(session.token,/^[a-f0-9]{64}$/)
  await assert.rejects(db.query('select snapshot,token_hash from public.reading_sessions'))
  const result=await db.query('select public.send_reading_command($1,0,$2) as result',[session.id,JSON.stringify({action:'play',blockId:'p1',speed:35,countdown:3})])
  assert.deepEqual(result.rows[0].result,{sequence:1,conflict:false})
  assert.equal((await db.query('select public.send_reading_command($1,0,$2) as result',[session.id,'{"action":"pause"}'])).rows[0].result.conflict,true)
 })
 await as('authenticated',bob,async()=>{assert.equal((await db.query('select id from public.reading_sessions')).rows.length,0);await assert.rejects(db.query('select public.send_reading_command($1,1,$2)',[session.id,'{"action":"pause"}']),/Session expired/)})
 await as('anon',null,async()=>{
  await assert.rejects(db.query('select * from public.reading_sessions'))
  const initial=(await db.query('select public.poll_reading_session($1,-1,$2,true) as result',[session.token,'paused'])).rows[0].result
  assert.equal(initial.snapshot.title,'Prise 1');assert.equal(initial.command.action,'play')
  const next=(await db.query('select public.poll_reading_session($1,1,$2,false) as result',[session.token,'playing'])).rows[0].result
  assert.equal(next.snapshot,null)
  await assert.rejects(db.query('select public.poll_reading_session($1,-1,$2,true)',['a'.repeat(64),'paused']),/Session expired/)
 })
 await as('authenticated',alice,async()=>{
  const state=(await db.query('select sequence,ack_sequence,reader_state from public.reading_sessions where id=$1',[session.id])).rows[0]
  assert.equal(state.ack_sequence,1);assert.equal(state.reader_state,'playing')
  await db.query('select public.revoke_reading_session($1)',[session.id])
 })
 await as('anon',null,async()=>{await assert.rejects(db.query('select public.poll_reading_session($1,1,$2,true)',[session.token,'paused']),/Session expired/)})
})
test('remote settings persist across reconnect and expired links are rejected',async()=>{
 let session
 await as('authenticated',alice,async()=>{
  session=(await db.query('select public.create_reading_session($1) as result',[JSON.stringify({html:'<p>Texte</p>',title:'Réglages',settings:{speed:35}})])).rows[0].result
  await assert.rejects(db.query('select public.send_reading_command($1,0,$2)',[session.id,'{}']),/Invalid command/)
  await db.query('select public.send_reading_command($1,0,$2)',[session.id,JSON.stringify({action:'settings',settings:{speed:45,size:60,mirrorX:true,mirrorY:false,font:'Georgia'}})])
 })
 await as('anon',null,async()=>{
  const state=(await db.query('select public.poll_reading_session($1,-1,$2,true) as result',[session.token,'paused'])).rows[0].result
  assert.equal(state.snapshot.settings.mirrorX,true);assert.equal(state.snapshot.settings.font,'Georgia')
 })
 await db.query("update public.reading_sessions set expires_at=now()-interval '1 second' where id=$1",[session.id])
 await as('anon',null,async()=>{await assert.rejects(db.query('select public.poll_reading_session($1,-1,$2,true)',[session.token,'paused']),/Session expired/)})
})
test('script replacement requires a connected, confirmed pause',async()=>{
 let session
 await as('authenticated',alice,async()=>{
  session=(await db.query('select public.create_reading_session($1) as result',[JSON.stringify({html:'<p>Avant</p>',title:'Avant',settings:{}})])).rows[0].result
  await assert.rejects(db.query('select public.update_reading_snapshot($1,$2)',[session.id,'{"html":"<p>Après</p>"}']),/pause/)
 })
 await as('anon',null,()=>db.query('select public.poll_reading_session($1,0,$2,true)',[session.token,'paused']))
 await as('authenticated',bob,async()=>{await assert.rejects(db.query('select public.update_reading_snapshot($1,$2)',[session.id,'{"html":"<p>Après</p>"}']),/pause/)})
 await as('authenticated',alice,async()=>{
  assert.equal((await db.query('select public.update_reading_snapshot($1,$2) as sequence',[session.id,'{"html":"<p>Après</p>","title":"Après","settings":{}}'])).rows[0].sequence,1)
 })
 await as('anon',null,async()=>{
  const state=(await db.query('select public.poll_reading_session($1,0,$2,false) as result',[session.token,'paused'])).rows[0].result
  assert.equal(state.command.action,'reload');assert.equal(state.snapshot.title,'Après')
  const ack=(await db.query('select public.poll_reading_session($1,1,$2,false) as result',[session.token,'paused'])).rows[0].result
  assert.equal(ack.snapshot,null)
 })
})
