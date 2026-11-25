import test from 'node:test';
import assert from 'node:assert/strict';
import {memberForClient,readForMember,AccessError} from '../lib/access';
test('fresh user validation and RLS membership run together and both must pass',async()=>{
  let authStarted=false,memberStarted=false,user:any={id:'owner'},member:any={user_id:'owner'},authError:any=null,memberError:any=null;
  const db={auth:{async getUser(){authStarted=true;await Promise.resolve();assert.ok(memberStarted);return {data:{user},error:authError};}},from(table:string){assert.equal(table,'ff_members');return {select(columns:string){assert.equal(columns,'user_id');return {async maybeSingle(){memberStarted=true;assert.ok(authStarted);return {data:member,error:memberError};}};}};}} as unknown as Parameters<typeof memberForClient>[0];
  assert.equal((await memberForClient(db)).user.id,'owner');
  member=null;await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===403);
  member={user_id:'another-user'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===403);
  memberError={message:'Unavailable'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===503);
  user=null;authError={message:'Revoked'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===401);
});
test('a read overlaps member verification but is released only to a verified member',async()=>{
  let user:any={id:'owner'},member:any={user_id:'owner'},readStarted=false;
  const db={auth:{async getUser(){await Promise.resolve();assert.ok(readStarted,'the read starts before verification finishes');return {data:{user},error:user?null:{message:'Revoked'}};}},from(){return {select(){return {async maybeSingle(){return {data:member,error:null};}};}};}} as unknown as Parameters<typeof readForMember>[0];
  const read=(result:()=>Promise<string>)=>()=>{readStarted=true;return result();};
  assert.equal(await readForMember(db,read(async()=>'rows')),'rows');
  await assert.rejects(()=>readForMember(db,read(async()=>{throw new Error('storage');})),/storage/);
  member=null;
  await assert.rejects(()=>readForMember(db,read(async()=>'rows')),(e)=>e instanceof AccessError&&e.status===403);
  await assert.rejects(()=>readForMember(db,read(async()=>{throw new Error('storage');})),(e)=>e instanceof AccessError&&e.status===403);
  user=null;
  await assert.rejects(()=>readForMember(db,read(async()=>'rows')),(e)=>e instanceof AccessError&&e.status===401);
});
