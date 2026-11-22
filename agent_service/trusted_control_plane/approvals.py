"""A2.3 OFFLINE signed approval ledger (not a deployed identity or API service).

Only a separate trusted controller may own this module's signing key, database,
and IdentityVerifier. The development agent and its SDK tools must never receive
those capabilities. No verifier, key provider, or issuance CLI is shipped.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import stat
import re
import secrets
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

SHA256 = re.compile(r"[a-f0-9]{64}\Z")
REFERENCE = re.compile(r"grt_[A-Za-z0-9_-]{30,60}\Z")
PRINCIPAL = re.compile(r"[A-Za-z0-9@._:-]{3,160}\Z")
SCOPE = "agent.review.preflight"
VERSION = 1
DOMAIN = b"geo-rafidain/a2.3/approval-record/v1\0"


@dataclass(frozen=True)
class VerifiedHumanConsent:
    """Result from an *external trusted* authentication AND user-confirmation service.

    This object alone does not authenticate anybody; only the caller-supplied
    IdentityVerifier can do so, and none is provided in the application.
    """
    principal_id: str
    approved_request_digest: str
    approved_at: int
    authenticated_at: int
    scope: str
    mfa_verified: bool


class IdentityVerifier(Protocol):
    def verify_human_consent(self, assertion: str, requested_digest: str) -> VerifiedHumanConsent | None: ...


class DenyIdentityVerifier:
    def verify_human_consent(self, assertion: str, requested_digest: str) -> None:
        return None


@dataclass(frozen=True)
class ApprovalConfig:
    issuer: str
    audience: str
    max_ttl_seconds: int = 300
    max_consent_age_seconds: int = 60
    max_auth_age_seconds: int = 300

    def __post_init__(self) -> None:
        safe = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}\Z")
        if (not isinstance(self.issuer, str) or not safe.fullmatch(self.issuer)
                or not isinstance(self.audience, str) or not safe.fullmatch(self.audience)):
            raise ValueError("Invalid issuer/audience")
        for n in ("max_ttl_seconds", "max_consent_age_seconds", "max_auth_age_seconds"):
            v = getattr(self, n)
            if type(v) is not int or not 1 <= v <= 3600:
                raise ValueError("Invalid approval time constraint")


class SignedApprovalLedger:
    """Single-host offline SQLite ledger, cryptographic integrity + atomic consume.

    Does NOT provide user authentication, an HTTP gateway, a trusted clock, DB
    rollback protection, distributed consensus, or production-ready key storage.
    An attacker with the signing key or a privileged host is out of scope.
    """
    def __init__(self, database: str | Path, *, signing_key: bytes,
                 config: ApprovalConfig, identity_verifier: IdentityVerifier | None = None,
                 clock: Callable[[], float] = time.time):
        if not isinstance(database, (str, Path)) or str(database) == ":memory:":
            raise ValueError("A persistent, private local SQLite path is required")
        db = Path(database).expanduser()
        if not db.is_absolute() or not db.parent.is_dir() or db.is_symlink():
            raise ValueError("Approval DB must be a non-symlink absolute local path in an existing directory")
        if os.name == "posix" and stat.S_IMODE(db.parent.stat().st_mode) & 0o077:
            raise ValueError("Approval DB parent must be private (0700-style) on POSIX")
        if type(signing_key) is not bytes or len(signing_key) < 32:
            raise ValueError("Signing key must be a secret of at least 32 bytes")
        if not isinstance(config, ApprovalConfig) or not callable(clock):
            raise ValueError("Invalid trusted configuration")
        if identity_verifier is not None and not callable(getattr(identity_verifier, "verify_human_consent", None)):
            raise ValueError("Invalid identity verifier")
        # Create a private file, never silently chmod someone else's DB.
        # On Windows, POSIX chmod does not replace Windows ACL isolation.
        if db.exists():
            if (not db.is_file() or db.stat().st_nlink != 1
                    or (os.name == "posix" and stat.S_IMODE(db.stat().st_mode) & 0o077)):
                raise ValueError("Existing ledger file must be private and regular")
        else:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(db, flags, 0o600)
            os.close(fd)
        self._db = db
        self._key = hmac.digest(signing_key, DOMAIN, "sha256")
        self._config = config
        self._verifier = identity_verifier or DenyIdentityVerifier()
        self._clock = clock
        with closing(self._connect()) as con:
            con.execute("""CREATE TABLE IF NOT EXISTS approval_grants (
                 reference TEXT PRIMARY KEY, claims TEXT NOT NULL, mac TEXT NOT NULL,
                 consumed_at INTEGER, created_at INTEGER NOT NULL
                 )""")

    def __repr__(self) -> str:
        return "SignedApprovalLedger(<private>)"

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(str(self._db), timeout=3.0, isolation_level=None)
        con.execute("PRAGMA busy_timeout = 3000")
        return con

    def _now(self) -> int:
        n = self._clock()
        if not isinstance(n, (int, float)) or not 0 <= n < 2**50:
            raise ValueError("Invalid clock")
        return int(n)

    @staticmethod
    def _encode(value: dict) -> str:
        return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))

    def _mac(self, serialized: str) -> str:
        return hmac.new(self._key, serialized.encode("ascii"), hashlib.sha256).hexdigest()

    def _valid_consent(self, consent: object, requested_digest: str, now: int) -> bool:
        if not isinstance(consent, VerifiedHumanConsent):
            return False
        if (not isinstance(consent.principal_id, str) or not PRINCIPAL.fullmatch(consent.principal_id)
                or type(consent.mfa_verified) is not bool or consent.mfa_verified is not True
                or consent.scope != SCOPE or consent.approved_request_digest != requested_digest):
            return False
        for age, ceiling in ((consent.approved_at, self._config.max_consent_age_seconds),
                             (consent.authenticated_at, self._config.max_auth_age_seconds)):
            if type(age) is not int or not 0 <= now - age <= ceiling:
                return False
        return True

    def issue_for_verified_human(self, assertion: str, request_digest: str, *, ttl_seconds: int = 60) -> str | None:
        """Offline issuance only after externally verified human approval.

        No built-in verifier issues approvals; the real identity provider and
        explicit human confirmation UI are future integration requirements.
        """
        if (not isinstance(assertion, str) or not 1 <= len(assertion) <= 4096
                or not isinstance(request_digest, str) or not SHA256.fullmatch(request_digest)
                or type(ttl_seconds) is not int or not 1 <= ttl_seconds <= self._config.max_ttl_seconds):
            return None
        try:
            now = self._now()
            consent = self._verifier.verify_human_consent(assertion, request_digest)
            if not self._valid_consent(consent, request_digest, now):
                return None
            ref = "grt_" + secrets.token_urlsafe(32)
            claims = {
                "version": VERSION, "issuer": self._config.issuer,
                "audience": self._config.audience, "scope": SCOPE,
                "reference": ref, "request_digest": request_digest,
                "subject_tag": hmac.new(self._key, b"subject\0" + consent.principal_id.encode("utf-8"), hashlib.sha256).hexdigest(),
                "issued_at": now, "not_before": now, "expires_at": now + ttl_seconds,
                "nonce": secrets.token_hex(16),
            }
            serialized = self._encode(claims)
            mac = self._mac(serialized)
            with closing(self._connect()) as con:
                con.execute("BEGIN IMMEDIATE")
                con.execute("INSERT INTO approval_grants (reference, claims, mac, consumed_at, created_at) VALUES (?, ?, ?, NULL, ?)",
                            (ref, serialized, mac, now))
                con.commit()
            return ref
        except Exception:
            # Untrusted/misconfigured verifier or local DB error: fail closed.
            # No assertion, identity or signing key is returned or logged.
            return None

    def verify_and_consume(self, reference: str, request_digest: str) -> bool:
        """A2.1 ApprovalVerifier compatible; atomic single-use, no execution grant."""
        if (not isinstance(reference, str) or not REFERENCE.fullmatch(reference)
                or not isinstance(request_digest, str) or not SHA256.fullmatch(request_digest)):
            return False
        try:
            now = self._now()
            with closing(self._connect()) as con:
                con.execute("BEGIN IMMEDIATE")
                row = con.execute("SELECT claims, mac, consumed_at FROM approval_grants WHERE reference = ?", (reference,)).fetchone()
                if row is None or row[2] is not None:
                    con.rollback()
                    return False
                serialized, stored_mac, _ = row
                if (not isinstance(serialized, str) or not isinstance(stored_mac, str)
                        or not hmac.compare_digest(self._mac(serialized), stored_mac)):
                    con.rollback()
                    return False
                claims = json.loads(serialized)
                expected_fields = {"version", "issuer", "audience", "scope", "reference", "request_digest",
                                   "subject_tag", "issued_at", "not_before", "expires_at", "nonce"}
                if (type(claims) is not dict or set(claims) != expected_fields
                        or type(claims["version"]) is not int or claims["version"] != VERSION
                        or claims["issuer"] != self._config.issuer
                        or claims["audience"] != self._config.audience
                        or claims["scope"] != SCOPE
                        or claims["reference"] != reference
                        or not isinstance(claims["subject_tag"], str) or not SHA256.fullmatch(claims["subject_tag"])
                        or not isinstance(claims["nonce"], str) or not re.fullmatch(r"[0-9a-f]{32}", claims["nonce"])
                        or not hmac.compare_digest(claims["request_digest"], request_digest)
                        or any(type(claims[f]) is not int for f in ("issued_at", "not_before", "expires_at"))
                        or not claims["issued_at"] <= claims["not_before"] <= now < claims["expires_at"]
                        or claims["expires_at"] - claims["issued_at"] > self._config.max_ttl_seconds):
                    con.rollback()
                    return False
                cur = con.execute("UPDATE approval_grants SET consumed_at = ? WHERE reference = ? AND consumed_at IS NULL", (now, reference))
                if cur.rowcount != 1:
                    con.rollback()
                    return False
                con.commit()
                return True
        except (sqlite3.Error, ValueError, TypeError, KeyError, OSError, OverflowError):
            return False
