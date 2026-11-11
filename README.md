# Final Fore — Next.js and Supabase

This is the local Next.js conversion of the existing EPIC3 application. It preserves the workbook, Markets and Variables, campaign planning, campaign and earlier workbook orders, print previews, reporting data, and dashboard. The existing HTML, styles, and browser controllers are served by authenticated Next.js route handlers. The calculations and API are TypeScript; Python is used only for the read-only migration export and independent reference results.

**Real local Supabase is configured.** PostgreSQL stores application data in the persistent Docker volume `supabase_db_final-fore-local`. The remote Supabase project remains untouched. See [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md) for startup, credentials, persistence, and the distinction from the old Python app.

## Run locally

Open Docker Desktop, then run:

```sh
npm run local
```

Open <http://127.0.0.1:3107>. Sign in with `owner@example.test` / `local-test-password`. `npm run preview:local` now starts this same real local setup. Saves persist through app and backend restarts. The launcher never reseeds or resets the database.

Port 3107 is Final Fore's explicit default. The launcher checks its availability before backend startup or rebuilding; it does not stop another app to free the port. NADSP uses port 3001 and remains separate.

Use `npm run backend:stop` to stop this project's backend while retaining its volumes. Use `npm run local` to start again. The earlier Python app remains separate on port 4178 and does not share the Supabase data.

The runtime uses the local URL and publishable key in ignored `.env.local`. The browser/server helpers are in `utils/supabase`; `proxy.ts` refreshes sessions and data routes check the signed-in user's explicit membership. Public signup is disabled. Dependencies are pinned in `package.json` and `package-lock.json`.

## Review before applying Supabase changes

The following review files concern future remote application; the local schema has been applied under the separate local-setup authorization. Read [supabase/REVIEW.md](supabase/REVIEW.md).

- `supabase/schema.sql`: new tables, RLS policies, grants, and an atomic save function.
- `supabase/owner-access.sql`: one approved account, with a placeholder for Joe's verified Supabase Auth UUID.
- `.local-migration/import.sql`: private data import, generated locally and ignored by Git.
- `.local-migration/import-summary.json`: import counts and checksums.

These remain remote review artifacts. The local setup imports a separate preserved-preview snapshot into the local database only. Do not run the SQL until the project, account, and contents have been reviewed and application is explicitly approved.

## Local verification

The observed results and resolved failures are recorded in [VERIFICATION.md](VERIFICATION.md): 24 unit tests and 31 isolated browser checks passed. Seven real screen routes passed with zero browser errors; type checking and the production build passed. Real local PostgreSQL checks cover record saves, access/conflict checks, earlier persistence through an app/backend restart, and client/vendor directory saves and reloads. The directory migration preserved all 22 pre-existing records.

The exporter reads SQLite in read-only transactions and verifies source-file hashes. It generates the Python reference snapshots used by the parity tests. The import preparation checks the same hashes before generating SQL.

```sh
npm run migration:export
npm run migration:prepare
npm test
npm run typecheck
npm run build
```

Browser integration checks use a separate production build and a loopback-only mock Supabase service. They exercise the real SSR cookie adapters and Next.js routes; they do not prove that remote RLS, SQL, or project settings are correct.

```sh
npx playwright install chromium
npm run test:browser:build
npm run test:browser
```

The temporary Next.js test server reserves an available loopback port automatically and prints its URL. The mock Supabase service uses port 54329. Both close when testing ends; other running servers are left alone. Test saves exist only in memory. Test builds use `.next-local-test`; ordinary builds use `.next`. Screenshots, PDFs, and test results are saved under `.local-migration`. Existing Python test files were not changed; the conversion adds TypeScript parity/service tests and a browser integration script.

## Clients and vendors — enabled locally

Clients distinguish Epic3 from its Weed Man franchise brand and its franchise markets. The vendor directory keeps firms, their reps, media/channel/station coverage, and station ownership separate. The supplied workbook provides starting reference data, with source rows and notes retained for review. Older station-sheet contacts are not promoted over the overview contacts.

The `supabase/migrations/20261110210000_client_vendor_directory.sql` migration was approved and **applied to the local database** on November 10, 2026. Client, firm, rep, and station edits now persist in real local Supabase. UI saves, direct PostgreSQL reads, reloads, stale-save rejection, cross-origin rejection, and anonymous denial passed. Verification restored the original entry values and left no dummy entries.

The first successful directory save persisted the reference data as one versioned document: 1 client, 111 firms, 39 reps, and 1,303 stations. All 22 prior records—including their versions and timestamps—remain unchanged. The migration itself only enables the directory record kind; no remote migration was applied. See [verification](VERIFICATION.md) and [database review](supabase/REVIEW.md).

## Preservation and limitations

Media planning now defaults to one combined grid with an **All clients** option and a client filter, alongside market and year filters. Client names identify the column groups and each client retains its own rates, amounts, formulas, and save revisions. The client filter survives reload. Clients without planning data show an empty state.

The original imported workbook belongs to Epic3. Additional workbook records must declare `metadata.clientId` and use matching channel rows; this change does not duplicate Epic3's spend into new clients or add a workbook-creation/import workflow. Formula edits use the selected client's original worksheet addresses, shown in the editor. The combined-grid behavior has been exercised with two isolated fixture workbooks. After Joe approved rebuilding and restarting Final Fore, the production server on port 3000 was updated and checked against real local Supabase: All clients loads, Epic3 filtering survives reload, and no browser runtime errors were observed. Epic3 is currently the only client, with one planning workbook; the vendor directory is also persisted.

The parity checks compare all stored formulas, all three workbook views, all 28 earlier order models, saved campaigns and campaign orders, and the full reporting snapshot with the original implementation. The old source errors remain visible; they are not replaced with invented values. Campaign recovery drafts and view preferences still use browser local storage. After signing out, those local recovery drafts remain on the same browser, as before.

The imported workbook is a bounded JSON document. Saving an edit recalculates the linked sheets and commits the complete workbook plus its audit entries with an optimistic version check. This preserves atomic linked-sheet edits, but transfer size and growing audit history will need review if usage increases. Campaigns and campaign orders use separate records. Reporting is read-only to app users and split into ordered chunks; its API currently assembles the complete approximately 18 MB source snapshot, so hosting response/memory limits must be checked before deployment.

The real local database, account, and persistence have a separate verification record. No remote schema, account, RLS policy, save, or session-refresh behavior has been verified against the hosted Supabase project. Owner provisioning, SQL application, data import, live verification, and deployment remain separate approved steps.
