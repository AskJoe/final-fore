import { check } from '../domain/types';
import { StorageError } from '../store';

export function chatgptLaunchUrl(pluginId:string|undefined,contextId:string) {
  if(!pluginId)throw new StorageError('The Final Fore ChatGPT connection has not been configured yet.');
  check(/^[a-zA-Z0-9_@.-]{3,180}$/.test(pluginId),'Invalid ChatGPT plugin configuration.');
  check(/^[0-9a-f-]{36}$/i.test(contextId),'Invalid market context.');
  const url=new URL('https://chatgpt.com/plugins/'+encodeURIComponent(pluginId)+'/app/open_market_order');
  url.searchParams.set('path','/market-order?context='+contextId);
  return url.toString();
}
