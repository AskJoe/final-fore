"""Read-only export and independent Python reference results. Never uploads data."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'epic3'))
import database, markets, orders, campaigns, campaign_orders

OUT = ROOT / '.local-migration'
OUT.mkdir(exist_ok=True)

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))

def readonly(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('BEGIN')
    return db

paths = [ROOT / 'epic3/data/epic3.sqlite3', ROOT / 'epic3/data/campaigns.sqlite3']
before = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
with readonly(paths[0]) as db:
    sheets = {r[0]: markets.sheet_cells(db, r[0]) for r in db.execute('SELECT DISTINCT sheet FROM cells')}
    workbook = {
        'sheets': sheets,
        'metadata': {r['key']: json.loads(r['value']) for r in db.execute('SELECT * FROM metadata')},
        'styles': [json.loads(r[0]) for r in db.execute('SELECT definition FROM styles ORDER BY id')],
        'periods': [dict(r) for r in db.execute('SELECT * FROM market_periods ORDER BY start_column')],
        'links': dict(db.execute('SELECT address,description FROM markets_links')),
        'changes': [dict(r) for r in db.execute('SELECT * FROM changes ORDER BY id')],
        'variableChanges': [dict(r) for r in db.execute('SELECT * FROM variable_changes ORDER BY id')],
        'orderDrafts': {str(r['market_row']): {'revision': r['revision'], 'details': json.loads(r['details']), 'updatedAt': r['updated_at']} for r in db.execute('SELECT * FROM order_drafts')},
    }
    write('workbook.json', workbook)
    write('reference-workbook.json', {'EPIC3': database.snapshot(db), 'Markets': markets.snapshot(db), 'Variables': markets.snapshot(db, 'Variables')})
    write('reference-orders.json', {str(row): orders.snapshot(db, row) for row in markets.PRIMARY})

with readonly(paths[1]) as db:
    campaign_records = [dict(r) for r in db.execute('SELECT * FROM campaigns ORDER BY id')]
    order_records = [dict(r) for r in db.execute('SELECT * FROM campaign_orders ORDER BY campaign_id,market_id')]
    for r in campaign_records:
        r['details'] = json.loads(r['details'])
    for r in order_records:
        r['details'] = json.loads(r['details']); r['source'] = json.loads(r['source'])
    write('campaigns.json', campaign_records)
    write('campaign-orders.json', order_records)
    write('reference-campaigns.json', [campaigns.calculate(r['details']) for r in campaign_records])
    write('reference-campaign-orders.json', [campaign_orders.model(r['source'], r['details'], r['revision']) for r in order_records])

default = campaigns.defaults()
variants = [default, {**default, 'budget': 100000001, 'start': '2027-03-01', 'end': '2027-05-31'}]
write('reference-campaign-variants.json', [{'input': v, 'expected': campaigns.calculate(v)} for v in variants])
report = json.loads((ROOT / 'epic3/reporting/web/reporting-data.json').read_text())
manifest = {'sha256': before, 'cells': sum(len(s) for s in sheets.values()), 'formulas': sum(bool(c['formula']) for s in sheets.values() for c in s.values()), 'campaigns': len(campaign_records), 'campaignOrders': len(order_records), 'workbookOrderDrafts': len(workbook['orderDrafts']), 'reportingRows': len(report['records'])}
after = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
if before != after:
    raise RuntimeError('Source files changed during export; review before importing.')
write('manifest.json', manifest)
print(json.dumps(manifest, indent=2))
