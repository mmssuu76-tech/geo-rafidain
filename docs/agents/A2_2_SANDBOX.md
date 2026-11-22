# A2.2 — Offline synthetic Docker isolation verification

## Scope and status

Branch: `agents/secure-sandbox-a2-2` stacked on A2.1 commit
`d88e4879135bc45e175595bdabcc58bb423a1d61` (PR #11, Draft).

This work adds **only an offline, synthetic Docker security probe** and its
trusted-operator harness. It DOES NOT run the OpenAI SDK, a real model, arbitrary
user code, GIS workers, SQL, or a production service. The old `--task` CLI path
remains disabled. A0/A1/A2.1 must be reviewed and accepted independently.

## Key architecture decisions

- The `sandbox_smoke.py` host-side operator script is **not available to the LLM**.
  It uses fixed Docker CLI arguments, never `shell=True`, never accepts arbitrary
  host mounts, Docker image IDs, Docker commands, or model-originated arguments.
- The only mounted host folder is a freshly generated **synthetic** review snapshot
  from A1. No real repository checkout, `.env`, SSH key, Supabase secret, GitHub
  credential, or Docker socket may be mounted.
- Image build uses the small `agent_service/runtime_deployment` context with
  `.dockerignore` permitting only `Dockerfile` and `sandbox_probe.py`. The public
  official Python base image is pinned by its multiarch SHA-256 index digest.
  Image acquisition is a separate **trusted host/CI operation requiring Internet**;
  the resulting probe container has `--network none`.
- `docker create` is checked with `docker inspect` for effective settings **before**
  container start; the probe then checks isolation from **inside** the container.
- The host script refuses remote Docker contexts and Docker endpoint override
  variables. The Docker CLI necessarily talks to the local Docker daemon and is
  privileged trusted operator code; never call it from model tools or prompts.
- Standard user `65532:65532`, read-only rootfs and synthetic bundle, dropped
  capabilities, `no-new-privileges`, default seccomp filter, `--network none`,
  `/tmp` as a restricted 16 MiB tmpfs, 128 MiB memory+swap ceiling, 0.5 CPU,
  64 PID maximum, and operator-enforced timeouts. No host socket mounts.
- Image contains only a read-only probe, not agent code. The probe **does not
  import/execute** source files or initiate model API calls.

## Prerequisites

- Offline unit tests: Python >=3.12, standard library; Docker not required.
- Actual isolation smoke: Docker Desktop Linux containers + WSL2, or Linux Docker
  engine with default seccomp enabled. Use only a **trusted local Docker daemon**,
  never a production or remote engine. Pulling the pinned public image consumes
  bandwidth and writes only to the local Docker image cache.
- On machines with a nonstandard remote/custom Docker context, the runner fails
  closed. It does not modify daemon configuration, contexts, firewalls or networks.

## Runbook — offline static checks (safe without Docker)

From project root:

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p test_agent_workspace.py -v
python -m unittest discover -s tests -p test_agent_review_snapshot.py -v
python -m unittest discover -s tests -p test_agent_runtime_policy.py -v
python -m unittest discover -s tests -p test_agent_sandbox_a2_2.py -v
python agent_service/runtime_deployment/sandbox_smoke.py --check-only
```

## Runbook — optional actual Docker smoke (explicit operator step)

**Do not run until you have inspected the Dockerfile, the host script and your
Docker context.** No real repository files are sent inside the container.

```powershell
docker context ls
docker version --format '{{.Server.Os}}'
docker pull python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
python agent_service/runtime_deployment/sandbox_smoke.py --run-docker
```

Expected last line is JSON containing `"status": "PASS"`,
`"mode": "synthetic_offline_docker"`, `"network": "none"`, and
`"model_calls": 0`. It prints no secret values and no real file content.
A missing local image, Docker daemon, seccomp, Docker Desktop file share, or
required mount policy is a **failure**, not grounds to weaken restrictions.

GitHub Actions adds a separate, read-only, same-repository-PR-only job to perform
this real Docker smoke test on a Linux runner. Do not count A2.2 accepted unless
both the offline tests and the **actual** smoke job complete successfully and the
job's Docker config matches the policy.

## Threat model and non-guarantees

- Smoke tests verify observable constraints for a **synthetic image and fixture**.
  They do not establish protection against container escape, a compromised kernel,
  malicious Docker plugins, a hostile Docker daemon, or an attacker modifying host
  files during review. Docker is not a hard isolation boundary against kernel bugs.
- Failures in `--read-only` or `--network none` cannot be replaced by prompts,
  application checks or fake/mocked unit tests.
- A2.2 DOES NOT provide a production executor, identity service, audit storage,
  grant signer/verifier, network egress gateway, provider API access or cost cap.
- The base-image digest must be reviewed regularly for security updates and
  vulnerability exposure; updating it requires a reviewed code/CI change.
- On Docker Desktop, the Linux VM mediates container isolation; it still does not
  justify mounting confidential source files. For higher-assurance hostile code,
  consider an isolated VM or microVM in later design reviews.
- Success of this smoke does **not** authorize A2.1 decisions for execution.
  `execution_authorized=False` remains mandatory. The CLI `--task` remains blocked.

## Rollback and change control

Abandon A2.2 feature branch / close its Draft PR if any check fails. Nothing is
merged into `main`; no database migration, deploy, production credential, shell
access tool, cloud service, or GitHub write action is added. The smoke runner's
containers are removed in a finally block even on failure. Test images remain in
local Docker cache and may be removed manually only after confirming ownership.
