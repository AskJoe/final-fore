"""Add source-verified TV avails with a BEST or dated spot-rate column."""
import argparse
from datetime import datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import re


def read(path):
    return json.loads(path.read_text())


def measurement(value, unit, cell, scale=1):
    return {"value": float(value) * scale, "unit": unit, "locator": cell, "raw": value}


def merge(sheets, extracted, upload):
    tv = sheets["tv"]
    digest = extracted["sha256"]
    assert digest not in tv["sources"], "This source is already indexed."
    assert upload["state"] == "ready" and upload["media"] == "broadcast-tv"
    for key in ("name", "market", "rep", "firm", "sha256"):
        assert extracted[key] == upload[key], f"Source attribution differs at {key}."

    candidates = [
        (tab, cells["cells"], address, match)
        for tab, cells in extracted["tabs"].items()
        for address, cell in cells["cells"].items()
        if (match := re.fullmatch(r"(20\d{2}) BEST :(\d{2})", cell["v"]))
    ]
    if candidates:
        latest_year = max(candidate[3][1] for candidate in candidates)
        candidates = [candidate for candidate in candidates if candidate[3][1] == latest_year]
    else:
        candidates = [
            (tab, cells["cells"], address, None)
            for tab, cells in extracted["tabs"].items()
            for address, cell in cells["cells"].items()
            if re.fullmatch(r"Rate\s+\(\d{1,2}/\d{1,2}\)", cell["v"].strip())
        ]
    assert len(candidates) == 1, "Expected one current rate column."
    tab, cells, header, best_rate = candidates[0]
    header_row = int(header.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
    rate_column = header.rstrip("0123456789")

    def text(address):
        return cells.get(address, {}).get("v", "").strip()

    def column(label):
        columns = [address.rstrip("0123456789") for address in cells
                   if address.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ") == str(header_row) and text(address) == label]
        assert len(columns) == 1, f"Expected one {label} column."
        return columns[0]

    dates = next(
        dates for cell in cells.values()
        if (dates := re.fullmatch(r"Schedule Date:\s+(\d{1,2}/\d{1,2}/\d{4})\s+-\s+(\d{1,2}/\d{1,2}/\d{4})", cell["v"].strip()))
    )
    start, end = [datetime.strptime(value, "%m/%d/%Y").date() for value in dates.groups()]
    assert start <= end and start.year == end.year
    station_col, time_col, program_col, book_col, audience_col, cpm_col = [
        column(label) for label in ("Station", "Time", "Program Name", "Book", "(000)", "CPM")
    ]
    audience_header = text(f"{audience_col}{header_row - 1}")
    assert "35-64" in audience_header
    if best_rate:
        year, seconds = map(int, best_rate.groups())
        assert start.year == year and "Nielsen" in audience_header
        extra_columns = {
            f"{year - 1} best rate": column(f"{year - 1} BEST :{seconds:02}"),
            "Buyer target rate": column(f":{seconds:02} Need"),
        }
    else:
        seconds = None
        length_column = column("SL")
        extra_columns = {}

    existing_labels = {column["label"] for column in tv["columns"]}
    new_columns = [{"label": label, "width": 116} for label in extra_columns if label not in existing_labels]
    if new_columns:
        tv["columns"].extend(new_columns)
        if tv.get("groups"):
            tv["groups"][-1]["span"] += len(new_columns)
        for row in tv["rows"]:
            row["cells"].extend([None] * (len(tv["columns"]) - len(row["cells"])))
    columns = {column["label"]: index for index, column in enumerate(tv["columns"])}
    quotes = []
    row_numbers = sorted({int(addr.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) for addr in cells})
    for row in row_numbers:
        if row <= header_row:
            continue
        station, schedule, program, book = [text(f"{col}{row}") for col in (station_col, time_col, program_col, book_col)]
        rate_raw = text(f"{rate_column}{row}")
        if not rate_raw and not (station and program):
            continue
        assert all((station, schedule, program, book, rate_raw)), f"Incomplete program at {tab} row {row}."
        spot_seconds = seconds
        if spot_seconds is None:
            length = re.fullmatch(r":(\d{2})", text(f"{length_column}{row}"))
            assert length, f"Missing spot length at {tab} row {row}."
            spot_seconds = int(length[1])

        def metric(col, unit="USD", scale=1):
            addr = f"{col}{row}"
            return measurement(text(addr), unit, f"{tab}!{addr}", scale)

        rate = metric(rate_column)
        audience = metric(audience_col, "people", 1000)
        cpm = metric(cpm_col)
        assert audience["value"].is_integer() and audience["value"] > 0 and rate["value"] >= 0
        assert abs(cpm["value"] - rate["value"] * 1000 / audience["value"]) < 0.01
        rendered = [None] * len(tv["columns"])
        values = {
            "Source type": "TV availability", "Station": station, "Schedule": schedule, "Program": program,
            "Spot rate": rate, "Audience count": audience, "Reported CPM": cpm, "Book / service": book,
            "Audience definition": audience_header, "Spot (sec)": spot_seconds, "Effective dates": f"{start} – {end}",
            **{label: metric(col) for label, col in extra_columns.items()},
        }
        for label, value in values.items():
            rendered[columns[label]] = value
        loc = rate["locator"]
        quotes.append({
            "id": sha256(f"TV availability:{digest}:{loc}".encode()).hexdigest(),
            "market": upload["market"], "sourceMarketId": upload["market_id"], "client": "EPIC3",
            "sourceKeys": [digest], "locator": loc, "avail": True, "cells": rendered,
            "pricePeriods": [{"start": start.isoformat(), "through": end.isoformat(), "rate": rate, "cpm": cpm}],
        })
    assert quotes, "No priced program lines found."
    tv["sources"][digest] = {"files": [{
        "id": upload["id"], "name": upload["name"], "market": upload["market"],
        "marketId": upload["market_id"], "rep": upload["rep"], "firm": upload["firm"],
    }]}
    first_market_row = next((i for i, row in enumerate(tv["rows"])
                             if row.get("sourceMarketId") == upload["market_id"]), len(tv["rows"]))
    tv["rows"][first_market_row:first_market_row] = quotes
    tv["totals"]["values"] += sum(sum(value is not None for value in row["cells"]) for row in quotes)
    tv["totals"]["files"] += 1
    tv["totals"]["submissions"] += 1
    return quotes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("snapshot", "extracted", "original", "inventory", "output"):
        parser.add_argument(f"--{arg}", type=Path, required=True)
    args = parser.parse_args()
    sheets = read(args.snapshot)
    extracted = read(args.extracted)
    assert sha256(args.original.read_bytes()).hexdigest() == extracted["sha256"]
    uploads = [item for item in read(args.inventory) if item["sha256"] == extracted["sha256"]
               and item["market"] == extracted["market"] and item["rep"] == extracted["rep"]]
    assert len(uploads) == 1, "Expected one matching reviewed upload."
    quotes = merge(sheets, extracted, uploads[0])
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        json.dump(sheets, output, ensure_ascii=False, separators=(",", ":"))
    print(f'Added {len(quotes)} priced rows from {uploads[0]["name"]}.')


if __name__ == "__main__":
    main()
