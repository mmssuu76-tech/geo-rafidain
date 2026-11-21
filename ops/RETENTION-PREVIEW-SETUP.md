# Retention cleanup: safe, aggregate-only preview schedule

**Scope:** production preview (dry_run=1), not deletion. No changes to production SQL, Auth, Storage or Edge Function. Repository changes are reviewed on a separate branch before merging to `main`.

## Guardrails

- The URL is statically pinned in `ops/retention_preview.py` to project `nrvewrdwmonlzamsvdjm` and ends with `?dry_run=1`; the script has **no live mode**.
- Job only executes on `main`, only for manual dispatch or when repository variable `RETENTION_PREVIEW_ENABLED` equals `true` for scheduled events. The variable is **not** created by this change, therefore scheduled runs initially skip.
- Trigger: daily at `01:17 UTC` (`04:17 Asia/Baghdad`). GitHub cron is not a strict real-time service and may be delayed or dropped. Manual dispatch is also available after the workflow reaches the default branch.
- Only repository secret required: `RETENTION_CRON_SECRET` with exactly the same value as deployed in Supabase Edge Function secrets. GitHub cannot read the existing Supabase secret, so the operator must provide the known value in GitHub Settings → Secrets and variables → Actions. **Do not place the value in code, logs, commits, screenshots, or chat.** Do not rotate the production value just to enable this workflow without a separate review.
- No `SUPABASE_SERVICE_ROLE_KEY`, service tokens, data-changing SQL or cleanup RPCs in Actions. Only the deployed function can read the production tables.
- A run fails closed if authentication fails, response exceeds 16 KiB, a redirect occurs, `dry_run` is not `true`, any unexpected fields (e.g. request ID) appear, counts are invalid, or cutoff is not approximately 90 days ago. Only aggregate fields are logged. Any `invalid_metadata > 0` fails the run. The preview is limited to 100 rows; 100 means more rows might exist.
- The preview result is **not** an independent database comparison. Match the preview `scanned`, `request_files`, `request_deliverables`, and `cutoff` to a contemporaneous read-only query before enabling the schedule. Small timing drift may exist for requests crossing the cutoff.
- This workflow **must never** be used to remove the maintenance block in the production Edge Function or to authorize live deletion. PHV1-FIX-011 keeps the non-deletion guard in repository source and checks it in CI. Actual cleanup requires separate explicit approval, backup, staging test, and rollback plan.

## Install safely

On your Windows machine, from a clean checkout of Geo Rafidain:

```powershell
cd C:\Users\Mayor\GeoRafidain-Development\geo-rafidain
git status --short
git fetch origin main
git switch main
git pull --ff-only origin main
git switch -c hardening/retention-dry-run-scheduler
# Extract the downloaded archive's repository files into this folder (preserve paths).
py -3 -m unittest discover -s tests -p test_retention_preview.py -v
python -m unittest discover -s tests -p test_retention_preview.py -v
# Only one of the preceding two Python commands is needed if its exit code is zero.
git add -- .github/workflows/retention-preview.yml ops/retention_preview.py ops/RETENTION-PREVIEW-SETUP.md tests/test_retention_preview.py
git diff --cached --check
git diff --cached --stat
git commit -m "PHV1: add gated dry-run retention preview workflow"
git push -u origin hardening/retention-dry-run-scheduler
gh pr create --repo mmssuu76-tech/geo-rafidain --base main --head hardening/retention-dry-run-scheduler --draft --title "PHV1: daily retention dry-run preview only" --body "REVIEW ONLY. Fixed dry_run=1 endpoint; scheduled job disabled until explicit RETENTION_PREVIEW_ENABLED=true. No secrets or production modifications. Run Python unit tests and review before merge."
```

**After review and explicit merge to `main`**: add GitHub Actions repository secret `RETENTION_CRON_SECRET` through a masked interface; run the workflow manually via Actions → Retention cleanup preview (DRY RUN ONLY) → Run workflow; verify job succeeded and `dry_run=true`, inspect counts and compare against a read-only production inventory query. Only then set repository variable `RETENTION_PREVIEW_ENABLED` to `true` to enable scheduled previews. To suspend: set it to `false` (manual dispatch remains available), or disable the workflow in GitHub Actions.

## Before approving live deletion

Verify that the *currently deployed* Edge Function (not an assumed version number) still contains the maintenance guard and that no older schedulers exist outside the repo. Document independent data counts and any `invalid_metadata` or database authorization failures. A successful scheduled preview does **not** authorize destructive operations.
