# A2.1 — Offline runtime policy preflight (security hold)

## Status / dependency

- Based on the A1 review-isolation branch at `73ea35832a30599c22cfbb5f19ba7883078999a7`.
- A0 PR #9 and A1 PR #10 are still independent **Draft** requests.
- This is a local **control-plane policy prototype**, not a working AI runtime, human identity system, trusted approval issuer, signed grant verifier, sandbox, Gateway or deployment.
- No CLI model invocation is permitted while A2.2/A2.3 are incomplete.
- Do not merge A2.1 into production before A0/A1 approval and full acceptance gates.

## What A2.1 implements

- `runtime_policy.py` is a standard-library-only deterministic offline preflight; it makes **no network request, model call, subprocess execution, GitHub mutation or SQL query**.
- Default `RuntimePolicy()` has an **empty model allowlist**, so every request is denied.
- Policy is configured by a *trusted operator/control plane*, never from untrusted model output.
- The three read-only A0 tool names are the complete allowlist; new tools require a reviewed code change.
- Hard ceilings: 12 model turns, 8,000 output tokens, 300 seconds, 10,000 cents maximum policy configuration; recommended initial limits are lower (`4`, `800`, `30`, `25`). These are *requested upper bounds*, not observed quota enforcement.
- Each request must match a `VerifiedReviewWorkspace` bundle, including exact file set and manifest SHA-256. A fresh bundle validation occurs before asking the approval verifier.
- The SHA-256 request digest binds manifest, files, task hash, model, tool names, turn/token/time/budget limits and policy version. The task content is never copied into the decision object.
- The **only provided verifier is DenyAllVerifier**. A trusted external controller must later implement `verify_and_consume` with verified human identity and authority, issuer/audience/expiry checks, signed claims and atomic single-use replay prevention. The model must never be able to construct or substitute the verifier.
- Even in offline unit tests with a fake trusted verifier, the result is labelled `PREFLIGHT_ONLY` and **`execution_authorized=False` always**.
- The A1 `cli.py --task` model-call path is **disabled** unconditionally; offline `--self-check` and `--prepare-snapshot` remain available. This prevents accidental use of the host Python process as an AI runtime.

## Important non-guarantees

- **No real cryptographic approval verification has been implemented**; the fake test verifier proves interface behavior only.
- A positive `PREFLIGHT_ONLY` result is **not an execution token** and MUST NOT be passed straight to an SDK or Gateway.
- No container sandbox, trusted clock, approval nonce database, hard cost ceiling, cancellation enforcement, isolated egress, or OS-level TOCTOU mitigation exists yet.
- A1's filename/credential scanning is heuristic and cannot prove content is safe to send to an API.
- A2.1 does not alter production GitHub, Supabase, deployment or application workflows.

## CI acceptance

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p test_agent_workspace.py -v
python -m unittest discover -s tests -p test_agent_review_snapshot.py -v
python -m unittest discover -s tests -p test_agent_runtime_policy.py -v
git diff --check
```

Run GitHub Actions on a **Draft** A2.1 PR targeting `agents/review-isolation-a1`. That PR must not merge until A0/A1 have been accepted, and until an independent security review approves these policies.

## Next strict stages

1. **A2.2**: sandbox/VM with read-only immutable snapshot mount, non-root user, no host mounts, no privileged container, resource/timeout limits, and tests that attempts to escape fail.
2. **A2.3**: trusted approval issuance and verification with replay prevention; authenticated AI Gateway with provider key outside model container, approved egress and quotas.
3. **A2.4**: SDK offline integration tests, then explicitly approved, low-budget API smoke test on **synthetic** inputs and red-team prompts. Review logging, retention and failure handling separately.
