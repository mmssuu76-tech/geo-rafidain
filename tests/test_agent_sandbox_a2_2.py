"""A2.2 offline sandbox contract: no real Docker daemon or network used here."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

HERE = Path(__file__).resolve().parents[1] / "agent_service" / "runtime_deployment"
sys.path.insert(0, str(HERE))
from sandbox_smoke import (
    BASE_IMAGE, IMAGE_TAG, MEMORY_BYTES, SandboxRefused,
    build_docker_create_args, main as smoke_main, prepare_synthetic_fixture,
    run_smoke, trusted_docker_environment, validate_created_container, validate_docker_endpoint,
)
from sandbox_probe import validate_synthetic_snapshot, ProbeFailure


def valid_inspect():
    return [{
        "HostConfig": {
            "NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
            "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges:true"],
            "PidsLimit": 64, "Memory": MEMORY_BYTES, "MemorySwap": MEMORY_BYTES,
            "NanoCpus": 500_000_000, "Binds": None,
            "Tmpfs": {"/tmp": "rw,noexec,nosuid,nodev,size=16m,mode=1777"},
        },
        "Config": {"User": "65532:65532"},
        "Mounts": [{"Type": "bind", "Destination": "/review", "RW": False}],
    }]


class SandboxContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.fixture, self.sha = prepare_synthetic_fixture(self.root)

    def test_static_probe_does_not_invoke_docker(self):
        with patch("subprocess.run", side_effect=AssertionError("offline test invoked subprocess")):
            with redirect_stdout(StringIO()) as output:
                self.assertEqual(smoke_main(["--check-only"]), 0)
        self.assertEqual(json.loads(output.getvalue())["docker_executed"], False)

    def test_pinned_image_declared_and_narrow_context(self):
        dockerfile = (HERE / "Dockerfile").read_text()
        self.assertIn("FROM " + BASE_IMAGE, dockerfile)
        self.assertRegex(BASE_IMAGE, r"@sha256:[a-f0-9]{64}$")
        self.assertIn("USER 65532:65532", dockerfile)
        self.assertNotIn("RUN pip", dockerfile)
        self.assertNotIn("RUN apt", dockerfile)
        self.assertIn("!sandbox_probe.py", (HERE / ".dockerignore").read_text())
        self.assertNotIn("--privileged", dockerfile)

    def test_build_args_fixed_non_privileged_network_none(self):
        name = "geo-a22-" + "a" * 20
        cmd = build_docker_create_args(IMAGE_TAG, self.fixture, self.sha, name)
        self.assertEqual(cmd[:2], ["docker", "create"])
        self.assertEqual(cmd[cmd.index("--network") + 1], "none")
        self.assertIn("--read-only", cmd)
        self.assertEqual(cmd[cmd.index("--cap-drop") + 1], "ALL")
        self.assertEqual(cmd[cmd.index("--user") + 1], "65532:65532")
        self.assertNotIn("--privileged", cmd)
        self.assertNotIn("--network=host", cmd)
        self.assertEqual(sum("type=bind" in s for s in cmd), 1)
        self.assertTrue(any("dst=/review,readonly" in s for s in cmd))
        self.assertNotIn("OPENAI_API_KEY", " ".join(cmd))
        self.assertNotIn("SUPABASE", " ".join(cmd))

    def test_unapproved_image_denied(self):
        with self.assertRaises(SandboxRefused):
            build_docker_create_args("alpine:latest", self.fixture, self.sha, "geo-a22-" + "a" * 20)

    def test_no_arbitrary_container_name_or_manifest(self):
        for name in ("../../../host", "test", "geo-a22-" + "Z" * 20):
            with self.subTest(name=name), self.assertRaises(SandboxRefused):
                build_docker_create_args(IMAGE_TAG, self.fixture, self.sha, name)
        with self.assertRaises(SandboxRefused):
            build_docker_create_args(IMAGE_TAG, self.fixture, "INVALID", "geo-a22-" + "a" * 20)

    def test_no_remote_docker_context_override(self):
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_CONFIG"):
            with self.subTest(key=key), self.assertRaises(SandboxRefused):
                trusted_docker_environment({key: "tcp://attacker.example:2375"})

    def test_docker_environment_strips_provider_keys(self):
        env = trusted_docker_environment({"PATH": "test", "OPENAI_API_KEY": "fake", "GH_TOKEN": "fake", "SUPABASE_SERVICE_ROLE_KEY": "fake"})
        self.assertEqual(env, {"PATH": "test"})

    def test_local_context_only(self):
        validate_docker_endpoint([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
        validate_docker_endpoint([{"Endpoints": {"docker": {"Host": "npipe:////./pipe/dockerDesktopLinuxEngine"}}}])
        validate_docker_endpoint([{"Endpoints": {"docker": {"Host": "unix:///run/user/1000/docker.sock"}}}])
        for target in ("ssh://user@server", "tcp://127.0.0.1:2375", "unix:///tmp/remote.sock"):
            with self.subTest(target=target), self.assertRaises(SandboxRefused):
                validate_docker_endpoint([{"Endpoints": {"docker": {"Host": target}}}])

    def test_good_docker_inspect_policy(self):
        validate_created_container(valid_inspect())

    def test_docker_inspect_fail_closed_for_each_critical_property(self):
        changes = [
            ("HostConfig", "NetworkMode", "bridge"),
            ("HostConfig", "ReadonlyRootfs", False),
            ("HostConfig", "Privileged", True),
            ("HostConfig", "CapDrop", []),
            ("HostConfig", "SecurityOpt", []),
            ("HostConfig", "PidsLimit", -1),
            ("HostConfig", "Memory", 0),
            ("HostConfig", "MemorySwap", -1),
            ("HostConfig", "NanoCpus", 0),
            ("HostConfig", "Binds", ["/host:/mnt"]),
            ("Config", "User", "0:0"),
            ("HostConfig", "Tmpfs", {}),
        ]
        for section, key, value in changes:
            with self.subTest(field=key):
                data = valid_inspect()
                data[0][section][key] = value
                with self.assertRaises(SandboxRefused):
                    validate_created_container(data)
        data = valid_inspect()
        data[0]["Mounts"].append({"Type": "bind", "Destination": "/workspace", "RW": True})
        with self.assertRaises(SandboxRefused):
            validate_created_container(data)

    def test_snapshot_is_synthetic_readonly_for_container_user(self):
        self.assertEqual((self.fixture / "demo.py").read_bytes(), b"# synthetic non-executable fixture\nvalue = 123\n")
        if os.name != "nt":
            self.assertEqual(self.fixture.stat().st_mode & 0o777, 0o555)
            self.assertEqual((self.fixture / "demo.py").stat().st_mode & 0o777, 0o444)
            self.assertEqual((self.fixture / "review-manifest.json").stat().st_mode & 0o777, 0o444)
        info = validate_synthetic_snapshot(self.fixture, self.sha)
        self.assertTrue(info["manifest_verified"])
        self.assertEqual(info["file_count"], 1)

    def test_modified_synthetic_file_is_denied(self):
        (self.fixture / "demo.py").chmod(0o666)
        (self.fixture / "demo.py").write_bytes(b"changed")
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_manifest_digest_tampering_denied(self):
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, "f" * 64)
        (self.fixture / "review-manifest.json").chmod(0o666)
        (self.fixture / "review-manifest.json").write_bytes(b"{}")
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_extra_hidden_file_denied(self):
        self.fixture.chmod(0o777)
        (self.fixture / ".env").write_text("SYNTHETIC_TEST=1")
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_unexpected_empty_directory_denied(self):
        self.fixture.chmod(0o777)
        (self.fixture / "unexpected-dir").mkdir()
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_source_code_never_executed_by_snapshot_parser(self):
        # Fake fixture deliberately contains a dangerous-looking expression.
        # It must be treated as inert bytes; the probe performs no import/eval.
        (self.fixture / "demo.py").chmod(0o666)
        (self.fixture / "demo.py").write_bytes(b"import os; os.system('echo do-not-execute')\n")
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_symlink_rejected_when_supported(self):
        self.fixture.chmod(0o777)
        try:
            (self.fixture / "unexpected.py").symlink_to("demo.py")
        except OSError:
            self.skipTest("Symlinks unavailable")
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, self.sha)

    def test_probe_rejects_duplicate_manifest_paths(self):
        manifest = self.fixture / "review-manifest.json"
        data = json.loads(manifest.read_text())
        data["files"].append(dict(data["files"][0]))
        raw = json.dumps(data).encode("utf-8")
        manifest.chmod(0o666)
        manifest.write_bytes(raw)
        with self.assertRaises(ProbeFailure):
            validate_synthetic_snapshot(self.fixture, hashlib.sha256(raw).hexdigest())

    def test_probe_rejects_unexpected_outside_file(self):
        (self.root / "extra.txt").write_text("OUTSIDE")
        info = validate_synthetic_snapshot(self.fixture, self.sha)
        self.assertEqual(info["file_count"], 1)

    def test_simulated_docker_execution_uses_synthetic_mount_and_cleans_up(self):
        commands = []
        def pretend_checked(argv, **kwargs):
            commands.append(argv)
            if argv[:3] == ["docker", "context", "inspect"]:
                return json.dumps([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
            if argv[:2] == ["docker", "info"]:
                return json.dumps({"OSType": "linux", "SecurityOptions": ["name=seccomp,profile=builtin"]})
            if argv[:2] == ["docker", "inspect"] and "--format" not in argv:
                return json.dumps(valid_inspect())
            if argv[:3] == ["docker", "inspect", "--format"]:
                return "0"
            if argv[:3] == ["docker", "start", "--attach"]:
                return json.dumps({"status": "PASS", "bundle": {"manifest_verified": True},
                                   "checks": {"no_outbound_network": True, "non_root": True}})
            return ""
        with patch("sandbox_smoke.trusted_docker_environment", return_value={"PATH": "test"}), \
             patch("sandbox_smoke.shutil.which", return_value="/usr/bin/docker"), \
             patch("sandbox_smoke._checked", side_effect=pretend_checked), \
             patch("sandbox_smoke._docker") as cleanup:
            result = run_smoke()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["model_calls"], 0)
        creates = [c for c in commands if c[:2] == ["docker", "create"]]
        self.assertEqual(len(creates), 1)
        self.assertTrue(any("review-bundle" in item and "dst=/review,readonly" in item for item in creates[0]))
        self.assertTrue(any("--network" == item for item in creates[0]))
        self.assertEqual(cleanup.call_count, 1)
        self.assertEqual(cleanup.call_args.args[0][:3], ["docker", "rm", "--force"])

    def test_failed_docker_policy_still_cleans_container(self):
        def pretend_checked(argv, **kwargs):
            if argv[:3] == ["docker", "context", "inspect"]:
                return json.dumps([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
            if argv[:2] == ["docker", "info"]:
                return json.dumps({"OSType": "linux", "SecurityOptions": ["name=seccomp,profile=builtin"]})
            if argv[:2] == ["docker", "inspect"]:
                broken = valid_inspect()
                broken[0]["HostConfig"]["NetworkMode"] = "bridge"
                return json.dumps(broken)
            return ""
        with patch("sandbox_smoke.trusted_docker_environment", return_value={"PATH": "test"}), \
             patch("sandbox_smoke.shutil.which", return_value="/usr/bin/docker"), \
             patch("sandbox_smoke._checked", side_effect=pretend_checked), \
             patch("sandbox_smoke._docker") as cleanup:
            with self.assertRaises(SandboxRefused):
                run_smoke()
        self.assertEqual(cleanup.call_count, 1)

    def test_no_api_sdk_or_prod_credentials_in_probe(self):
        source = (HERE / "sandbox_probe.py").read_text()
        self.assertNotIn("from agents import", source)
        self.assertNotIn("openai-agents", source)
        self.assertNotIn("supabase.create_client", source)
        self.assertNotIn("subprocess.run", source)


if __name__ == "__main__":
    unittest.main()
