import type { StoredRecord } from '../store';
import type { Directory } from './directory';
import { check, type Data, type Workbook } from './types';
import { colName, coordinates } from './formulas';
import { snapshot } from './workbook';

// The original import belongs to Epic3. Additional workbooks must declare their
// client explicitly; a directory market assignment never reassigns source spend.
export function owner(record: StoredRecord): string {
  check(record.kind === 'workbook', 'Choose a media workbook.');
  const clientId = record.payload.metadata?.clientId ?? (record.id === 'workbook' ? 'epic3' : null);
  check(typeof clientId === 'string' && !!clientId, 'This workbook needs a client assignment before it can be included in media planning.');
  return clientId;
}

export function combined(records: StoredRecord[], directory: Directory): Data {
  const result: Data = {
    cells: {}, styles: [], periods: [], sources: [], targets: {}, clients: directory.clients.map(c => ({ id: c.id, name: c.name, active: c.active })),
    layout: { maxRow: 0, maxCol: 1, merges: [], styles: {} },
    planning: { editableInputs: [], formulaTargets: [], addedFormulas: {} },
  };
  const ordered = [...records].sort((a,b) => a.id === 'workbook' ? -1 : b.id === 'workbook' ? 1 : a.id.localeCompare(b.id));
  let reference: Workbook | undefined;
  for (const record of ordered) {
    const clientId = owner(record), client = directory.clients.find(c => c.id === clientId);
    check(client, 'The media workbook’s client is not in the client directory.');
    const w = record.payload as Workbook, source = snapshot(w);
    check(source.planning, 'The media workbook needs its planning column definitions.');
    if (reference) {
      check(w.metadata.layout.maxRow === reference.metadata.layout.maxRow, 'Client workbooks must use the same channel row layout for a combined grid.');
      for (let row=3;row<=w.metadata.layout.maxRow;row++) {
        check((w.sheets.EPIC3['A'+row]?.value??'') === (reference.sheets.EPIC3['A'+row]?.value??''), 'Client workbooks must use matching channel labels for a combined grid.');
      }
    }
    reference ??= w;
    const offset = result.layout.maxCol - 1, styleOffset = result.styles.length;
    const address = (original:string) => {const [row,col]=coordinates(original);return colName(col===1?1:col+offset)+row;};
    const rateColumn = 2 + offset, endColumn = source.layout.maxCol + offset;
    result.sources.push({ workbookId: record.id, clientId, clientName: client.name, rateColumn, endColumn, columnOffset: offset, revision: source.revision, storageVersion: record.version });
    result.styles.push(...source.styles);
    for (const [original,value] of Object.entries(source.cells) as [string,Data][]) {
      const [,col] = coordinates(original);
      if (col===1 && result.cells[original]) continue;
      const virtual = address(original);
      result.cells[virtual] = { ...value, style: value.style + styleOffset };
      if (col>1) result.targets[virtual] = { workbookId:record.id,clientId,clientName:client.name,address:original,revision:source.revision,storageVersion:record.version };
    }
    for(const original of [...source.planning.editableInputs,...source.planning.formulaTargets])result.targets[address(original)]={workbookId:record.id,clientId,clientName:client.name,address:original,revision:source.revision,storageVersion:record.version};
    // Formulas stay in their original workbook coordinate system. Calculated
    // values come from that workbook; the combined grid never recalculates them.
    for (const [original,style] of Object.entries(source.layout.styles)) result.layout.styles[address(original)] = Number(style)+styleOffset;
    for (const merge of source.layout.merges) result.layout.merges.push(merge.split(':').map(address).join(':'));
    for (const p of source.periods) result.periods.push({ ...p, id:record.id+':'+p.id, label:client.name+' · '+p.label, clientId,workbookId:record.id,start_column:p.start_column+offset,end_column:p.end_column+offset });
    result.planning.editableInputs.push(...source.planning.editableInputs.map(address));
    result.planning.formulaTargets.push(...source.planning.formulaTargets.map(address));
    for (const [original,value] of Object.entries(source.planning.addedFormulas)) result.planning.addedFormulas[address(original)]=value;
    result.layout.maxRow=Math.max(result.layout.maxRow,source.layout.maxRow);result.layout.maxCol=endColumn;
  }
  return result;
}
