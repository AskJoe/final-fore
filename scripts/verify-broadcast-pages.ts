// Read-only parity test against a local database containing the reviewed snapshots.
// Supply normal libpq PG* connection settings. The Radio input is the five-sheet export.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {batchKey, type ResearchSheet, type SavedMarket} from '../lib/broadcast/workbook';
import {defaultQuery, workbookView, type Filters} from '../lib/broadcast/view';

const [radioPath,tvPath] = process.argv.slice(2);
if (!tvPath || !process.env.PGDATABASE) throw Error('Set PGDATABASE and supply the reviewed five-sheet export and TV content JSON.');
const radio: ResearchSheet = JSON.parse(readFileSync(radioPath,'utf8')).find((row: {sheet: string}) => row.sheet === 'radio').content;
const tv: ResearchSheet = JSON.parse(readFileSync(tvPath,'utf8'));
const quote = (s: string) => "'" + s.replaceAll("'","''") + "'";
function sql(statement: string) {
  return execFileSync('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
}
const reviews: SavedMarket[] = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('review_key',review_key,'market_id',market_id,'market_name',market_name)),'[]')
  from ff_broadcast_research_market_reviews where batch_key=${quote(batchKey)}`));

for (const name of ['tv','radio'] as const) {
  const content = name === 'tv' ? tv : radio;
  const saved = name === 'tv' ? reviews : [];
  const rpc = 'ff_' + name + '_workbook_page';
  function call(filters: Filters, page: string, primary='',secondary='') {
    const args=[batchKey,filters.market,filters.client,filters.rep,filters.firm,primary,secondary].map(quote);
    return rpc + '(' + args.join(',') + ',' + page + ')';
  }
  function check(filters: Partial<Filters>, page: number, primary='',secondary='') {
    const query={filters:{...defaultQuery.filters,...filters},page,grouping:{primary,secondary}};
    const want=workbookView(name,content,saved,query);
    const got=JSON.parse(sql('select ' + call(query.filters,String(page),primary,secondary)));
    for (const key of ['groupFields','filterOptions','sheet','grouping','matches','page','pages','offset','total','matrix','periods','hasRates'] as const) {
      assert.deepEqual(got[key],JSON.parse(JSON.stringify(want[key])),name+' '+key);
    }
    assert.deepEqual(got.lines,want.sections.flatMap(section=>section.lines),name+' page entries');
    console.log(name,page,primary,secondary,JSON.stringify(filters),got.matches+' matches',got.lines.length+' lines');
  }
  // Compare every returned identifier in order, including each page boundary.
  const pageCount=Math.max(1,Math.ceil(content.rows.length/100));
  const result=sql(`select jsonb_build_object('page',p,'rows',(
      select coalesce(jsonb_agg(line#>>'{0,row,id}' order by n),'[]') from jsonb_array_elements(doc->'lines') with ordinality t(line,n)))
    from generate_series(1,${pageCount}) p cross join lateral ${call(defaultQuery.filters,'p')} doc order by p`);
  const pages=result.split('\n').map(line=>JSON.parse(line) as {page:number;rows:string[]});
  assert.equal(pages.length,pageCount);
  for(const [i,actual] of pages.entries()){
    const expected=workbookView(name,content,saved,{...defaultQuery,page:i+1});
    assert.equal(actual.page,i+1);
    assert.deepEqual(actual.rows,expected.sections.flatMap(section=>section.lines.map(line=>line[0].row.id)));
  }
  console.log(name,content.rows.length+' row IDs matched across '+pageCount+' pages');
  check({},1);
  check({},2147483647);
  check({market:'__absent__'},1);
  const market=content.rows.find(row=>row.market.startsWith('Houston'))?.market;
  assert.ok(market,'Houston market missing from '+name);
  check({market},1);
  check({market},2147483647);
  const sample=content.rows.find(row=>row.market===market && row.sourceKeys.length)!;
  const file=content.sources[sample.sourceKeys[0]].files[0];
  const combined={market,rep:name==='radio'?'Mike Donnelly':file.rep,firm:name==='radio'?'Katz Radio':file.firm,client:sample.client};
  check(combined,1);
  check(combined,2147483647);
  check({...combined,firm:'__absent__'},1);
  if(name==='radio'){
    check({},1,'Market','Daypart/3');
    check({},2,'Market','Daypart/3');
    check(combined,2,'Daypart/3','Market');
    check({market},3,'AQH (people)/5','Source file');
  } else {
    check({},2,'Market','Rep');
    check({},2,'Early Morning · CPM/2','Source file');
    check({},2,'Market review','Firm');
  }
}
