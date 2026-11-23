import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import next from 'next';
import { chromium, type Browser } from 'playwright';
import { startMockSupabase } from '../tests/mock-supabase';

const pilot = '11111111-1111-4111-8111-111111111111';
const exec = promisify(execFile);
const dbName = 'ff-orders-check-' + process.pid;
const mockPort = 54329;
const secret = 'local-orders-persistence-fixture';
const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
const checksum = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function postgres(sql: string) {
  return new Promise<string>((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',dbName,'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
      {stdio:['pipe','pipe','pipe']});
    let output='',error='';
    child.stdout.setEncoding('utf8').on('data',chunk=>output+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>error+=chunk);
    child.stdin.on('error',reject);
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(error.trim())));
    child.stdin.end(sql);
  });
}

async function reserve(server: ReturnType<typeof createServer>, port = 0) {
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function main() {
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');
  assert.ok(process.env.FINAL_FORE_ORDER_ARCHIVE_PATH);
  process.env.FINAL_FORE_ORDERS_ENABLED='1';
  process.env.FINAL_FORE_ORDERS_PILOT_USER_IDS=pilot;
  process.env.SUPABASE_SECRET_KEY=secret;
  let browser:Browser|undefined, mock:Awaited<ReturnType<typeof startMockSupabase>>|undefined;
  let app:ReturnType<typeof next>|undefined, container=false;
  const server=createServer();
  const storage=new Map<string,Buffer>();
  const supabase=createServer(async(req,res)=>{
    const path=new URL(req.url!,'http://localhost').pathname;
    const chunks:Buffer[]=[];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes=Buffer.concat(chunks);
    const json=(status:number,data:unknown)=>{
      res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
    };
    try {
      if (path.startsWith('/rest/v1/rpc/ff_order') || path.startsWith('/storage/v1/')) {
        if (req.headers.apikey !== secret) {json(403,{message:'Fixture requires service access'});return;}
        if (path.startsWith('/rest/v1/')) {
          const data = JSON.parse(bytes.toString());
          const rpc = path.split('/').at(-1);
          let sql;
          if (rpc==='ff_orders_detail' || rpc==='ff_order_calendar_detail') {
            sql=rpc+'('+quote(data.p_id)+'::uuid)';
          } else if (rpc==='ff_orders_workspace') {
            sql=rpc+'('+quote(data.p_client_id)+','+Number(data.p_year)+')';
          } else {
            assert.equal(rpc,'ff_orders_command');
            sql=rpc+'('+quote(data.p_actor_id)+'::uuid,'+quote(data.p_action)+','+quote(JSON.stringify(data.p_input))+'::jsonb)';
          }
          const value=await postgres('set role service_role;\n\\set VERBOSITY verbose\nselect coalesce(public.'+sql+',\'null\'::jsonb);\n');
          json(200,JSON.parse(value));return;
        }
        const prefix='/ff-order-pdfs/';
        const index=path.indexOf(prefix);
        if (index<0) {json(404,{message:'Unknown fixture bucket'});return;}
        const key=decodeURIComponent(path.slice(index+prefix.length));
        const existing=storage.get(key);
        if (req.method==='POST') {
          if (existing) {json(409,{statusCode:'409',message:'Object exists'});return;}
          storage.set(key,bytes);json(200,{Key:key});return;
        }
        if (!existing) {json(404,{statusCode:'404',message:'Object not found'});return;}
        if (path.startsWith('/storage/v1/object/info/')) {json(200,{name:key,size:existing.length});return;}
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':existing.length});res.end(existing);return;
      }
      const address=mock!.server.address();
      assert.ok(address && typeof address!=='string');
      const headers=new Headers();
      for (const [key,val] of Object.entries(req.headers)) if (key!=='host' && val!==undefined) headers.set(key,String(val));
      const passthrough=await fetch('http://127.0.0.1:'+address.port+req.url,{method:req.method,headers,
        ...(bytes.length ? {body:new Uint8Array(bytes)} : {})});
      res.writeHead(passthrough.status,{'Content-Type':passthrough.headers.get('Content-Type') ?? 'application/json'});
      res.end(Buffer.from(await passthrough.arrayBuffer()));
    } catch (error) {
      const message=error instanceof Error?error.message:'Fixture failure';
      const code=message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
      if (code) json(code==='PT409'?409:code==='PT404'?404:code==='42501'?403:400,
        {code,message:message.split('\n')[0]});
      else {console.error(message);json(500,{message:'Unexpected local fixture failure'});}
    }
  });
  try {
    await exec('docker',['run','--pull=never','--network','none','--rm','-d','--name',dbName,
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16']);
    container=true;
    for (let attempt=0;attempt<30;attempt++) {
      try {await exec('docker',['exec',dbName,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}
      catch(error) {if(attempt===29)throw error;await delay(300);}
    }
    await postgres(`create role anon;create role authenticated;create role service_role bypassrls;
      create table public.ff_members(user_id uuid primary key);
      insert into public.ff_members values ('${pilot}');
      grant select on public.ff_members to service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text);
      alter table storage.objects enable row level security;
    `+await readFile('supabase/migrations/20261122180000_orders_workspace.sql','utf8'));
    mock=await startMockSupabase(0);
    await reserve(supabase,mockPort);
    const port=await reserve(server);
    app=next({dev:false,hostname:'127.0.0.1',port});await app.prepare();
    server.on('request',app.getRequestHandler());
    const base='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-22T17:00:00Z'));
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    const region=page.getByRole('navigation',{name:'Orders sections',exact:true});
    const api=base+'/api/orders';
    const read=async (parameters:string, expected=200)=>{
      const response=await context.request.get(api+parameters);
      assert.equal(response.status(),expected,await response.text());
      return response.json();
    };
    const save=async (input:Record<string,unknown>, expected=200)=>{
      const response=await context.request.post(api,{headers:{origin:base},data:{operationId:randomUUID(),...input}});
      assert.equal(response.status(),expected,expected===200&&input.action==='recordDownload'?'Download failed':await response.text());
      return input.action==='recordDownload'&&expected===200?response.body():response.json();
    };
    await read('',401);
    await page.goto(base+'/login');
    await page.getByLabel('Email').fill('owner@example.test');
    await page.getByLabel('Password').fill('local-test-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.waitForURL('**/index.html');
    await page.goto(base+'/orders');
    await region.getByRole('button',{name:'Deadline Calendar',exact:true}).waitFor();
    const calendar=await save({action:'saveCalendar',clientId:'epic3',year:2027,name:'Local Orders verification',expectedRevision:0});
    const kickoff=await save({action:'saveMarketDeadlines',calendarId:calendar.id,
      marketId:'epic3-arkansas-nwa',dueDate:'2026-11-24'});
    assert.equal(kickoff.deadlines.length,4);
    const deadline=kickoff.deadlines.find((item:{step:string})=>item.step==='digital');
    assert.ok(deadline);
    await page.reload();
    const month=page.getByRole('table',{name:'November 2026 deadlines',exact:true});
    await month.getByText('Arkansas NWA',{exact:true}).waitFor();
    await month.getByRole('button',{name:'Digital',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('article',{name:'Media Order'}).waitFor();
    await page.getByRole('heading',{name:'Digital campaign research',exact:true}).waitFor();
    await page.setViewportSize({width:569,height:705});
    await page.getByRole('article',{name:'Media Order'}).waitFor();
    await page.getByRole('button',{name:'Edit Order No.',exact:true}).click();
    await page.getByRole('textbox',{name:'Order No.',exact:true}).fill('LOCAL-UNSAVED');
    await page.getByRole('heading',{name:'Digital campaign research',exact:true}).waitFor();
    await page.getByText('Unsaved changes',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.getByText('Unsaved changes',{exact:true}).count(),0);

    const scope='&clientId=epic3&year=2027&marketId=epic3-arkansas-nwa&workflow=digital';
    const seed=await read('?view=seed'+scope);
    assert.equal(seed.document.lines.length,0);
    const source=await read('?view=research'+scope);
    assert.equal(source.total,20);
    assert.equal(source.rows[0].program,'iHeart Streaming Radio/Audio');
    const document={...seed.document,number:'LOCAL-ORDERS-27',date:'2027-01-02',
      vendor:'Fixture Media',rep:'Fixture rep',billing:'billing@example.test',terms:'Net 30',
      start:'2027-02-01',end:'2027-03-31',lines:[{...source.rows[0].line,amount:125_000}]};
    const order=await save({...seed,document,action:'saveOrder',expectedRevision:0,deadlineId:deadline.id,deadlineRevision:deadline.revision});
    assert.equal(order.revision,1);
    await save({id:order.id,document,action:'saveOrder',expectedRevision:0},409);
    const issued=await save({id:order.id,action:'finalizeOrder',expectedRevision:order.revision});
    const issueId=issued.currentIssue.id;
    const operationId=randomUUID();
    const download={id:order.id,issueId,action:'recordDownload'};
    const first=await save({...download,operationId});
    const retry=await save({...download,operationId});
    const later=await save(download);
    assert.equal(checksum(first),issued.currentIssue.sha256);
    assert.equal(checksum(first),checksum(retry));
    assert.equal(checksum(first),checksum(later));
    let detail=await read('?id='+order.id);
    assert.equal(detail.history.filter((event:{type:string})=>event.type==='downloaded').length,2);
    assert.equal(detail.currentIssue.downloaded,true);
    await page.goto(base+'/orders?id='+order.id);
    const [downloaded]=await Promise.all([
      page.waitForEvent('download'),page.getByRole('button',{name:'Download order PDF',exact:true}).click(),
    ]);
    assert.equal(downloaded.suggestedFilename(),'LOCAL-ORDERS-27-v1.pdf');
    await page.getByText('PDF downloaded',{exact:true}).waitFor();
    detail=await read('?id='+order.id);
    assert.equal(detail.history.filter((event:{type:string})=>event.type==='downloaded').length,3);
    const status=async()=>(await read('?view=workspace&clientId=epic3&year=2027')).calendars
      .find((item:{id:string})=>item.id===calendar.id).deadlines.find((item:{id:string})=>item.id===deadline.id).status;
    assert.equal(await status(),'In progress');
    detail=await save({id:order.id,issueId,action:'recordSend',recipient:'buyer@example.test',sentAt:'2026-11-22T13:00:00Z',note:''});
    assert.equal(await status(),'Complete');
    assert.equal(detail.currentIssue.sent,true);
    await save({id:order.id,action:'createRevision',expectedRevision:order.revision});
    assert.equal(await status(),'In progress');
    assert.equal(checksum(await save(download)),checksum(first));
    mock.setMemberAllowed(false);
    await read('?id='+order.id,403);
    await save(download,403);
    mock.setMemberAllowed(true);
    await page.goto(base+'/orders?id='+order.id);
    await page.getByRole('article',{name:'Media Order'}).waitFor();
    await page.getByRole('button',{name:'Edit history & activity',exact:true}).click();
    await page.getByRole('dialog',{name:'Edit history & activity',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Orders HTTP and browser check passed with isolated Postgres, fixture sign-in and Storage, and real Chromium PDFs.');
  } finally {
    await browser?.close();
    await app?.close();
    if(server.listening){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    if(supabase.listening)await new Promise<void>(resolve=>supabase.close(()=>resolve()));
    await mock?.close();
    if(container)await exec('docker',['stop','-t','1',dbName]);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
