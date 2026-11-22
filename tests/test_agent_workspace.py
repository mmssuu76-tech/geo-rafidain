"""Offline security regression tests for the read-only agent tools."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_service"))
from geo_rafidain_agents.workspace import AccessDenied, ReadOnlyWorkspace


class WorkspacePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "tests").mkdir()
        (self.root / ".github" / "workflows").mkdir(parents=True)
        (self.root / "src").mkdir()
        (self.root / ".git").mkdir()
        (self.root / "src" / "good.js").write_text("const value = 1;\n", encoding="utf-8")
        (self.root / "tests" / "checks.test.mjs").write_text("test('ok', () => {});\n")
        (self.root / "tests" / "test_sample.py").write_text("pass\n")
        (self.root / ".github" / "workflows" / "ci.yml").write_text("permissions: read\n")
        (self.root / ".env").write_text("TOKEN=TOPSECRET")
        (self.root / ".git" / "config").write_text("secret")
        self.ws = ReadOnlyWorkspace(self.root, approved_files=(
            "src/good.js", "src/alias.js", ".env", ".git/config",
            "secrets/keys.py", "id_rsa.key",
        ))

    def test_allows_read_only_review_of_regular_files(self):
        self.assertEqual(self.ws.read_file("src/good.js"), "const value = 1;\n")
        self.assertIn(".github/workflows/ci.yml", self.ws.list_files())

    def test_rejects_traversal_absolute_and_windows_paths(self):
        for path in ("../outside.py", "src/../.env", "src//good.js", "/etc/passwd",
                     r"C:\\Users\\user\\secret.js", r"src\\good.js", "./src/good.js"):
            with self.subTest(path=path), self.assertRaises(AccessDenied):
                self.ws.read_file(path)

    def test_rejects_secrets_and_git(self):
        for path in (".env", ".env.local", ".git/config", "secrets/keys.py", "id_rsa.key"):
            with self.subTest(path=path), self.assertRaises(AccessDenied):
                self.ws.read_file(path)
        self.assertNotIn(".env", self.ws.list_files())
        self.assertNotIn(".git/config", self.ws.list_files())

    def test_rejects_symlink_even_when_target_is_inside(self):
        try:
            (self.root / "src" / "alias.js").symlink_to("good.js")
        except OSError:
            self.skipTest("Symlinks unavailable")
        with self.assertRaises(AccessDenied):
            self.ws.read_file("src/alias.js")
        self.assertNotIn("src/alias.js", self.ws.list_files())

    def test_rejects_large_files_and_non_allowlisted_extensions(self):
        (self.root / "src" / "large.js").write_text("x" * 1024)
        (self.root / "src" / "doc.pdf").write_bytes(b"%PDF")
        small = ReadOnlyWorkspace(self.root, max_file_bytes=100, approved_files=("src/large.js", "src/doc.pdf"))
        with self.assertRaises(AccessDenied):
            small.read_file("src/large.js")
        with self.assertRaises(AccessDenied):
            self.ws.read_file("src/doc.pdf")

    def test_inventory_is_explicitly_not_a_test_result(self):
        result = self.ws.test_inventory()
        self.assertEqual(result["execution_status"], "NOT_RUN")
        self.assertIn("tests/checks.test.mjs", result["test_files_detected"])
        self.assertIn("tests/test_sample.py", result["test_files_detected"])
        self.assertIn(".github/workflows/ci.yml", result["ci_workflow_files_detected"])

    def test_default_denies_content_without_explicit_human_approval(self):
        locked = ReadOnlyWorkspace(self.root)
        self.assertIn("src/good.js", locked.list_files())
        with self.assertRaises(AccessDenied):
            locked.read_file("src/good.js")
        self.assertEqual(locked.test_inventory()["execution_status"], "NOT_RUN")

    def test_unapproved_content_is_never_read_and_secret_filenames_are_denied(self):
        (self.root / "src" / "other.js").write_text("safe", encoding="utf-8")
        (self.root / "src" / "api-key.json").write_text('{"token": "FAKE_SECRET"}', encoding="utf-8")
        with self.assertRaises(AccessDenied):
            self.ws.read_file("src/other.js")
        sensitive = ReadOnlyWorkspace(self.root, approved_files=("src/api-key.json",))
        with self.assertRaises(AccessDenied):
            sensitive.read_file("src/api-key.json")
        self.assertNotIn("src/api-key.json", sensitive.list_files())

    def test_suffix_and_limit_must_be_allowlisted(self):
        self.assertEqual(self.ws.list_files(suffix=".js"), ["src/good.js"])
        for suffix in (".env", ".exe"):
            with self.assertRaises(AccessDenied):
                self.ws.list_files(suffix=suffix)
        with self.assertRaises(AccessDenied):
            self.ws.list_files(limit=10000)


if __name__ == "__main__":
    unittest.main()
