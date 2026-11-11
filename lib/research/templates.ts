import seed from '../../data/research-template-seed.json';
import links from '../../data/research-market-links.json';
import type { Directory } from '../domain/directory';
import type { Data } from '../domain/types';
import type { TemplateDraft, ValidationIssue } from './types';

export const marketChoices = links;
export function sourceTemplates(): TemplateDraft[] { return structuredClone(seed) as TemplateDraft[]; }

export function validateTemplate(template: TemplateDraft, directory: Directory, catalog: Record<string,Data>): ValidationIssue[] {
  const issues: ValidationIssue[]=[];
  const add=(code:string,message:string,marketName?:string)=>issues.push({code,message,...(marketName?{marketName}:{})});
  const client=directory.clients.find(c=>c.id===template.clientId&&c.active);
  if(!client) add('client','Choose an active client.');
  if(!['broadcast-radio','broadcast-tv'].includes(template.media)) add('media','Choose Radio or TV.');
  if(!['single','multi'].includes(template.scope)) add('scope','Choose single-market or multi-market.');
  if(template.scope==='single'?template.markets.length!==1:template.markets.length<2) add('cardinality',template.scope==='single'?'A single-market template needs exactly one city.':'Choose at least two markets.');
  const seen=new Set<string>();
  for(const market of template.markets) {
    if(!market.displayName.trim()) add('market-name','Enter a market name.');
    if(!market.marketId) add('market-link',`Confirm the platform record for ${market.displayName}.`,market.displayName);
    else {
      if(!Object.hasOwn(catalog,market.marketId)) add('market-link',`Unknown platform market: ${market.displayName}.`,market.displayName);
      else if(!client?.marketIds.includes(market.marketId)) add('market-owner',`${market.displayName} is not linked to this client.`,market.displayName);
      if(seen.has(market.marketId)) add('market-duplicate',`Choose ${market.displayName} only once.`,market.displayName);
      seen.add(market.marketId);
    }
  }
  if(!template.name.trim()||!template.subject.trim()||!template.body.trim()) add('content','Enter a name, subject and email body.');
  if(!template.body.includes('{{upload_url}}')) add('upload-link','Keep the upload link in the email.');
  return issues;
}
