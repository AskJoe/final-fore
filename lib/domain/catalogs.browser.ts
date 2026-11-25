// Browser stand-in for ./catalogs. The server reads the catalogs from disk; in the
// browser they arrive from the signed-in API, so no plan data is embedded in a script.
import type { Data } from './types';
export let CATALOG:Data={};
export let CHANNEL_CATALOG:Data={};
export let MARKETS:Record<string,Data>={};
export let CHANNELS:Record<string,Data>={};
export let VERSION='';
export function load(catalog:Data,channels:Data){
  CATALOG=catalog;CHANNEL_CATALOG=channels;
  MARKETS=Object.fromEntries(catalog.markets.map((m:Data)=>[m.id,m]));
  CHANNELS=Object.fromEntries(channels.channels.map((c:Data)=>[c.id,c]));
  VERSION=channels.version+'-v1';
}
