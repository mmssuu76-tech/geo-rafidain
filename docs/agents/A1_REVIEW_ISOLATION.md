# A1 — Geo Rafidain agent review isolation gate

## Status and scope

Designed and locally offline-tested against A0 commit `ee9344fa46336c2a9fa272168699330d2902eb78`.
Does **not** prove a live model call, SDK integration, container enforcement, or production readiness.
PR #9 remains Draft; A1 must be reviewed separately. No autonomous GitHub, shell, SQL,
Supabase, worker deployment, or GIS execution tool is added.

## Trust boundaries

1. **Source checkout (untrusted):** may contain secrets, personal data, hidden files and
   prompt injections. Never pass its path to `--task`.
2. **Human-selected files:** operator explicitly selects 1–12 paths. Only UTF-8 permitted
   extensions are accepted (inherited from A0); symlinks and hard links are rejected.
3. **Offline snapshot builder:** creates a fresh folder **outside** the repository, never
   overwrites existing paths. Maximum 64,000 bytes/file and 192,000 bytes/bundle.
   Heuristic credential scan fails closed on common patterns, but is *not* a substitute
   for manual screening of PII, proprietary material and embedded secrets.
4. **Manifest:** records only path, SHA-256 and byte length (no source root, secrets,
   prompts or document content). Keep its digest from the offline preparation output.
5. **Model runtime:** `--task` refuses a source checkout without a manifest; verifies
   its SHA-256, all file hashes, symlinks, hard links, and unexpected files. Requires
   all paths to be restated with `--allow-file`, a short credential-scanned task, an explicit `--model`,
   `--authorize-model-call`, and a separately configured `OPENAI_API_KEY`.
6. **Tool boundary:** strictly the three read-only A0 tools. Text in source files is
   untrusted data, even when it claims to be a system instruction. A model may still
   misunderstand it; never interpret model output as an authorized action.
7. **Operating-system boundary (NOT provided here):** model SDK process must run as
   non-root in a sandbox/VM with no host repository mounts, no production credentials,
   restricted egress to the vetted API provider, resource limits and no shell access.
   This change is not that sandbox.

## Operator runbook (offline preparation only)

From the repository's project root, after selecting source files **you have read** and
confirmed contain no credentials or personal/client data:

```powershell
$env:PYTHONPATH = (Resolve-Path .\agent_service).Path
python -m geo_rafidain_agents.cli --repo . --self-check
python -m geo_rafidain_agents.cli --repo . --prepare-snapshot "$HOME\review-bundle-a1" --allow-file agent_service/geo_rafidain_agents/__init__.py
```

This prints `manifest_sha256`. The snapshot is read-only *by policy*, not an OS
read-only mount. Inspect the snapshot contents manually before using any real key.
Creating a snapshot does **not** contact OpenAI or GitHub and requires no API key.

## Optional future model smoke test (NOT AUTOMATIC, NOT YET AUTHORIZED)

Only in a separate non-production sandbox with an approved provider account:

```text
python -m geo_rafidain_agents.cli --repo <sanitized-bundle-path> --task "Review selected files" --allow-file agent_service/geo_rafidain_agents/__init__.py --manifest-sha256 <SHA256> --model <approved-model-id> --authorize-model-call
```

The SDK sends approved content to the chosen API. It disables SDK trace export by
default, which does not prevent transmission of the model request itself. No
repository writes, CI execution or Supabase changes are performed.

## Test contract

- `python -m unittest discover -s tests -p test_agent_workspace.py -v`
- `python -m unittest discover -s tests -p test_agent_review_snapshot.py -v`
- Check `git diff --check`, CI logs, and reviewer approval on A1 PR.
- Offline tests cover deny-by-default, prompt-injection tool isolation,
  SHA-256 mismatch, tampering, secret markers, symlinks and extra-file rejection.
- Fake SDK tool-contract tests are **not** a real SDK or model runtime test.
- Dynamic threat evaluation against actual models, TOCTOU on a hostile filesystem,
  red-team prompt tests, outbound egress restrictions, and evidence-retention policy
  require separate acceptance gates before production.

## Rollback

Keep A1 on its own feature branch until reviewed. Abandon/close the A1 PR rather
than force-pushing or reverting PR #9. No database rollback is needed; no database
changes are included. Do not merge A1 before its parent foundation is accepted.
