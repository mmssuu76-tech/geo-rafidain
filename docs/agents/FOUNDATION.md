# Geo Rafidain Agent Foundation — controlled rollout

## Existing repository facts, 2026-11-22

The existing project is static HTML/CSS/JavaScript with Supabase and a Node.js test suite. It already contains `.github/workflows/phv1-security-checks.yml`, a read-only CI job, and Python retention-preview tests. This addition does **not** replace those controls. No service/deployment/API/database migration is introduced here.

## A0: Read-only development reviewer

Entry point: `agent_service/geo_rafidain_agents/cli.py`.

- Only supported model tools: `list_repository_files`, `read_repository_file`, `inspect_test_inventory`.
- **Model file-content reads are denied by default.** The operator must pass each reviewed relative path using `--allow-file` with `--task`. The self-check needs no model key or approvals.
- Approved files must be copied into a sanitized, isolated snapshot first; file name rules and approval lists do not detect every embedded credential. Never run a model task against a live repository without reviewing inputs for secrets and personal information.
- No shell, subprocess, network, write, GitHub commit, PR, deployment, Supabase credential or SQL execution tools.
- Repository input must be a separate, reviewed local snapshot. No production mounts or `.env` files. No credentials in model-visible files.
- The deterministic path policy rejects absolute paths, traversal, suspicious component names, symlinks, non-allowlisted formats, and oversized files. This is defense in depth, **not** a complete process or filesystem sandbox.
- The agent cannot *execute tests*. It can identify tests and propose reviews. CI still executes them independently.
- The SDK sends model prompts and the files the tool reads to the configured model provider. Do not give the agent confidential repositories or sensitive user data before approving the processing policy. SDK trace export is explicitly disabled in the CLI by default, not the model API request.
- Inputs from repo content may contain prompt injection. The model instructions say to ignore them, but deterministic authorization/privilege separation is the actual security boundary.
- Do not grant model-originated instructions direct access to production GitHub, Supabase, or the host shell.

## Capability matrix

| Operation | Current A0 permission | Later procedure |
| --- | --- | --- |
| List source files | Allow, restricted | Audit reads |
| Read small source file | Deny unless individually approved | Audit reads |
| Inspect existing test definitions | Allow (NOT_RUN) | Audit reads |
| Run tests | Deny | Container sandbox with network=off, time/resource limits; trusted CI |
| Propose changes | Allow as text | Human reviews diff |
| Edit repo file / create branch | Deny | External write service with user review and short-lived scoped token |
| Open pull request | Deny | Explicit approval, isolated development branch |
| Merge to main / release | Deny | Authorized human and passing protected checks |
| Run SQL / modify RLS / production deployment | Deny | Separate change-control and staging |
| Read `.env`/keys/client files | Deny | Never model-accessible |

## Deterministic acceptance gates

1. Run the offline policy tests with no API key: `python -m unittest discover -s tests -p test_agent_workspace.py -v`.
2. Set `PYTHONPATH=agent_service` and run `python -m geo_rafidain_agents.cli --repo . --self-check` on a local snapshot. Verify `execution_status` is `NOT_RUN`.
   For a future model-assisted review, first create a sanitized snapshot and explicitly select approved file paths, e.g. `--task "Review this module" --allow-file src/safe_module.py`. This still requires a separately approved API key and isolated environment.
3. Open a PR against `main`; the existing PHV1 workflow must pass, plus the new agent policy tests after applying the optional CI patch.
4. Verify no frontend production file, SQL migration, secret, Supabase configuration, or deployment flow changed.
5. Only then evaluate model-assisted review with an approved API key in an isolated environment. This kit does not prove an API-backed SDK run or production readiness.

## GIS agent reuse — proposed A1, not implemented here

Build a separate `GIS Job API` with verified identities, a `job_id`, `tenant_id`, `request_id`, `operation` allowlist, cost limit, and immutable file references rather than arbitrary filesystem paths. Store status and provenance; run GDAL/GeoPandas/Rasterio/GEE in isolated workers. A validator must check `CRS/EPSG`, input provenance and license, scene count, cloud masks, NoData coverage, pixel scale, study boundary and outputs. Do not run user Python or SQL directly from prompts. The execution service—not the LLM—must enforce tenant authorization, resource quotas and approval for external operations. For GEE, verify commercial-use terms before offering paid processing.

Future order: (A1) read-only GIS metadata inspector → (A2) sandboxed analytical jobs on synthetic datasets → (A3) approval-gated production integration. Do not introduce multi-agent handoffs before A1/A2 acceptance gates are met.
