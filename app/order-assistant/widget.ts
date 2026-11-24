import { App } from '@modelcontextprotocol/ext-apps';

const app=new App({name:'Final Fore market order',version:'1.0.0'},{});
const root=document.getElementById('root')!;
let contextId='',pluginId='',approval='',current:any=null,proposal:any=null,started='';
function element<Tag extends keyof HTMLElementTagNameMap>(tag:Tag,text?:string){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function error(problem:unknown){const node=element('p',problem instanceof Error?problem.message:'Could not refresh this market.');node.setAttribute('role','alert');root.append(node);}
function unpack(response:any){if(response.isError)throw new Error(response.content?.find((item:any)=>item.type==='text')?.text??'Could not load this market.');return response.structuredContent;}
async function call(name:string,args:Record<string,unknown>){return app.callServerTool({name,arguments:args});}
async function load(id:string){
  if(contextId&&contextId!==id){current=null;proposal=null;approval='';}
  contextId=id;
  const response=await call('get_market_context_for_app',{contextId});
  pluginId=String(response._meta?.launchPluginId??'');
  current=unpack(response);
  await app.updateModelContext({structuredContent:{contextId,market:current.marketName,clientId:current.context.clientId,
    year:current.context.year,orderId:current.order.id,checkedAt:current.checkedAt,
    instruction:'Call get_market_context again before answering. Scope stays fixed to this market.'}});
  render();
}
async function startChat(){
  if(!current)return;
  const capabilities=app.getHostCapabilities() as any;
  if(!capabilities?.experimental?.['openai/message'])throw new Error('This host cannot open a new market chat from the app. Use the current conversation with this market context.');
  const mention=pluginId?'[@Final Fore Campaigns & Orders](plugin://'+pluginId+') ':'';
  const text=mention+'Help me review '+current.marketName+' for '+current.context.clientId+' ('+current.context.year+
    '). Use market context '+contextId+'. Read get_market_context and current research before answering. Stay within this market and order. Show proposed placement changes for review.';
  const message={role:'user' as const,content:[{type:'text' as const,text}],_meta:{'openai/message':{target:'new',send:false}}};
  const response=await app.sendMessage(message);
  if(response.isError)throw new Error('The host did not open the market chat.');
  started=contextId;
}
function money(value:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);}
function render(){
  root.replaceChildren();
  if(current){
    root.append(element('h1',current.marketName),element('p',current.context.clientId+' · '+current.context.year+
      ' · '+(current.order.document.number||'Broadcast draft')),element('p','Current draft '+money(current.order.total)));
    const chat=element('button','Start this market chat');chat.onclick=()=>void startChat().catch(error);root.append(chat);
    const refresh=element('button','Refresh order and research');refresh.onclick=()=>void load(contextId).catch(error);root.append(refresh);
    if(current.context.detached)root.append(element('p','This context is detached. Reopen the market in Final Fore before editing.'));
    if(current.hasIncompleteFields)root.append(element('p','There are incomplete field entries. Correct them in Final Fore before proposing placements.'));
  }else root.append(element('h1','Final Fore market order'),element('p','Open Ask ChatGPT from a single market in Final Fore.'));
  if(proposal){
    root.append(element('h2','Review proposed changes'),element('p',
      'Before '+money(proposal.beforeTotal)+' · After '+money(proposal.afterTotal)));
    const table=element('table'),head=element('tr');
    for(const label of ['Change','Station / placement','Flight','Spots','Rate','Evidence'])head.append(element('th',label));
    table.append(head);
    const before=new Map(proposal.before.map((line:any)=>[line.id,line]));
    const after=new Map(proposal.after.map((line:any)=>[line.id,line]));
    for(const [kind,lines]of [['Remove',proposal.before.filter((line:any)=>!after.has(line.id))],
      ['Add',proposal.after.filter((line:any)=>!before.has(line.id))]] as const) {
      for(const line of lines){
        const row=element('tr');
        for(const value of [kind,line.station+' · '+line.program,(line.start||'Start needed')+' – '+(line.end||'End needed'),
          line.quantity==null?'Needs quantity':String(line.quantity),line.rate==null?'Needs applicable rate':money(line.rate),
          (line.source?.label??'Source needed')+' · '+(line.source?.locator??'')])row.append(element('td',value));
        table.append(row);
      }
    }
    root.append(table,element('p',proposal.note));
    const apply=element('button',proposal.status==='applied'?'Applied to saved draft':'Apply these changes');
    apply.disabled=proposal.status==='applied'||!approval;
    apply.onclick=async()=>{
      apply.disabled=true;
      try{
        const response=await call('apply_market_order_changes',{contextId:proposal.contextId,
          proposalId:proposal.id,hash:proposal.hash,approval});
        unpack(response);proposal={...proposal,status:'applied'};await load(proposal.contextId);
      }catch(problem){error(problem);apply.disabled=false;}
    };
    root.append(apply);
  }
}
function deepLink(host:any){
  const raw=host?.['openai/deepLink']?.url;
  if(typeof raw!=='string')return;
  const id=new URL(raw,'https://final-fore.invalid').searchParams.get('context');
  if(id&&id!==contextId)void load(id).then(async()=>{
    if(started!==id&&(app.getHostCapabilities() as any)?.experimental?.['openai/message'])await startChat();
  }).catch(error);
}
app.ontoolresult=(response:any)=>{
  pluginId=String(response._meta?.launchPluginId??pluginId);
  const value=unpack(response);
  if(value?.context){current=value;contextId=value.context.id;}
  if(value?.proposal){proposal=value.proposal;contextId=proposal.contextId;approval=String(response._meta?.approvalToken??'');}
  render();
};
app.onhostcontextchanged=host=>deepLink(host);
app.connect().then(()=>{render();deepLink(app.getHostContext());}).catch(error);
