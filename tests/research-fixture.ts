// Isolated HTTP fixture for browser checks. No real Supabase connection or database writes.
import { createServer } from 'node:http';
import { initial } from '../lib/domain/directory';
export async function startResearchFixture(port:number){
  const owner='11111111-1111-4111-8111-111111111111',calls:string[]=[],tokens=new Set<string>();
  const user={id:owner,aud:'authenticated',role:'authenticated',email:'owner@example.test',email_confirmed_at:'2026-11-10T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-11-10T00:00:00Z'};
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url!,'http://127.0.0.1').pathname;calls.push(`${req.method} ${path}`);
    const send=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(path==='/auth/v1/token'){
      const exp=Math.floor(Date.now()/1000)+3600,token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner,aud:'authenticated',role:'authenticated',exp})).toString('base64url')+'.fixture-signature';
      tokens.add(token);send({access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user});return;
    }
    if(!tokens.has(req.headers.authorization?.replace('Bearer ','')??'')){send({message:'Not authenticated'},401);return;}
    if(path==='/auth/v1/user'){send(user);return;}
    if(path==='/rest/v1/ff_members'){send([{user_id:owner}]);return;}
    if(path==='/rest/v1/ff_records'){send([{id:'directory',kind:'directory',version:1,payload:initial(),updated_at:new Date().toISOString()}]);return;}
    if(path==='/rest/v1/ff_research_templates'){send({code:'PGRST205',message:'Research schema is not installed.'},404);return;}
    send({message:'Unexpected fixture request'},400);
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,calls,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
