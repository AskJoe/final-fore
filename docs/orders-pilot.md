# Orders pilot

The pilot uses the native `/orders` workspace. Its four tabs cover deadlines, station and mixed order planning, standalone Digital, and the reviewed 2026 archive. Existing links to `/orders.html?campaign=…&market=…` and `/legacy-orders.html` use their existing editors and Print. Their deadline links resolve to the existing saved campaign record. Legacy work can be tracked with the calendar's explicit status override. Official issue, download, and send receipts are available for pilot orders.

## Release baseline

The read-only command below returned deploy `dep-dbuoo1u7bikc73ajbq3g` as live at `959420121f5a9678c8102a8664b4e08998739080`. The pilot branch `codex/orders-integration` starts from that commit. The separate working copy that contains unpublished Avails was excluded.

```sh
render deploys list srv-dbqg4m8ae00c738a8t60 -o json | jq -c '[.[] | (.deploy // .) | select(.status == "live") | {id,status,commit:(.commit.id // .commit),finishedAt}]'
```

## Configuration and release checks

1. Keep `FINAL_FORE_ORDERS_ENABLED=0` through deployment and rollback preparations. An authorized release must apply the additive `20261122180000_orders_workspace.sql` migration, which creates the new records and private PDF bucket. The routes use the existing verified staff membership and server-only Supabase credential.
2. Set `FINAL_FORE_ORDER_ARCHIVE_PATH` to an absolute server-owned file outside any served directory. The reviewed archive is prepared by `tsx scripts/prepare-order-archive.ts --current <current-orders.json> --families <every-market.json> --coverage <model.json> --billing <planning-model.json> --output <private-absolute-path>`. It is created with exclusive write access and mode `0600`. Keep the archive and source files out of Git.
3. Install the pinned renderer at build time with `FINAL_FORE_ORDERS_INSTALL_CHROMIUM=1`. Set the same `PLAYWRIGHT_BROWSERS_PATH` in build and runtime on the approved host. Before enabling the pilot, verify that the runtime can start the bundled Chromium, has its required OS libraries, and can render and serve a multi-page PDF. The existing workbook intake and research workers use their current configuration.
4. Set `FINAL_FORE_ORDERS_PILOT_USER_IDS` to the approved staff UUIDs, then enable the flag after sign-in, readback, and PDF verification. Switching the flag off restores legacy navigation. Drafts, issues, and activity stay in their protected records.

Broadcast uses the release's paginated research data. TV benchmarks remain references until a verified quote with its schedule is available. Digital uses the EPIC3 channel workbook. Historical invoice links are shown as supporting references. New order edits and send entries have no effect on the reporting imports or research outreach queue.

## Local verification

Use the existing private `.local-migration` fixtures for the repository unit and browser checks. The Orders browser harness uses a fresh PostgreSQL 16 fixture with no published ports, fixture-only sign-in and file storage, and real Chromium PDF rendering.

```sh
npm test
npm run typecheck
npm run test:browser:build
npm run test:browser
FINAL_FORE_ORDER_ARCHIVE_PATH=<private-absolute-path> node_modules/.bin/tsx scripts/check-orders-pdf.ts
FINAL_FORE_TEST_BUILD=1 NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-test-key FINAL_FORE_ORDER_ARCHIVE_PATH=<private-absolute-path> node_modules/.bin/tsx scripts/check-orders-workflow.ts
```

The legacy browser suite passed all 31 checks in an isolated browser environment. The directory assertion now expects the 34 EPIC3 franchise markets listed in the released directory.

The local run passed 130 unit tests, typecheck, both application builds, and the Orders browser and HTTP harness. The harness opened the blank Arkansas Digital order, exercised keyboard and inline editing at 569 px, and checked finalization, a browser download, matching bytes across repeat downloads, access rejection, a recorded send, and a revision returning to in-progress status. Separate PostgreSQL checks covered retention of already scheduled dates during four-step setup, two linked orders, send corrections, and overrides.

The reviewed 2026 archive contains 110 order records, eight reference records, 815 lines, and 342 source documents. The KIGL and Weather export checks reconciled six and 20 placements respectively. Inspection of the PDFs confirmed the print logo, one-page KIGL layout, repeated Weather table header, totals, and signature lines.

The local Broadcast Research fixture adds 19 KING and 11 KONG spot quotes from the original Seattle workbooks. The Orders editor copies the rate, length, flight, and source into a draft. A separate local Supabase rehearsal applied the Orders migration and verified staff sign-in, private PDF storage, download history, send corrections, and deadline progress. Hosted staging verification is pending.
