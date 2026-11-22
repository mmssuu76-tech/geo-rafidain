"""A2.3-P1A: strict OFFLINE identity/consent acceptance boundary.

Not an authentication implementation. A separate, trusted server must verify
Supabase JWT signatures, active sessions, verified MFA factors, administrator
roles from authoritative storage, and an atomically consumed human confirmation.
The default authority denies all. Do not expose the authority interface to an LLM.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable, Protocol
from uuid import UUID

from .approvals import SCOPE, VerifiedHumanConsent

_SHA = re.compile(r"[0-9a-f]{64}\Z")
_REF = re.compile(r"gac_[A-Za-z0-9_-]{30,64}\Z")
_PROJECT = re.compile(r"[a-z0-9]{20}\Z")
_ALLOWED_METHODS = frozenset({"totp"})


@dataclass(frozen=True)
class IdentityPolicy:
    project_ref: str
    audience: str = "authenticated"
    authorized_role: str = "admin"
    max_mfa_age_seconds: int = 300
    max_consent_age_seconds: int = 60
    max_session_check_age_seconds: int = 10

    def __post_init__(self) -> None:
        if not isinstance(self.project_ref, str) or not _PROJECT.fullmatch(self.project_ref):
            raise ValueError("Project ref must be exact 20-character Supabase project ref")
        if self.audience != "authenticated" or self.authorized_role != "admin":
            raise ValueError("Only explicit authenticated/admin controls are supported")
        for name in ("max_mfa_age_seconds", "max_consent_age_seconds", "max_session_check_age_seconds"):
            value = getattr(self, name)
            if type(value) is not int or not 1 <= value <= 300:
                raise ValueError("Invalid freshness constraint")

    @property
    def issuer(self) -> str:
        return f"https://{self.project_ref}.supabase.co/auth/v1"


@dataclass(frozen=True)
class CheckedHumanApproval:
    """Output of a privileged authority, never a client/agent-supplied DTO.

    These booleans are not self-authenticating. The authority's implementation
    must produce them ONLY after checks against the real Supabase Auth service
    and a private single-use consent store. This structure alone proves nothing.
    """
    user_id: str
    session_id: str
    issuer: str
    audience: str
    jwt_role: str
    is_anonymous: bool
    signature_verified: bool
    session_active: bool
    session_checked_at: int
    token_issued_at: int
    token_expires_at: int
    aal: str
    verified_factor_active: bool
    last_mfa_method: str
    last_mfa_at: int
    authoritative_role: str
    role_from_server_lookup: bool
    approved_request_digest: str
    approved_scope: str
    human_confirmation_consumed: bool
    approved_at: int


class TrustedApprovalAuthority(Protocol):
    """Trusted backend, NOT an LLM tool, and NOT a browser-supplied callback.

    Implementer MUST: validate signed JWT (iss/aud/exp/sub/role/aal/amr);
    verify live session_id and factor status, authoritative role, and atomically
    consume a server-stored rendered-digest approval reference in one operation.
    Errors, transport failures, stale caches, or changed roles MUST deny.
    """
    def consume_verified_approval(self, reference: str, request_digest: str) -> CheckedHumanApproval | None: ...


class DenyApprovalAuthority:
    def consume_verified_approval(self, reference: str, request_digest: str) -> None:
        return None


class SupabaseMfaConsentBridge:
    """Adapter to A2.3 SignedApprovalLedger.IdentityVerifier, offline ONLY.

    Passing a fake TrustedApprovalAuthority can forge approvals; keep this
    adapter in a separate trusted control-plane process, never inside the model.
    """

    def __init__(self, policy: IdentityPolicy, *, authority: TrustedApprovalAuthority | None = None,
                 clock: Callable[[], float] = time.time) -> None:
        if not isinstance(policy, IdentityPolicy) or not callable(clock):
            raise ValueError("Invalid identity bridge configuration")
        if authority is not None and not callable(getattr(authority, "consume_verified_approval", None)):
            raise ValueError("Invalid authority interface")
        self._policy = policy
        self._authority = authority or DenyApprovalAuthority()
        self._clock = clock

    def __repr__(self) -> str:
        return "SupabaseMfaConsentBridge(<trusted-only>)"

    @staticmethod
    def _uuid(value: object) -> bool:
        if type(value) is not str:
            return False
        try:
            parsed = UUID(value)
            return str(parsed) == value
        except (ValueError, AttributeError, TypeError):
            return False

    def verify_human_consent(self, assertion: str, requested_digest: str) -> VerifiedHumanConsent | None:
        if (type(assertion) is not str or not _REF.fullmatch(assertion)
                or type(requested_digest) is not str or not _SHA.fullmatch(requested_digest)):
            return None
        try:
            now = self._clock()
            if type(now) not in (int, float) or not 0 <= now < 2**50:
                return None
            now = int(now)
            p = self._authority.consume_verified_approval(assertion, requested_digest)
            if type(p) is not CheckedHumanApproval:
                return None
            if (not self._uuid(p.user_id) or not self._uuid(p.session_id)
                    or p.issuer != self._policy.issuer
                    or p.audience != self._policy.audience
                    or p.jwt_role != "authenticated"
                    or p.is_anonymous is not False
                    or p.signature_verified is not True
                    or p.session_active is not True
                    or p.aal != "aal2"
                    or p.verified_factor_active is not True
                    or p.last_mfa_method not in _ALLOWED_METHODS
                    or p.authoritative_role != self._policy.authorized_role
                    or p.role_from_server_lookup is not True
                    or p.approved_request_digest != requested_digest
                    or p.approved_scope != SCOPE
                    or p.human_confirmation_consumed is not True):
                return None
            for stamp, max_age in (
                (p.session_checked_at, self._policy.max_session_check_age_seconds),
                (p.last_mfa_at, self._policy.max_mfa_age_seconds),
                (p.approved_at, self._policy.max_consent_age_seconds),
            ):
                if type(stamp) is not int or not 0 <= now - stamp <= max_age:
                    return None
            if (type(p.token_issued_at) is not int or type(p.token_expires_at) is not int
                    or not 0 <= p.token_issued_at <= now < p.token_expires_at
                    or p.token_expires_at - p.token_issued_at > 3600):
                return None
            # The old ledger uses authenticated_at as the recent MFA timestamp.
            return VerifiedHumanConsent(
                principal_id=p.user_id, approved_request_digest=requested_digest,
                approved_at=p.approved_at, authenticated_at=p.last_mfa_at,
                scope=SCOPE, mfa_verified=True,
            )
        except Exception:
            # Infrastructure errors must never become approval success.
            return None
