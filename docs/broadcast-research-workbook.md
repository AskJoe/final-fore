# Broadcast Research rollout

1. Start from the deployed app branch and add the workbook to the authenticated Research navigation. Reuse the existing global sidebar and file preview and download endpoints.
2. Import the existing sources as one explicit batch. Verify the 71 submission records against the 37 distinct local originals by hash. Keep each file ID, rep, firm and submission market. Publish TV, Radio, Demographics, Notes and Reference together in one database transaction. Keep source bytes and private import inputs out of Git.
3. Test the populated Next.js app against local Supabase. Compare all source and observation counts, verify rep and firm labels and links, test market review, and check that the upload files and endpoints are identical to the selected production baseline. Test member access and signed-out access.
4. Apply the additive migration and load the verified batch on the Final Fore production Supabase project. Release the tested change on the existing Render deployment branch and verify the populated sheets and original links on the live site.

File selection and a Process button can be added to staff Incoming files later. The present import is a deliberate administrator step. It uses no upload callbacks, jobs or triggers.
