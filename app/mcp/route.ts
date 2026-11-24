import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AccessError } from '@/lib/access';
import { failure } from '@/lib/http';
import { authenticateMcp,mcpResource } from '@/lib/order-assistant/auth';
import { createMarketMcpServer } from '@/lib/order-assistant/tools';
import { MarketOrderAssistant } from '@/lib/order-assistant/service';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const discoveryMethods=new Set(['initialize','notifications/initialized','ping','tools/list','resources/list','resources/templates/list','resources/read']);
export async function POST(request:Request){
  try{
    if(Number(request.headers.get('content-length'))>1_000_000)return new Response('Request too large.',{status:413});
    // Bound actual streamed bytes as well as Content-Length before the SDK parses them.
    const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>1_000_000){await reader.cancel();return new Response('Request too large.',{status:413});}chunks.push(value);}
    const body=Buffer.concat(chunks);
    let method:unknown;
    try { method=JSON.parse(body.toString())?.method; } catch { /* The transport handles malformed JSON. */ }
    const discovery=typeof method==='string'&&discoveryMethods.has(method);
    const assistant=discovery?null:new MarketOrderAssistant(await authenticateMcp(request));
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    const server=createMarketMcpServer(assistant);
    await server.connect(transport);
    const response=await transport.handleRequest(new Request(request.url,{method:'POST',headers:request.headers,
      body:new Uint8Array(body)}));
    response.headers.set('Cache-Control','private, no-store');
    return response;
  }catch(error){
    const response=failure(error);
    if(error instanceof AccessError&&error.status===401)response.headers.set('WWW-Authenticate',
      'Bearer resource_metadata="'+new URL('/.well-known/oauth-protected-resource/mcp',mcpResource())+'", scope="openid"');
    return response;
  }
}
export async function GET(){return new Response(null,{status:405,headers:{Allow:'POST, OPTIONS'}});}
export async function OPTIONS(){return new Response(null,{status:204,headers:{
  'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, content-type, mcp-protocol-version, mcp-session-id',
}});}
