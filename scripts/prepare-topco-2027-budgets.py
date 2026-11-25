"""Prepare the reviewed Topco 2027 budget import. Does not connect to a database."""

import argparse
import copy
import json
import sys
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

from openpyxl import load_workbook

CAMPAIGN_ID = "d4d1cf68-9534-4573-aa04-038badd64625"
CAMPAIGN_RECORD = f"campaign:{CAMPAIGN_ID}"
UNBUDGETED = {"epic3-davenport", "epic3-lincoln"}
BRANCH_MARKETS = {
    "Austin, TX": "austin",
    "Boise, ID": "boise",
    "Boston, MA": "boston",
    "Buffalo East, NY": "rochester-buffalo",
    "CHINE, IL": "chicagoland",
    "CHINW, IL": "chicagoland",
    "CHISE, IL": "chicagoland",
    "CHISW, IL": "chicagoland",
    "Cincinnati, OH": "hill-cincinnati",
    "Cleveland, OH": "cleveland",
    "Colorado Springs, CO": "colorado-springs",
    "Dallas/Fort Worth, TX": "dallas-fort-worth-weatherford",
    "Denver, CO": "denver",
    "Des Moines, IA": "des-moines",
    "Fayetteville, AR": "arkansas-nwa",
    "Fort Wayne, IN": "fort-wayne",
    "Fresno, CA": "hill-fresno-ca",
    "Green Bay, WI": "green-bay-appleton",
    "Houston North, TX": "hill-houston",
    "Iowa City, IA": "iowa-city-cedar-rapids",
    "Kansas City, MO": "kansas-city",
    "Knoxville, TN": "hill-knoxville",
    "Lexington, KY": "hill-lexington-ky",
    "Madison, WI": "madison",
    "Memphis, TN": "hill-memphis",
    "Merrillville-Valparaiso, IN": "merrillville-valparaiso",
    "Milwaukee, WI": "milwaukee-racine-kenosha",
    "Nashville, TN": "hill-nashville",
    "Ogden, UT": "salt-lake-ogden",
    "Oklahoma City, OK": "oklahoma-city",
    "Omaha, NE": "omaha",
    "Racine, WI": "milwaukee-racine-kenosha",
    "Salt Lake City, UT": "salt-lake-ogden",
    "San Antonio, TX": "hill-san-antonio",
    "Seattle, WA": "seattle",
    "Springfield, MO": "springfield-ozarks",
    "Tampa East, FL": "hill-tampa",
}


def read_budgets(path):
    workbook = load_workbook(path, read_only=True, data_only=False)
    try:
        rows = workbook["Media"].values
        if next(rows, None) != ("Branch", "FinalFore Budget"):
            raise ValueError("Expected the Branch and FinalFore Budget columns in Media.")
        budgets = {}
        seen = set()
        for branch, amount in rows:
            if branch is None and amount is None:
                continue
            if branch not in BRANCH_MARKETS or branch in seen:
                raise ValueError(f"Unknown or duplicate branch {branch!r}.")
            if type(amount) not in (int, float):
                raise ValueError(f"Enter a numeric budget for {branch}.")
            cents = Decimal(str(amount)) * 100
            if not cents.is_finite() or not 0 <= cents <= 100_000_000_000 or cents != cents.to_integral_value():
                raise ValueError(f"Invalid budget for {branch}.")
            seen.add(branch)
            market = f"epic3-{BRANCH_MARKETS[branch]}"
            budgets[market] = budgets.get(market, 0) + int(cents)
        if seen != BRANCH_MARKETS.keys():
            raise ValueError(f"Missing source branches {sorted(BRANCH_MARKETS.keys() - seen)}.")
        if sum(budgets.values()) > 100_000_000_000:
            raise ValueError('The workbook exceeds the maximum campaign budget.')
        return budgets
    finally:
        workbook.close()


def prepare_campaign(record, budgets):
    source = record["payload"]
    if record["id"] != CAMPAIGN_RECORD or record["kind"] != "campaign" or (
        source["id"], source["clientId"], source["year"], source["workflow"]
    ) != (CAMPAIGN_ID, "epic3", 2027, "broadcast"):
        raise ValueError("The snapshot must be the reviewed Topco 2027 campaign.")
    ids = [row["marketId"] for row in source["markets"]]
    if len(ids) != len(set(ids)) or set(ids) != set(budgets) | UNBUDGETED:
        raise ValueError("The snapshot market roster has changed. Review the import before proceeding.")
    payload = copy.deepcopy(source)
    payload["budget"] = sum(budgets.values())
    for row in payload["markets"]:
        row["override"] = budgets.get(row["marketId"])
    if payload != source:
        payload["revision"] += 1
    return payload


def sql_value(value):
    return "'" + json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def print_import(record, payload):
    source_sql = sql_value(record['payload'])
    reviewed_sql = sql_value(payload)
    delimiter = '$ff_budget_' + sha256((source_sql + reviewed_sql).encode()).hexdigest() + '$'
    while delimiter in source_sql or delimiter in reviewed_sql:
        delimiter = delimiter[:-1] + '_$'
    print(f"""begin;
set local standard_conforming_strings = on;
do {delimiter}
declare
  source_payload constant jsonb := {source_sql};
  reviewed_payload constant jsonb := {reviewed_sql};
  current_payload jsonb;
  record_kind text;
  live_market_ids text[];
  expected_market_ids text[];
begin
  -- Block concurrent campaign creation and directory edits for the duration of the import.
  lock table public.ff_records in share row exclusive mode;
  select array_agg(market order by market) into live_market_ids
  from public.ff_records d cross join lateral jsonb_array_elements(d.payload->'clients') c
  cross join lateral jsonb_array_elements_text(c->'marketIds') as market
  where d.id = 'directory' and c->>'id' = 'epic3' and c->>'active' = 'true' and c->>'brand' = 'Weed Man';
  select array_agg(m->>'marketId' order by m->>'marketId') into expected_market_ids
  from jsonb_array_elements(reviewed_payload->'markets') m;
  if live_market_ids is distinct from expected_market_ids then
    raise exception 'Topco market ownership changed. Reconcile the live directory before importing.';
  end if;

  if exists (select 1 from public.ff_records where kind = 'campaign'
      and payload->>'clientId' in ('epic3','weed-man') and payload->>'year' = '2027'
      and payload->>'workflow' = 'broadcast' and id <> '{CAMPAIGN_RECORD}') then
    raise exception 'Another Topco 2027 media campaign exists. Confirm the canonical record.';
  end if;

  select kind, payload into record_kind, current_payload from public.ff_records where id = '{CAMPAIGN_RECORD}';
  if not found then
    insert into public.ff_records(id, kind, version, payload)
    values ('{CAMPAIGN_RECORD}', 'campaign', 1, reviewed_payload);
  elsif record_kind = 'campaign' and current_payload = reviewed_payload then
    null;
  elsif record_kind = 'campaign' and current_payload = source_payload then
    update public.ff_records set payload = reviewed_payload, version = version + 1, updated_at = now()
    where id = '{CAMPAIGN_RECORD}';
  else
    raise exception 'The canonical campaign changed since this snapshot. Reprepare the import.';
  end if;
end
{delimiter};
commit;

select r.id, r.version, (r.payload->>'budget')::bigint as budget_cents,
       m->>'marketId' as market_id, (m->>'override')::bigint as market_budget_cents
from public.ff_records r cross join lateral jsonb_array_elements(r.payload->'markets') m
where r.id = '{CAMPAIGN_RECORD}' order by market_id;""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--snapshot", type=Path, help="Canonical ff_records row in JSON. Use - for stdin.")
    parser.add_argument("--format", choices=("report", "sql"), default="report")
    args = parser.parse_args()
    budgets = read_budgets(args.workbook)
    if args.format == "sql":
        if not args.snapshot:
            parser.error("--format sql requires --snapshot")
        record = json.load(sys.stdin) if args.snapshot == Path("-") else json.loads(args.snapshot.read_text())
        print_import(record, prepare_campaign(record, budgets))
    else:
        print(json.dumps({
            "campaign": CAMPAIGN_ID, "branches": len(BRANCH_MARKETS), "market_budgets_cents": budgets,
            "total_cents": sum(budgets.values()), "missing_market_ids": sorted(UNBUDGETED),
        }, indent=2))


if __name__ == "__main__":
    main()
