// Local integration fixture, never imported by application code.
import { createServer } from 'node:http';
import fs from 'node:fs';
import { MemoryStore } from './memory-store';
const owner='11111111-1111-4111-8111-111111111111';
export async function startMockSupabase(port:number) {
 const store=new MemoryStore(JSON.parse(fs.readFileSync('.local-migration/records.json','utf8')));
 const user={id:owner,aud:'authenticated',role:'authenticated',email:'owner@example.test',email_confirmed_at:'2026-11-10T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-11-10T00:00:00Z'};
 let memberAllowed=true;
 const tokens=new Set<string>(),calls:string[]=[];
 const token=(lifetime=3600)=>{const exp=Math.floor(Date.now()/1000)+lifetime;const t=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner,aud:'authenticated',role:'authenticated',exp,iat:exp-3600})).toString('base64url')+'.local-fixture-signature';tokens.add(t);return {access_token:t,refresh_token:'local-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://127.0.0.1:'+port);calls.push((req.method??'GET')+' '+url.pathname);const send=(data:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  if(url.pathname==='/auth/v1/token'){if(url.searchParams.get('grant_type')==='refresh_token'||body.email==='owner@example.test'&&body.password==='local-test-password'){send(token());}else send({message:'Invalid credentials'},400);return;}
  const bearer=req.headers.authorization?.replace('Bearer ','');if(!bearer||!tokens.has(bearer)){send({message:'Not authenticated'},401);return;}
  if(url.pathname==='/auth/v1/user'){send(user);return;}if(url.pathname==='/auth/v1/logout'){tokens.delete(bearer);send({});return;}
  if(url.pathname==='/rest/v1/ff_members'){send(memberAllowed?[{user_id:owner}]:[]);return;}
  if(url.pathname==='/rest/v1/ff_records'){
    let rows=[...store.records.values()];for(const key of ['id','kind']){const v=url.searchParams.get(key);if(v?.startsWith('eq.'))rows=rows.filter(r=>(r as any)[key]===v.slice(3));}
    rows.sort((a,b)=>a.id.localeCompare(b.id));const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??rows.length);send(rows.slice(offset,offset+limit));return;
  }
  if(url.pathname==='/rest/v1/rpc/ff_save_record'){
    try {await store.save(body.p_id,body.p_kind,body.p_payload,body.p_expected_version,body.p_dependency_id?{id:body.p_dependency_id,version:body.p_dependency_version} as any:undefined);send(null);}catch{send({code:'40001',message:'Record changed'},409);}return;
  }
  send({message:'Unexpected mock request'},404);
 });
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {store,calls,server,token,setMemberAllowed:(value:boolean)=>{memberAllowed=value;},close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
