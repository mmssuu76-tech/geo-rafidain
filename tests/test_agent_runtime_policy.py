"""A2.1 deterministic offline policy contract. No SDK, network or secrets."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from contextlib import redirect_stderr
from io import StringIO
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_service"))
from geo_rafidain_agents.review_snapshot import (
    VerifiedReviewWorkspace, create_review_snapshot,
)
from geo_rafidain_agents.runtime_policy import (
    READ_ONLY_TOOLS, RuntimePolicy,
    RuntimeRequest, evaluate_runtime_policy,
)
from geo_rafidain_agents.cli import main


class TestApproval:
    """Offline-only fake trusted controller. Not part of production code."""

    def __init__(self):
        self.calls = []
        self.consumed = set()

    def verify_and_consume(self, reference, request_digest):
        self.calls.append((reference, request_digest))
        if reference in self.consumed:
            return False
        self.consumed.add(reference)
        return True


class RuntimePolicyTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        home = Path(temp.name)
        source = home / "source"
        source.mkdir()
        (source / "src").mkdir()
        (source / "src" / "safe.py").write_bytes(b"def add(a, b):\n    return a + b\n")
        self.source = source
        self.bundle = home / "bundle"
        created = create_review_snapshot(source, self.bundle, ("src/safe.py",))
        self.manifest_sha = created["manifest_sha256"]
        self.ws = VerifiedReviewWorkspace(self.bundle, expected_manifest_sha256=self.manifest_sha)
        self.policy = RuntimePolicy(allowed_models=("test-review-model",))
        self.request = RuntimeRequest(
            manifest_sha256=self.manifest_sha, files=("src/safe.py",),
            model="test-review-model", task="Review only the attached source",
            tools=tuple(sorted(READ_ONLY_TOOLS)), max_turns=3,
            max_output_tokens=400, duration_seconds=20, budget_cents=10,
        )

    def evaluate(self, request=None, *, policy=None, verifier=None, approval_reference="approval_01234567"):
        return evaluate_runtime_policy(policy or self.policy, request or self.request, self.ws,
                                       verifier=verifier, approval_reference=approval_reference)

    def test_default_deny_no_allowed_models(self):
        self.assertEqual(self.evaluate(policy=RuntimePolicy()).code, "MODEL_NOT_ALLOWED")

    def test_default_deny_no_verifier(self):
        self.assertEqual(self.evaluate().code, "APPROVAL_DENIED")
        self.assertFalse(self.evaluate().execution_authorized)

    def test_denial_without_reference(self):
        self.assertEqual(self.evaluate(approval_reference=None).code, "APPROVAL_REQUIRED")

    def test_only_offline_preflight_can_pass(self):
        trusted_mock = TestApproval()
        result = self.evaluate(verifier=trusted_mock)
        self.assertTrue(result.preflight_passed)
        self.assertFalse(result.execution_authorized)
        self.assertEqual(result.code, "PREFLIGHT_ONLY")
        self.assertRegex(result.request_digest, r"^[0-9a-f]{64}$")
        self.assertNotIn(self.request.task, result.request_digest)
        self.assertEqual(len(trusted_mock.calls), 1)

    def test_replay_is_rejected_by_trusted_controller(self):
        mock = TestApproval()
        self.assertTrue(self.evaluate(verifier=mock).preflight_passed)
        self.assertEqual(self.evaluate(verifier=mock).code, "APPROVAL_DENIED")

    def test_changes_to_task_change_binding(self):
        one = self.evaluate(verifier=TestApproval())
        two = self.evaluate(request=replace(self.request, task="Review different content"), verifier=TestApproval())
        self.assertNotEqual(one.request_digest, two.request_digest)

    def test_changes_to_budget_change_binding(self):
        one = self.evaluate(verifier=TestApproval())
        two = self.evaluate(request=replace(self.request, budget_cents=11), verifier=TestApproval())
        self.assertNotEqual(one.request_digest, two.request_digest)

    def test_bad_approval_reference_fails_before_verifier(self):
        mock = TestApproval()
        for value in (None, "yes", "../invalid-approval", " " * 80, "!" * 128):
            with self.subTest(value=value):
                self.assertEqual(self.evaluate(verifier=mock, approval_reference=value).code,
                                 "APPROVAL_REQUIRED")
        self.assertEqual(mock.calls, [])

    def test_manifest_sha_type_and_format_rejected(self):
        for value in (None, "not-a-digest", 1, "A" * 64):
            with self.subTest(value=value):
                self.assertEqual(self.evaluate(request=replace(self.request, manifest_sha256=value)).code,
                                 "INVALID_MANIFEST_DIGEST")

    def test_missing_and_wrong_model_denied(self):
        for bad in ("test-other-model", "", "../../malicious", "x" * 81):
            with self.subTest(bad=bad):
                self.assertEqual(self.evaluate(request=replace(self.request, model=bad)).code, "MODEL_NOT_ALLOWED")

    def test_unauthorized_tools_rejected(self):
        variations = (("run_shell",), tuple(sorted(READ_ONLY_TOOLS)) + ("run_shell",),
                      tuple(sorted(READ_ONLY_TOOLS))[:-1], tuple(sorted(READ_ONLY_TOOLS)) * 2,
                      ("read_repository_file", [], "inspect_test_inventory"))
        for tools in variations:
            with self.subTest(tools=tools):
                self.assertEqual(self.evaluate(request=replace(self.request, tools=tools)).code,
                                 "TOOLS_NOT_ALLOWED")

    def test_over_budget_and_other_limits_denied(self):
        bad = (("budget_cents", 26), ("max_turns", 5), ("max_output_tokens", 801),
               ("duration_seconds", 31), ("budget_cents", 0), ("duration_seconds", -1),
               ("max_turns", True), ("max_output_tokens", 1.5))
        for field, value in bad:
            with self.subTest(field=field, value=value):
                self.assertEqual(self.evaluate(request=replace(self.request, **{field: value})).code,
                                 "RESOURCE_LIMIT_EXCEEDED")

    def test_untrusted_policy_not_permitted_to_add_capabilities(self):
        with self.assertRaises(ValueError):
            RuntimePolicy(allowed_models=("test-review-model",), allowed_tools=frozenset({"run_shell"}))
        with self.assertRaises(ValueError):
            RuntimePolicy(allowed_models=("test-review-model",), max_budget_cents=20_000)

    def test_invalid_prompt_fails_before_verifier(self):
        mock = TestApproval()
        for text in ("", "A" * 1201, "OPENAI_API_KEY=sk-proj-FAKE012345678901234567890"):
            with self.subTest(text=text[:24]):
                self.assertEqual(self.evaluate(request=replace(self.request, task=text), verifier=mock).code,
                                 "INVALID_TASK")
        self.assertEqual(mock.calls, [])

    def test_manifest_mismatch_denied_before_verifier(self):
        mock = TestApproval()
        bad = replace(self.request, manifest_sha256="0" * 64)
        self.assertEqual(self.evaluate(request=bad, verifier=mock).code, "BUNDLE_VALIDATION_FAILED")
        self.assertFalse(mock.calls)

    def test_modified_snapshot_denied_before_verifier(self):
        (self.bundle / "src" / "safe.py").write_bytes(b"tampering\n")
        mock = TestApproval()
        self.assertEqual(self.evaluate(verifier=mock).code, "BUNDLE_VALIDATION_FAILED")
        self.assertEqual(mock.calls, [])

    def test_extra_file_denied_before_verifier(self):
        (self.bundle / "extra.txt").write_text("not approved")
        mock = TestApproval()
        self.assertEqual(self.evaluate(verifier=mock).code, "BUNDLE_VALIDATION_FAILED")
        self.assertEqual(mock.calls, [])

    def test_manifest_files_exact_required(self):
        mock = TestApproval()
        bad = replace(self.request, files=("not-approved.py",))
        self.assertEqual(self.evaluate(request=bad, verifier=mock).code, "FILE_SET_MISMATCH")
        bad = replace(self.request, files=("src/safe.py", "SRC/SAFE.PY"))
        self.assertEqual(self.evaluate(request=bad, verifier=mock).code, "INVALID_FILES")
        self.assertEqual(mock.calls, [])

    def test_unverified_workspace_rejected(self):
        from geo_rafidain_agents.workspace import ReadOnlyWorkspace
        decision = evaluate_runtime_policy(self.policy, self.request, ReadOnlyWorkspace(self.source))
        self.assertEqual(decision.code, "UNVERIFIED_WORKSPACE")

    def test_approval_verifier_failure_is_safe(self):
        class CrashingVerifier:
            def verify_and_consume(self, reference, digest):
                raise RuntimeError("secret error details must not be printed")
        decision = self.evaluate(verifier=CrashingVerifier())
        self.assertEqual(decision.code, "APPROVAL_VERIFICATION_FAILED")
        self.assertNotIn("secret", repr(decision))

    def test_approval_verifier_must_return_literal_true(self):
        class NonBooleanVerifier:
            def verify_and_consume(self, reference, digest):
                return 1
        self.assertEqual(self.evaluate(verifier=NonBooleanVerifier()).code, "APPROVAL_DENIED")

    def test_code_does_not_claim_os_or_sdk_execution(self):
        approved = self.evaluate(verifier=TestApproval())
        self.assertFalse(approved.execution_authorized)

    def test_task_path_is_disabled_even_with_valid_bundle_and_api_key(self):
        # Any future A2 runtime path must be explicitly tested separately.
        args = ["prog", "--repo", str(self.bundle), "--task", "Review source",
                "--allow-file", "src/safe.py", "--manifest-sha256", self.manifest_sha,
                "--model", "test-review-model", "--authorize-model-call"]
        with (patch.object(sys, "argv", args),
              patch.dict(os.environ, {"OPENAI_API_KEY": "fake"}),
              redirect_stderr(StringIO())):
            with self.assertRaises(SystemExit) as caught:
                main()
        self.assertEqual(caught.exception.code, 2)

    def test_prepare_snapshot_remains_offline(self):
        new_dest = self.bundle.parent / "bundle2"
        args = ["prog", "--repo", str(self.source), "--prepare-snapshot", str(new_dest),
                "--allow-file", "src/safe.py"]
        with patch.object(sys, "argv", args), patch("sys.stdout", new_callable=StringIO):
            self.assertEqual(main(), 0)
        self.assertTrue((new_dest / "review-manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
