import test from 'node:test';
import assert from 'node:assert/strict';
import {memberForClient,AccessError} from '../lib/access';
test('fresh user validation and RLS membership run together and both must pass',async()=>{
  let authStarted=false,memberStarted=false,user:any={id:'owner'},member:any={user_id:'owner'},authError:any=null,memberError:any=null;
  const db={auth:{async getUser(){authStarted=true;await Promise.resolve();assert.ok(memberStarted);return {data:{user},error:authError};}},from(table:string){assert.equal(table,'ff_members');return {select(columns:string){assert.equal(columns,'user_id');return {async maybeSingle(){memberStarted=true;assert.ok(authStarted);return {data:member,error:memberError};}};}};}} as unknown as Parameters<typeof memberForClient>[0];
  assert.equal((await memberForClient(db)).user.id,'owner');
  member=null;await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===403);
  member={user_id:'another-user'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===403);
  memberError={message:'Unavailable'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===503);
  user=null;authError={message:'Revoked'};await assert.rejects(()=>memberForClient(db),(e)=>e instanceof AccessError&&e.status===401);
});
