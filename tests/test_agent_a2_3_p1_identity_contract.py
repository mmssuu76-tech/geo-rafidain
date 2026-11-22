"""A2.3-P1A contract tests; all tokens/roles are synthetic and offline."""
from __future__ import annotations

import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_service"))
from trusted_control_plane.identity_contract import (
    CheckedHumanApproval, DenyApprovalAuthority, IdentityPolicy,
    SupabaseMfaConsentBridge,
)
from trusted_control_plane.approvals import ApprovalConfig, SignedApprovalLedger, SCOPE

TIME = 1_800_000_000
DIGEST = "b" * 64
REFERENCE = "gac_" + "K" * 43
USER = "123e4567-e89b-42d3-a456-426614174000"
SESSION = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
PROJECT = "abcdefghijklmnopqrst"


class Clock:
    def __init__(self):
        self.value = TIME
    def __call__(self):
        return self.value


class Authority:
    """Synthetic trusted collaborator. NOT A PRODUCTION IDENTITY ADAPTER."""
    def __init__(self, evidence):
        self.evidence = evidence
        self.calls = 0
        self.used = False
        self.fail = False
    def consume_verified_approval(self, ref, digest):
        self.calls += 1
        if self.fail:
            raise ConnectionError("simulated identity provider outage")
        if self.used or ref != REFERENCE or digest != DIGEST:
            return None
        self.used = True
        return self.evidence


def good(**kw):
    base = CheckedHumanApproval(
        user_id=USER, session_id=SESSION,
        issuer=f"https://{PROJECT}.supabase.co/auth/v1",
        audience="authenticated", jwt_role="authenticated",
        is_anonymous=False, signature_verified=True,
        session_active=True, session_checked_at=TIME,
        token_issued_at=TIME - 120,
        token_expires_at=TIME + 120,
        aal="aal2", verified_factor_active=True,
        last_mfa_method="totp", last_mfa_at=TIME - 10,
        authoritative_role="admin", role_from_server_lookup=True,
        approved_request_digest=DIGEST, approved_scope=SCOPE,
        human_confirmation_consumed=True, approved_at=TIME - 2,
    )
    return replace(base, **kw)


class IdentityContractTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.policy = IdentityPolicy(project_ref=PROJECT)
        self.authority = Authority(good())
        self.bridge = SupabaseMfaConsentBridge(self.policy, authority=self.authority, clock=self.clock)

    def check_denied(self, **changes):
        self.authority.evidence = good(**changes)
        self.assertIsNone(self.bridge.verify_human_consent(REFERENCE, DIGEST))

    def test_valid_trusted_authority_evidence(self):
        verified = self.bridge.verify_human_consent(REFERENCE, DIGEST)
        self.assertEqual(verified.principal_id, USER)
        self.assertEqual(verified.approved_request_digest, DIGEST)
        self.assertEqual(verified.scope, SCOPE)
        self.assertTrue(verified.mfa_verified)
        self.assertEqual(verified.authenticated_at, TIME - 10)

    def test_default_deny_without_trusted_authority(self):
        bridge = SupabaseMfaConsentBridge(self.policy, clock=self.clock)
        self.assertIsNone(bridge.verify_human_consent(REFERENCE, DIGEST))

    def test_deny_untrusted_reference_before_authority(self):
        self.assertIsNone(self.bridge.verify_human_consent("../secret", DIGEST))
        self.assertEqual(self.authority.calls, 0)

    def test_deny_wrong_digest_before_authority(self):
        self.assertIsNone(self.bridge.verify_human_consent(REFERENCE, "not-a-digest"))
        self.assertEqual(self.authority.calls, 0)

    def test_deny_issuer_confusion(self):
        self.check_denied(issuer="https://other-project.supabase.co/auth/v1")

    def test_deny_audience_confusion(self):
        self.check_denied(audience="anon")

    def test_deny_service_role(self):
        self.check_denied(jwt_role="service_role")

    def test_deny_anonymous_user(self):
        self.check_denied(is_anonymous=True)

    def test_deny_unsigned_jwt(self):
        self.check_denied(signature_verified=False)

    def test_deny_inactive_session(self):
        self.check_denied(session_active=False)

    def test_deny_stale_session_verification(self):
        self.check_denied(session_checked_at=TIME - 11)

    def test_deny_future_session_verification(self):
        self.check_denied(session_checked_at=TIME + 1)

    def test_deny_missing_aal2(self):
        self.check_denied(aal="aal1")

    def test_deny_unverified_factor(self):
        self.check_denied(verified_factor_active=False)

    def test_deny_phone_or_unknown_mfa_when_totp_only(self):
        for method in ("otp", "phone", "sms", "password"):
            with self.subTest(method=method):
                self.authority.used = False
                self.check_denied(last_mfa_method=method)

    def test_deny_stale_mfa(self):
        self.check_denied(last_mfa_at=TIME - 301)

    def test_deny_future_mfa(self):
        self.check_denied(last_mfa_at=TIME + 3)

    def test_deny_stale_human_approval(self):
        self.check_denied(approved_at=TIME - 61)

    def test_deny_future_human_approval(self):
        self.check_denied(approved_at=TIME + 3)

    def test_deny_role_escalation(self):
        self.check_denied(authoritative_role="customer")

    def test_deny_role_from_mutable_metadata(self):
        self.check_denied(role_from_server_lookup=False)

    def test_deny_unconsumed_confirmation(self):
        self.check_denied(human_confirmation_consumed=False)

    def test_deny_different_request_digest(self):
        self.check_denied(approved_request_digest="a" * 64)

    def test_deny_scope_confusion(self):
        self.check_denied(approved_scope="agent.deploy.production")

    def test_deny_invalid_user_id(self):
        self.check_denied(user_id="not-a-user")

    def test_deny_invalid_session_id(self):
        self.check_denied(session_id="not-a-session")

    def test_deny_expired_jwt(self):
        self.check_denied(token_expires_at=TIME)

    def test_deny_future_token_issuance(self):
        self.check_denied(token_issued_at=TIME + 1)

    def test_deny_unusually_long_token_lifetime(self):
        self.check_denied(token_issued_at=TIME - 3601, token_expires_at=TIME + 120)

    def test_deny_trusted_authority_outage(self):
        self.authority.fail = True
        self.assertIsNone(self.bridge.verify_human_consent(REFERENCE, DIGEST))

    def test_deny_repeat_confirmation_reference(self):
        self.assertIsNotNone(self.bridge.verify_human_consent(REFERENCE, DIGEST))
        self.assertIsNone(self.bridge.verify_human_consent(REFERENCE, DIGEST))

    def test_deny_bad_config(self):
        for project in ("", "../path", "ABC", "a" * 19, "a" * 21):
            with self.subTest(project=project):
                with self.assertRaises(ValueError):
                    IdentityPolicy(project_ref=project)

    def test_deny_bad_policy_freshness(self):
        with self.assertRaises(ValueError):
            IdentityPolicy(project_ref=PROJECT, max_mfa_age_seconds=301)

    def test_integration_existing_approval_ledger_remains_single_use(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / "approvals.sqlite"
            ledger = SignedApprovalLedger(
                db, signing_key=b"offline-test-only-strong-key-32+bytes",
                config=ApprovalConfig(issuer="test-controller", audience="test-preflight"),
                identity_verifier=self.bridge, clock=self.clock,
            )
            grant = ledger.issue_for_verified_human(REFERENCE, DIGEST)
            self.assertIsNotNone(grant)
            self.assertTrue(ledger.verify_and_consume(grant, DIGEST))
            self.assertFalse(ledger.verify_and_consume(grant, DIGEST))
            self.assertIsNone(ledger.issue_for_verified_human(REFERENCE, DIGEST))

    def test_module_does_not_offer_network_or_execution(self):
        self.assertFalse(hasattr(self.bridge, "call_provider"))
        self.assertFalse(hasattr(self.bridge, "execute"))
        self.assertNotIn("secret", repr(self.bridge).lower())


if __name__ == "__main__":
    unittest.main()
