"""A2.1 offline, fail-closed authorization preflight.

This is a *planning/control-plane* policy check, not a model executor,
identity provider, approval signer, OS sandbox, or network policy. The legacy
CLI model path remains disabled until separate A2.2/A2.3 acceptance gates pass.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Protocol

from .review_snapshot import (
    MAX_FILES,
    SnapshotRejected,
    VerifiedReviewWorkspace,
    validate_review_task,
)
from .workspace import AccessDenied

POLICY_VERSION = 1
READ_ONLY_TOOLS = frozenset({
    "list_repository_files", "read_repository_file", "inspect_test_inventory",
})
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")
_APPROVAL_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")


class ApprovalVerifier(Protocol):
    """TRUSTED controller interface; never implemented by the model or CLI.

    Implementation MUST atomically validate: human identity and authority,
    signed/bound request digest, issuer, audience, expiry, and one-time use.
    A2.1 provides no granting implementation and no approval-issuing endpoint.
    """

    def verify_and_consume(self, reference: str, request_digest: str) -> bool: ...


class DenyAllVerifier:
    """The only built-in verifier. There are no self-issued approvals."""

    def verify_and_consume(self, reference: str, request_digest: str) -> bool:
        return False


@dataclass(frozen=True)
class RuntimePolicy:
    # Empty model allowlist deliberately denies all requests by default.
    allowed_models: tuple[str, ...] = ()
    allowed_tools: frozenset[str] = READ_ONLY_TOOLS
    max_turns: int = 4
    max_output_tokens: int = 800
    max_duration_seconds: int = 30
    max_budget_cents: int = 25

    def __post_init__(self) -> None:
        if (not isinstance(self.allowed_models, tuple)
                or len(self.allowed_models) > 10
                or len(set(self.allowed_models)) != len(self.allowed_models)
                or any(not isinstance(m, str) or not _MODEL.fullmatch(m)
                       for m in self.allowed_models)):
            raise ValueError("Invalid trusted model allowlist")
        if not isinstance(self.allowed_tools, frozenset) or self.allowed_tools != READ_ONLY_TOOLS:
            raise ValueError("A2.1 only permits the three A0 read-only tools")
        for name, value, ceiling in (
            ("max_turns", self.max_turns, 12),
            ("max_output_tokens", self.max_output_tokens, 8_000),
            ("max_duration_seconds", self.max_duration_seconds, 300),
            ("max_budget_cents", self.max_budget_cents, 10_000),
        ):
            if type(value) is not int or not (1 <= value <= ceiling):
                raise ValueError(f"Invalid trusted policy bound: {name}")


@dataclass(frozen=True)
class RuntimeRequest:
    manifest_sha256: str
    files: tuple[str, ...]
    model: str
    task: str
    tools: tuple[str, ...]
    max_turns: int
    max_output_tokens: int
    duration_seconds: int
    budget_cents: int


@dataclass(frozen=True)
class PolicyDecision:
    # This approval is for OFFLINE preflight ONLY. No executable capability.
    preflight_passed: bool
    code: str
    request_digest: str | None = None
    execution_authorized: bool = False


def _deny(code: str) -> PolicyDecision:
    return PolicyDecision(preflight_passed=False, code=code)


def _digest(request: RuntimeRequest) -> str:
    """Bind every relevant request attribute without exposing task contents."""
    data = {
        "version": POLICY_VERSION,
        "manifest_sha256": request.manifest_sha256,
        "files": list(sorted(request.files)),
        "model": request.model,
        "task_sha256": hashlib.sha256(request.task.encode("utf-8")).hexdigest(),
        "tools": list(sorted(request.tools)),
        "max_turns": request.max_turns,
        "max_output_tokens": request.max_output_tokens,
        "duration_seconds": request.duration_seconds,
        "budget_cents": request.budget_cents,
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def evaluate_runtime_policy(
    policy: RuntimePolicy,
    request: RuntimeRequest,
    workspace: VerifiedReviewWorkspace,
    *,
    approval_reference: str | None = None,
    verifier: ApprovalVerifier | None = None,
) -> PolicyDecision:
    """Validate offline inputs and ask a trusted controller to consume approval.

    Never invokes an SDK, network API, subprocess, database, or model. Even a
    successful preflight has `execution_authorized=False` by construction.
    """
    if not isinstance(policy, RuntimePolicy) or not isinstance(request, RuntimeRequest):
        return _deny("INVALID_INPUT")
    if not isinstance(workspace, VerifiedReviewWorkspace):
        return _deny("UNVERIFIED_WORKSPACE")
    if not isinstance(request.manifest_sha256, str) or not _SHA256.fullmatch(request.manifest_sha256):
        return _deny("INVALID_MANIFEST_DIGEST")
    if (not isinstance(request.files, tuple) or not 1 <= len(request.files) <= MAX_FILES
            or any(not isinstance(p, str) for p in request.files)
            or len(set(request.files)) != len(request.files)
            or len({p.casefold() for p in request.files}) != len(request.files)):
        return _deny("INVALID_FILES")
    if (not isinstance(request.model, str) or not _MODEL.fullmatch(request.model)
            or request.model not in policy.allowed_models):
        return _deny("MODEL_NOT_ALLOWED")
    if (not isinstance(request.tools, tuple)
            or len(request.tools) != len(READ_ONLY_TOOLS)
            or any(not isinstance(tool, str) for tool in request.tools)
            or set(request.tools) != policy.allowed_tools):
        return _deny("TOOLS_NOT_ALLOWED")
    for used, ceiling in (
        (request.max_turns, policy.max_turns),
        (request.max_output_tokens, policy.max_output_tokens),
        (request.duration_seconds, policy.max_duration_seconds),
        (request.budget_cents, policy.max_budget_cents),
    ):
        if type(used) is not int or used < 1 or used > ceiling:
            return _deny("RESOURCE_LIMIT_EXCEEDED")
    try:
        validate_review_task(request.task)
    except (SnapshotRejected, UnicodeError, AttributeError, TypeError):
        return _deny("INVALID_TASK")
    if set(request.files) != workspace.approved_files:
        return _deny("FILE_SET_MISMATCH")
    # Re-open/re-verify manifest and each file before the verifier is called.
    # This does not eliminate filesystem TOCTOU; A2.2 must mount immutable data.
    try:
        verified = VerifiedReviewWorkspace(workspace.root, expected_manifest_sha256=request.manifest_sha256)
        if verified.approved_files != workspace.approved_files:
            return _deny("FILE_SET_MISMATCH")
    except (SnapshotRejected, AccessDenied, OSError, ValueError, UnicodeError):
        return _deny("BUNDLE_VALIDATION_FAILED")
    if (not isinstance(approval_reference, str)
            or not _APPROVAL_REF.fullmatch(approval_reference)):
        return _deny("APPROVAL_REQUIRED")
    if verifier is None:
        verifier = DenyAllVerifier()
    digest = _digest(request)
    # The verifier must live in a trusted controller, with real cryptographic
    # claims validation and atomic replay prevention. Neither exists in A2.1.
    try:
        granted = verifier.verify_and_consume(approval_reference, digest)
    except Exception:
        return _deny("APPROVAL_VERIFICATION_FAILED")
    if granted is not True:
        return _deny("APPROVAL_DENIED")
    return PolicyDecision(preflight_passed=True,
                          code="PREFLIGHT_ONLY",
                          request_digest=digest,
                          execution_authorized=False)
