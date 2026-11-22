"""Offline test-only trusted mock. No production auth provider, API or secrets."""
from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_service"))
from trusted_control_plane.approvals import (
    ApprovalConfig, SignedApprovalLedger, VerifiedHumanConsent, SCOPE,
)


class Clock:
    def __init__(self, t=1_800_000_000):
        self.t = t
    def __call__(self):
        return self.t


class FakeIdentityVerifier:
    """Deliberately a test double: NEVER valid for production issuance."""
    def __init__(self, clock):
        self.clock = clock
        self.approved = True
        self.calls = 0
        self.explicit_digest = None
    def verify_human_consent(self, assertion, requested_digest):
        self.calls += 1
        if not self.approved or assertion != "test-only-mfa-consent":
            return None
        now = self.clock()
        return VerifiedHumanConsent("test-only-human", self.explicit_digest or requested_digest,
                                    now, now, SCOPE, True)


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / "approval-test.sqlite"
        self.clock = Clock()
        self.identity = FakeIdentityVerifier(self.clock)
        self.config = ApprovalConfig(issuer="geo-test-controller", audience="geo-test-preflight")
        self.secret = b"K" * 32  # Test-only deterministic key, never ship as a credential
        self.digest = "a" * 64
        self.ledger = self.create()

    def create(self, **kw):
        return SignedApprovalLedger(kw.get("db", self.db), signing_key=kw.get("key", self.secret),
                                    config=kw.get("config", self.config),
                                    identity_verifier=kw.get("identity", self.identity),
                                    clock=kw.get("clock", self.clock))

    def issue(self, **kwargs):
        return self.ledger.issue_for_verified_human("test-only-mfa-consent", self.digest, **kwargs)

    def test_default_deny_no_identity_verifier(self):
        ledger = self.create(identity=None)
        self.assertIsNone(ledger.issue_for_verified_human("test-only-mfa-consent", self.digest))

    def test_valid_signed_single_use(self):
        grant = self.issue()
        self.assertRegex(grant, r"^grt_[A-Za-z0-9_-]{30,60}$")
        self.assertTrue(self.ledger.verify_and_consume(grant, self.digest))
        self.assertFalse(self.ledger.verify_and_consume(grant, self.digest))

    def test_approval_rejected_if_wrong_digest(self):
        self.identity.explicit_digest = "b" * 64
        self.assertIsNone(self.issue())

    def test_issue_requires_real_verified_evidence_from_callback(self):
        self.identity.approved = False
        self.assertIsNone(self.issue())

    def test_mfa_and_scope_requirements(self):
        original = self.identity.verify_human_consent
        for scope, mfa in ((SCOPE, False), ("admin.shell", True)):
            self.identity.verify_human_consent = lambda a, b, sc=scope, mf=mfa: replace(
                original(a, b), scope=sc, mfa_verified=mf)
            self.assertIsNone(self.issue())
        self.identity.verify_human_consent = original

    def test_expired_grant(self):
        ref = self.issue(ttl_seconds=2)
        self.clock.t += 2
        self.assertFalse(self.ledger.verify_and_consume(ref, self.digest))

    def test_not_yet_valid_due_clock_rollback(self):
        ref = self.issue()
        self.clock.t -= 10
        self.assertFalse(self.ledger.verify_and_consume(ref, self.digest))

    def test_ttl_fails_closed(self):
        for ttl in (0, -1, 301, 1.2, True):
            with self.subTest(ttl=ttl):
                self.assertIsNone(self.issue(ttl_seconds=ttl))

    def test_wrong_digest_does_not_consume_grant(self):
        ref = self.issue()
        self.assertFalse(self.ledger.verify_and_consume(ref, "b" * 64))
        self.assertTrue(self.ledger.verify_and_consume(ref, self.digest))

    def test_wrong_key_denied(self):
        ref = self.issue()
        verifier = self.create(key=b"Z" * 32)
        self.assertFalse(verifier.verify_and_consume(ref, self.digest))

    def test_wrong_audience_or_issuer_denied(self):
        ref = self.issue()
        for cfg in (replace(self.config, audience="another-audience"),
                    replace(self.config, issuer="another-issuer")):
            self.assertFalse(self.create(config=cfg).verify_and_consume(ref, self.digest))
        self.assertTrue(self.ledger.verify_and_consume(ref, self.digest))

    def test_claims_tamper_detected(self):
        ref = self.issue()
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("UPDATE approval_grants SET claims = ? WHERE reference = ?", ('{"sub":"attacker"}', ref))
            con.commit()
        self.assertFalse(self.ledger.verify_and_consume(ref, self.digest))

    def test_mac_tamper_detected(self):
        ref = self.issue()
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("UPDATE approval_grants SET mac = ? WHERE reference = ?", ('0' * 64, ref))
            con.commit()
        self.assertFalse(self.ledger.verify_and_consume(ref, self.digest))

    def test_signed_claims_do_not_store_raw_identity(self):
        ref = self.issue()
        with closing(sqlite3.connect(self.db)) as con:
            claims = con.execute("SELECT claims FROM approval_grants WHERE reference = ?", (ref,)).fetchone()[0]
        self.assertNotIn("test-only-human", claims)
        self.assertNotIn("test-only-mfa-consent", claims)
        self.assertNotIn(self.secret.decode(), claims)

    def test_stale_authentication_denied(self):
        original = self.identity.verify_human_consent
        self.identity.verify_human_consent = lambda a, b: replace(original(a, b), authenticated_at=self.clock.t - 301)
        self.assertIsNone(self.issue())

    def test_stale_human_consent_denied(self):
        original = self.identity.verify_human_consent
        self.identity.verify_human_consent = lambda a, b: replace(original(a, b), approved_at=self.clock.t - 61)
        self.assertIsNone(self.issue())

    def test_future_dated_evidence_denied(self):
        original = self.identity.verify_human_consent
        self.identity.verify_human_consent = lambda a, b: replace(original(a, b), approved_at=self.clock.t + 10)
        self.assertIsNone(self.issue())

    def test_invalid_reference_and_digest_denied(self):
        ref = self.issue()
        for bad in (None, "../../secrets", "grt_", "x" * 999, 1):
            self.assertFalse(self.ledger.verify_and_consume(bad, self.digest))
        for bad in (None, "a", 1, "A" * 64):
            self.assertFalse(self.ledger.verify_and_consume(ref, bad))
        self.assertTrue(self.ledger.verify_and_consume(ref, self.digest))

    def test_injection_like_reference_is_inert(self):
        self.assertFalse(self.ledger.verify_and_consume("grt_' OR 1=1 --", self.digest))

    def test_concurrent_double_consume_only_once(self):
        ref = self.issue()
        other = self.create()
        with ThreadPoolExecutor(max_workers=2) as pool:
            values = list(pool.map(lambda ledger: ledger.verify_and_consume(ref, self.digest), (self.ledger, other)))
        self.assertEqual(values.count(True), 1)
        self.assertEqual(values.count(False), 1)

    def test_approval_without_execution_interface(self):
        self.assertFalse(hasattr(self.ledger, "run_model"))
        self.assertFalse(hasattr(self.ledger, "send_request"))
        self.assertNotIn("secret", repr(self.ledger).lower())

    def test_invalid_config_rejected(self):
        with self.assertRaises(ValueError):
            ApprovalConfig(issuer="../../bad", audience="safe-audience")
        with self.assertRaises(ValueError):
            ApprovalConfig(issuer="safe-issuer", audience="safe-audience", max_ttl_seconds=0)

    def test_weak_key_rejected(self):
        with self.assertRaises(ValueError):
            self.create(key=b"short")

    def test_missing_database_parent_rejected(self):
        with self.assertRaises(ValueError):
            self.create(db=self.db.parent / "missing" / "db.sqlite")

    def test_integration_with_a2_1_is_preflight_only(self):
        from geo_rafidain_agents.review_snapshot import create_review_snapshot, VerifiedReviewWorkspace
        from geo_rafidain_agents.runtime_policy import (
            RuntimeRequest, RuntimePolicy, READ_ONLY_TOOLS, _digest, evaluate_runtime_policy,
        )
        home = self.db.parent
        src = home / "synthetic-source"
        src.mkdir()
        (src / "demo.py").write_bytes(b"value = 123\n")
        snap = home / "synthetic-review"
        result = create_review_snapshot(src, snap, ("demo.py",))
        ws = VerifiedReviewWorkspace(snap, expected_manifest_sha256=result["manifest_sha256"])
        request = RuntimeRequest(
            manifest_sha256=result["manifest_sha256"], files=("demo.py",),
            model="test-model", task="Review this synthetic file",
            tools=tuple(sorted(READ_ONLY_TOOLS)), max_turns=2,
            max_output_tokens=300, duration_seconds=20, budget_cents=10,
        )
        digest = _digest(request)
        ref = self.ledger.issue_for_verified_human("test-only-mfa-consent", digest)
        policy = RuntimePolicy(allowed_models=("test-model",))
        decision = evaluate_runtime_policy(policy, request, ws,
                                           approval_reference=ref, verifier=self.ledger)
        self.assertTrue(decision.preflight_passed)
        self.assertEqual(decision.code, "PREFLIGHT_ONLY")
        self.assertFalse(decision.execution_authorized)
        self.assertEqual(decision.request_digest, digest)
        second = evaluate_runtime_policy(policy, request, ws,
                                         approval_reference=ref, verifier=self.ledger)
        self.assertFalse(second.preflight_passed)
        self.assertEqual(second.code, "APPROVAL_DENIED")

    def test_private_database_permissions_on_posix(self):
        import os
        import stat
        if os.name != "posix":
            self.skipTest("POSIX permission semantics only")
        self.assertEqual(stat.S_IMODE(self.db.stat().st_mode), 0o600)

    def test_existing_nonprivate_db_denied_on_posix(self):
        import os
        if os.name != "posix":
            self.skipTest("POSIX permission semantics only")
        self.db.chmod(0o644)
        with self.assertRaises(ValueError):
            self.create()

    def test_invalid_grant_input_rejected_before_identity_check(self):
        initial = self.identity.calls
        self.assertIsNone(self.ledger.issue_for_verified_human("", self.digest))
        self.assertIsNone(self.ledger.issue_for_verified_human("abc", "garbage"))
        self.assertEqual(self.identity.calls, initial)


if __name__ == "__main__":
    unittest.main()
