"""A2.3 no-egress gateway preview contract, never sends requests or loads keys."""
from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_service"))
from geo_rafidain_agents.runtime_policy import PolicyDecision
from trusted_control_plane.gateway_preview import (
    GatewayPreviewDecision, GatewayPreviewRequest, OfflineGatewayPolicy,
    evaluate_gateway_preview,
)


class GatewayPreviewTests(unittest.TestCase):
    def setUp(self):
        self.digest = "a" * 64
        self.preflight = PolicyDecision(True, "PREFLIGHT_ONLY", self.digest, False)
        self.policy = OfflineGatewayPolicy(allowed_provider="openai", allowed_models=("test-model",))
        self.request = GatewayPreviewRequest("openai", "test-model", self.digest, 300, 10, 20)

    def evaluate(self, request=None, policy=None, decision=None):
        return evaluate_gateway_preview(policy if policy is not None else self.policy,
                                        request if request is not None else self.request,
                                        decision if decision is not None else self.preflight)

    def test_denies_by_default(self):
        self.assertEqual(self.evaluate(policy=OfflineGatewayPolicy()).code, "PROVIDER_DENIED")

    def test_offline_preview_is_not_execution_authority(self):
        result = self.evaluate()
        self.assertEqual(result.code, "OFFLINE_PREVIEW_ONLY")
        self.assertTrue(result.preview_permitted)
        self.assertFalse(result.execution_authorized)
        self.assertFalse(result.network_called)
        self.assertFalse(result.provider_credentials_used)

    def test_wrong_digest_denied(self):
        self.assertEqual(self.evaluate(request=replace(self.request, request_digest="b" * 64)).code,
                         "REQUEST_BINDING_MISMATCH")

    def test_failure_or_fake_execution_grant_denied(self):
        bads = [
            replace(self.preflight, preflight_passed=False),
            replace(self.preflight, code="GRANTED"),
            replace(self.preflight, execution_authorized=True),
            replace(self.preflight, request_digest=None),
        ]
        for v in bads:
            with self.subTest(v=v):
                self.assertEqual(self.evaluate(decision=v).code, "NO_VALID_OFFLINE_PREFLIGHT")

    def test_unapproved_providers_denied(self):
        for provider in ("anthropic", "http://attacker.test", "", None, 1):
            with self.subTest(provider=provider):
                self.assertEqual(self.evaluate(request=replace(self.request, provider=provider)).code, "PROVIDER_DENIED")

    def test_model_allowlist_denied(self):
        for model in ("other", "../../escape", "", None, "x" * 81):
            with self.subTest(model=model):
                self.assertEqual(self.evaluate(request=replace(self.request, model=model)).code, "MODEL_DENIED")

    def test_limit_ceiling_denied(self):
        for field, value in (("max_output_tokens", 801), ("budget_cents", 26),
                             ("timeout_seconds", 31), ("budget_cents", 0),
                             ("max_output_tokens", True), ("timeout_seconds", 1.5)):
            with self.subTest(field=field, value=value):
                self.assertEqual(self.evaluate(request=replace(self.request, **{field:value})).code, "LIMIT_DENIED")

    def test_policy_rejects_unvetted_provider(self):
        with self.assertRaises(ValueError):
            OfflineGatewayPolicy(allowed_provider="http://malicious", allowed_models=("test-model",))

    def test_policy_rejects_bad_models(self):
        with self.assertRaises(ValueError):
            OfflineGatewayPolicy(allowed_provider="openai", allowed_models=("test-model", "test-model"))

    def test_policy_rejects_bad_limits(self):
        with self.assertRaises(ValueError):
            OfflineGatewayPolicy(max_request_budget_cents=20000)

    def test_invalid_input_denied(self):
        self.assertEqual(self.evaluate(decision="fake").code, "INVALID_INPUT")
        self.assertEqual(self.evaluate(policy="fake").code, "INVALID_INPUT")
        self.assertEqual(self.evaluate(request="fake").code, "INVALID_INPUT")

    def test_preview_cannot_create_network_activity(self):
        import ast
        import inspect
        import trusted_control_plane.gateway_preview as gateway
        tree = ast.parse(inspect.getsource(gateway))
        banned = {"requests", "httpx", "urllib", "socket", "openai", "subprocess", "os"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertFalse(any(alias.name.split(".")[0] in banned for alias in node.names))
            if isinstance(node, ast.ImportFrom):
                self.assertNotIn((node.module or "").split(".")[0], banned)

    def test_decision_type_is_only_preview(self):
        fields = GatewayPreviewDecision.__dataclass_fields__
        self.assertIn("execution_authorized", fields)
        self.assertFalse(self.evaluate().execution_authorized)


if __name__ == "__main__":
    unittest.main()
