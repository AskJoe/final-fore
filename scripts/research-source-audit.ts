import { initial } from '../lib/domain/directory';
import { MARKETS } from '../lib/domain/catalogs';
import { sourceTemplates, validateTemplate } from '../lib/research/templates';
import { eligibleTemplates } from '../lib/research/assignments';
const directory=initial(),templates=sourceTemplates();
console.log(JSON.stringify({directorySource:'local seed; not a live database query',templates:templates.map(t=>({id:t.id,markets:t.markets.length,issues:validateTemplate(t,directory,MARKETS)})),recipients:directory.reps.filter(r=>r.active).map(r=>({name:r.name,choices:eligibleTemplates(r,directory,templates).filter(e=>e.confirmed).map(e=>e.templateId)}))},null,2));
