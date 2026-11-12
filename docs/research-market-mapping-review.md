# Nine research market mappings

Compared the supplied `2026 Market Planner - Stations By Rep Firm (1).xlsx` against the app catalog and the catalog's original `FFM Media Analysis - Weed Man JAN2027 - Hshld_Spend (1).csv`.

The budget source SHA256 is `7fb24a9c1ea9de9671c3684dd240f4fbd082d2d18040db6b1aca30867621d39f`, matching `epic3/campaign-catalog.json`. Every row below explicitly has buying group `EPIC3/Hill`. These records already exist in the catalog. They were excluded from the original client seed because that seed included only the older digital-current EPIC3 markets.

| Template city | Planner sheet `TV Stations  Owner`, column B | Budget source row | Existing catalog ID |
|---|---|---|---|
| Cincinnati, OH | 237–254, CINCINNATI | 8 | epic3-hill-cincinnati |
| Fresno, CA | 439–444, FRESNO-VISALIA | 16 | epic3-hill-fresno-ca |
| Houston, TX | 545–551, HOUSTON | 18 | epic3-hill-houston |
| Knoxville, TN | 622–628, KNOXVILLE | 21 | epic3-hill-knoxville |
| Lexington, KY | 678–683, LEXINGTON | 22 | epic3-hill-lexington-ky |
| Memphis, TN | 753–759, MEMPHIS | 25 | epic3-hill-memphis |
| Nashville, TN | 817–823, NASHVILLE | 28 | epic3-hill-nashville |
| San Antonio, TX | 1048–1053, SAN ANTONIO | 31 | epic3-hill-san-antonio |
| Tampa, FL | 1168–1177, TAMPA-ST. PETERSBURG | 35 | epic3-hill-tampa |

Turf Ops has separate Houston, San Antonio and Fresno records in budget rows 83, 84 and 86. Their buying group and households differ. They are not the records used for these EPIC3 research templates.

Prepared changes:

- Link all nine existing records on both multi-market templates and on the Epic3 client. The client gains nine links, from 25 to 34, without creating any markets.
- Preserve the exact 29 radio and 32 TV city labels and ordering, plus the existing single-market templates.
- Update the seed generator so rebuilding the reference file retains these links.
- Keep existing cross-client ownership checks; no permission changes.
- Preserve previous upload collections and their files. New previews use the corrected template mapping.

Validation so far:

- `./node_modules/.bin/tsx --test tests/research-market-mapping.test.ts`: 1 passed, 0 failed. This new check covers each exact catalog ID/source row, the two complete template mappings, exclusion of Turf Ops, and rejection when the client links are absent or owned elsewhere.
- `npm run typecheck`: exit 0.
- `git diff --check`: exit 0, no output.
- `npm test > .local-migration/market-mapping-tests.txt 2>&1`: 96 tests, 93 passed, 3 failed. Failures are the old 25-client-market assertion, the old nine-unmapped assertion, and the publishing test's reliance on the production seed having unmapped markets. Existing tests have not been changed. Approval requested to update the counts and use an explicitly unmapped fixture for the rejection checks.

Follow-up after approval:

- User approved all three existing test updates. The tests now verify 34 client links and a fully mapped source template, then deliberately remove Cincinnati in the isolated validation/publishing fixtures to preserve the missing-link rejection checks. No guards or tests were skipped.
- `npm test`: 96 passed, 0 failed.
- `npm run typecheck && git diff --check`: exit 0.
- `npm run build`: exit 0; all pages generated.
- Live client links saved through the authenticated `/api/directory/entity` endpoint with revision 8. The browser command timed out after 3 seconds, so the write was not repeated. Read-only Supabase verification returned directory revision 9 with all 34 expected market IDs. No permissions or schema changed.

Template deployment and live preview verification pending.
