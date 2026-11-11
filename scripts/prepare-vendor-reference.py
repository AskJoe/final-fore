"""Read the supplied workbook. Write local reference JSON; never connect to a database.

Overview contacts are kept separate from older station-sheet contacts. Explicit
row mappings below capture the overview's grouped layout, not instructions in it.
"""
import hashlib
import json
import pathlib
import sys
import xml.etree.ElementTree as ET
import zipfile

source = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parents[1]
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(source) as archive:
    strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    def rows(sheet):
        result = {}
        for row in ET.fromstring(archive.read(f"xl/worksheets/sheet{sheet}.xml")).findall("m:sheetData/m:row", ns):
            cells = {}
            for cell in row:
                value = cell.find("m:v", ns)
                if value is not None:
                    col = "".join(c for c in cell.attrib["r"] if c.isalpha())
                    cells[col] = (strings[int(value.text)] if cell.get("t") == "s" else value.text).strip()
            result[int(row.attrib["r"])] = cells
        return result
    overview, stations = rows(1), rows(2)

def ident(prefix, text):
    return prefix + "-" + hashlib.sha256(text.casefold().encode()).hexdigest()[:16]

firms, reps, outlets = {}, {}, []
aliases = {
    "KATZ TV GROUP": "Katz TV", "LOCALITY (FORMERLY COX REPS)": "Locality",
    "GRAY TELEVISION": "Gray", "TEGNA REP": "Tegna", "TEGNA": "Tegna",
    "NEXSTAR MEDIA": "Nexstar", "NEXSTAR": "Nexstar", "SCRIPPS": "Scripps",
    "HEARST": "Hearst", "KATZ RADIO": "Katz Radio", "IHEART": "iHeartMedia",
    "NBC SPOT": "NBC Universal", "NBC UNIVERSAL": "NBC Universal",
    "FOX TV SALES": "FOX Corp", "CBS TV SALES": "CBS Corp", "ABC SPOT": "Disney/ABC Corp",
}
def firm(name, role):
    name = aliases.get(name.upper(), name)
    key = ident("firm", name)
    entry = firms.setdefault(key, {"id": key, "name": name, "roles": [], "active": True, "notes": "", "source": "Workbook reference; verify before use"})
    if role not in entry["roles"]:
        entry["roles"].append(role)
    return key

groups = [
    (range(7, 9), "Katz TV", "rep-firm", "broadcast-tv"),
    (range(9, 12), "Locality", "rep-firm", "broadcast-tv"),
    ([13], "Hearst", "station-owner", "broadcast-tv"),
    (range(14, 17), "Nexstar", "station-owner", "broadcast-tv"),
    (range(17, 30), "Scripps", "station-owner", "broadcast-tv"),
    ([32], "Gray", "station-owner", "broadcast-tv"),
    ([33], "Tegna", "station-owner", "broadcast-tv"),
    ([34, 35], "Nexstar", "station-owner", "broadcast-tv"),
    ([37], "NBC Universal", "station-owner", "broadcast-tv"),
    ([38, 39], "FOX Corp", "station-owner", "broadcast-tv"),
    ([40], "Disney/ABC Corp", "station-owner", "broadcast-tv"),
    ([41, 42], "CBS Corp", "station-owner", "broadcast-tv"),
    ([43], "WISC CBS-TV", "direct-vendor", "broadcast-tv"),
    (range(54, 58), "Katz Radio", "rep-firm", "broadcast-radio"),
    ([60, 61], "iHeartMedia", "direct-vendor", "broadcast-radio"),
    (range(65, 69), "Gen Media Partners", "rep-firm", "broadcast-radio"),
    ([74], "Big Radio", "direct-vendor", "broadcast-radio"),
    ([75], "BDP Communications", "direct-vendor", "broadcast-radio"),
    ([81, 82], "iHeartMedia", "direct-vendor", "digital"),
    ([85], "Locality", "rep-firm", "digital"),
    ([88, 89], "Disney/ABC Corp", "direct-vendor", "digital"),
    ([92], "MNTN", "direct-vendor", "digital"),
    ([105], "Vibe", "direct-vendor", "digital"),
    ([110], "Katz Digital", "rep-firm", "digital"),
]
for numbers, company, role, media in groups:
    fid = firm(company, role)
    for number in numbers:
        row = overview.get(number, {})
        if not row.get("F") or not row.get("G"):
            continue
        key = ident("rep", fid + row["G"].lower())
        rep = reps.setdefault(key, {"id": key, "firmId": fid, "name": row["F"].lstrip("*"), "email": row["G"], "phone": "", "active": number != 41, "notes": "", "source": "", "coverage": []})
        ref = f"Overview - Contacts!B{number}:I{number}"
        rep["source"] += ("; " if rep["source"] else "") + ref
        note = " · ".join(row.get(c, "") for c in ["E", "H", "I"] if row.get(c))
        rep["notes"] += ("\n" if rep["notes"] else "") + f"Row {number}: {note}"
        coverage = {"mediaType": media, "channelId": "", "stationId": "", "market": row.get("E", "") if 19 <= number <= 29 else "", "notes": "Workbook reference; territory not inferred from contact notes."}
        if not any(all(c[k] == coverage[k] for k in ["mediaType", "channelId", "stationId", "market"]) for c in rep["coverage"]):
            rep["coverage"].append(coverage)

# A buying platform can be a vendor even when no individual rep is supplied.
firm("Paramount+", "direct-vendor")
skipped = []
for number, row in stations.items():
    if number == 1:
        continue
    if not row.get("D") or not row.get("B"):
        if any(row.get(c) for c in ["B", "D", "F", "G"]):
            skipped.append(number)
        continue
    media = "broadcast-radio" if row.get("C", "").upper() == "RADIO" else "broadcast-tv"
    outlets.append({"id": f"station-source-{number}", "name": row["D"], "mediaType": media, "market": row["B"], "network": row.get("E", ""), "ownerFirmId": firm(row["F"], "station-owner") if row.get("F") else "", "repFirmId": firm(row["G"], "rep-firm") if row.get("G") else "", "active": True, "notes": "Station representation is a workbook reference, not a confirmed current rep assignment. " + ("Media type inferred from TV sheet/network; source Media cell is blank." if not row.get("C") else ""), "source": f"TV Stations  Owner!B{number}:L{number}"})

catalog = json.loads((root / "epic3/campaign-catalog.json").read_text())
result = {"clients": [{"id": "epic3", "name": "Epic3", "brand": "Weed Man", "marketIds": [m["id"] for m in catalog["markets"] if m["current"] and m["buyingGroup"] == "EPIC3"], "active": True, "notes": "Client owns Weed Man franchises. Current EPIC3 markets are the initial franchise locations; historical/shared markets remain in the planning catalog.", "source": "Joe's clarification, 2026-11-10; existing market catalog"}], "firms": list(firms.values()), "reps": list(reps.values()), "stations": outlets}
dest = root / "data/vendor-reference.json"
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
summary = {"source": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "counts": {k: len(v) for k, v in result.items()}, "skippedStationRows": skipped, "olderStationContactsImported": False, "digitalTabImported": False, "databaseModified": False}
(root / "data/vendor-reference-review.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
