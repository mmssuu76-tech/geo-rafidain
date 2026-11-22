"""A2.2 trusted-operator Docker smoke test; synthetic data ONLY.

This script is not an SDK tool. The model has no path to invoke it. No generic
command executor or user-supplied mount/source/command/image arguments exist.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT_SERVICE = HERE.parent
if str(AGENT_SERVICE) not in sys.path:
    sys.path.insert(0, str(AGENT_SERVICE))
from geo_rafidain_agents.review_snapshot import create_review_snapshot

BASE_IMAGE = "python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df"
IMAGE_TAG = "geo-rafidain-a2-2-synthetic-probe:local"
MEMORY_BYTES = 128 * 1024 * 1024
NO_REMOTE_CONTEXT = {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_CONFIG"}
LOCAL_CONTEXTS = {
    "unix:///var/run/docker.sock", "unix:///run/docker.sock",
    "npipe:////./pipe/docker_engine", "npipe:////./pipe/dockerDesktopLinuxEngine",
}


class SandboxRefused(Exception):
    pass


def _ensure(value: bool, code: str) -> None:
    if not value:
        raise SandboxRefused(code)


def trusted_docker_environment(environ: dict[str, str]) -> dict[str, str]:
    """Reject endpoint overrides; do not pass credentials to the Docker CLI."""
    _ensure(not (NO_REMOTE_CONTEXT & environ.keys()), "DOCKER_ENDPOINT_OVERRIDE_REFUSED")
    allow = {"PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT",
             "SYSTEMDRIVE", "PATHEXT", "COMSPEC", "TEMP", "TMP", "TMPDIR", "XDG_RUNTIME_DIR"}
    return {name: value for name, value in environ.items() if name.upper() in allow}


def validate_docker_endpoint(context: object) -> None:
    _ensure(isinstance(context, list) and len(context) == 1 and isinstance(context[0], dict), "BAD_DOCKER_CONTEXT")
    endpoint = context[0].get("Endpoints", {}).get("docker", {}).get("Host")
    _ensure(isinstance(endpoint, str), "BAD_DOCKER_ENDPOINT")
    local_rootless = re.fullmatch(r"unix:///run/user/[1-9][0-9]*/docker\.sock", endpoint)
    _ensure(endpoint in LOCAL_CONTEXTS or bool(local_rootless), "REMOTE_DOCKER_CONTEXT_REFUSED")


def build_docker_create_args(image: str, snapshot_folder: Path, expected_sha: str, name: str) -> list[str]:
    _ensure(image == IMAGE_TAG, "UNAPPROVED_IMAGE")
    _ensure(re.fullmatch(r"geo-a22-[0-9a-f]{20}", name) is not None, "UNSAFE_CONTAINER_NAME")
    _ensure(re.fullmatch(r"[0-9a-f]{64}", expected_sha) is not None, "BAD_MANIFEST_DIGEST")
    _ensure(snapshot_folder.is_absolute() and snapshot_folder.is_dir() and
            not snapshot_folder.is_symlink(), "BAD_SNAPSHOT_FOLDER")
    # Docker Desktop maps the synthetic temporary directory into its Linux VM.
    return [
        "docker", "create", "--name", name,
        "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
        "--memory", "128m", "--memory-swap", "128m", "--cpus", "0.5",
        "--ulimit", "nofile=1024:1024", "--user", "65532:65532",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
        "--mount", f"type=bind,src={snapshot_folder},dst=/review,readonly",
        "--env", "PYTHONDONTWRITEBYTECODE=1",
        image, "--expected-sha256", expected_sha,
    ]


def validate_created_container(metadata: object) -> None:
    """Docker daemon's effective HostConfig must match our immutable policy."""
    _ensure(isinstance(metadata, list) and len(metadata) == 1, "BAD_INSPECT_PAYLOAD")
    c = metadata[0]
    _ensure(isinstance(c, dict), "BAD_INSPECT_PAYLOAD")
    h, config = c.get("HostConfig", {}), c.get("Config", {})
    _ensure(h.get("NetworkMode") == "none", "NETWORK_NOT_DISABLED")
    _ensure(h.get("ReadonlyRootfs") is True, "ROOTFS_NOT_READONLY")
    _ensure(h.get("Privileged") is False, "PRIVILEGED_CONTAINER")
    _ensure("ALL" in (h.get("CapDrop") or []), "CAPABILITIES_NOT_DROPPED")
    _ensure(any(str(s).startswith("no-new-privileges") for s in (h.get("SecurityOpt") or [])), "NEW_PRIVILEGES_ALLOWED")
    _ensure(h.get("PidsLimit") == 64, "PIDS_UNBOUNDED")
    _ensure(h.get("Memory") == MEMORY_BYTES and h.get("MemorySwap") == MEMORY_BYTES, "MEMORY_UNBOUNDED")
    _ensure(h.get("NanoCpus") == 500_000_000, "CPU_UNBOUNDED")
    _ensure(config.get("User") == "65532:65532", "ROOT_USER")
    _ensure(not h.get("Binds"), "UNEXPECTED_BIND")
    mounts = c.get("Mounts") or []
    _ensure(len(mounts) == 1 and mounts[0].get("Destination") == "/review"
            and mounts[0].get("Type") == "bind" and mounts[0].get("RW") is False,
            "UNEXPECTED_MOUNT")
    tmp = (h.get("Tmpfs") or {}).get("/tmp", "")
    _ensure(all(flag in tmp.split(",") for flag in ("noexec", "nosuid", "nodev")) and
            "size=16m" in tmp and "mode=1777" in tmp, "UNSAFE_TMPFS")


def _docker(args: list[str], *, env: dict[str, str], timeout: int = 50) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, env=env, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SandboxRefused("DOCKER_COMMAND_UNAVAILABLE_OR_TIMED_OUT") from exc


def _checked(args: list[str], *, env: dict[str, str], timeout: int = 50) -> str:
    result = _docker(args, env=env, timeout=timeout)
    _ensure(result.returncode == 0, "DOCKER_STEP_FAILED")
    return result.stdout.strip()


def _json(value: str, label: str) -> object:
    try:
        return json.loads(value)
    except (ValueError, TypeError) as exc:
        raise SandboxRefused("INVALID_" + label + "_JSON") from exc


def prepare_synthetic_fixture(parent: Path) -> tuple[Path, str]:
    """Use ONLY artificial public strings. The real checkout is never mounted."""
    source = parent / "synthetic-source"
    source.mkdir()
    (source / "demo.py").write_bytes(b"# synthetic non-executable fixture\nvalue = 123\n")
    bundle = parent / "review-bundle"
    report = create_review_snapshot(source, bundle, ("demo.py",))
    _ensure(report["file_count"] == 1, "UNEXPECTED_FIXTURE")
    # A1 intentionally creates private 0700/0600 files. For this synthetic,
    # nonsecret Docker test ONLY, grant read permissions to UID 65532.
    (bundle / "demo.py").chmod(0o444)
    (bundle / "review-manifest.json").chmod(0o444)
    bundle.chmod(0o555)
    return bundle, report["manifest_sha256"]


def run_smoke() -> dict:
    env = trusted_docker_environment(dict(os.environ))
    _ensure(shutil.which("docker") is not None, "DOCKER_CLI_REQUIRED")
    validate_docker_endpoint(_json(_checked(["docker", "context", "inspect"], env=env), "DOCKER_CONTEXT"))
    info = _json(_checked(["docker", "info", "--format", "{{json .}}"], env=env), "DOCKER_INFO")
    _ensure(isinstance(info, dict) and info.get("OSType") == "linux", "LINUX_DAEMON_REQUIRED")
    options = info.get("SecurityOptions") or []
    _ensure(any("seccomp" in str(s) for s in options) and not any("unconfined" in str(s) for s in options), "SECCOMP_REQUIRED")
    _checked(["docker", "image", "inspect", BASE_IMAGE], env=env)
    # Build from a TWO-FILE context only; image is already locally cached by operator/CI.
    _checked(["docker", "build", "--pull=false", "--network", "none",
              "--tag", IMAGE_TAG, "--file", str(HERE / "Dockerfile"), str(HERE)],
             env=env, timeout=180)
    with tempfile.TemporaryDirectory(prefix="georafidain-a22-") as tmp:
        fixture, sha = prepare_synthetic_fixture(Path(tmp))
        name = "geo-a22-" + uuid.uuid4().hex[:20]
        created = False
        try:
            # The unique random name is ours even if `docker create` partially
            # succeeds then errors; always attempt cleanup in that case.
            created = True
            _checked(build_docker_create_args(IMAGE_TAG, fixture, sha, name), env=env)
            meta = _json(_checked(["docker", "inspect", name], env=env), "DOCKER_INSPECT")
            validate_created_container(meta)
            output = _checked(["docker", "start", "--attach", name], env=env, timeout=45)
            exit_code = _checked(["docker", "inspect", "--format", "{{.State.ExitCode}}", name], env=env)
            _ensure(exit_code == "0", "PROBE_FAILED")
            report = _json(output.splitlines()[-1], "PROBE_REPORT")
            _ensure(isinstance(report, dict) and report.get("status") == "PASS", "PROBE_DENIED")
            _ensure(report.get("bundle", {}).get("manifest_verified") is True, "BUNDLE_NOT_VERIFIED")
            checks = report.get("checks", {})
            _ensure(isinstance(checks, dict) and checks and all(v is True for v in checks.values()), "INCOMPLETE_SECURITY_PROOF")
            return {"status": "PASS", "mode": "synthetic_offline_docker", "model_calls": 0,
                    "network": "none", "approval": "NOT_AN_EXECUTION_GRANT",
                    "checks": sorted(checks), "bundle_files": 1}
        finally:
            if created:
                _docker(["docker", "rm", "--force", name], env=env, timeout=20)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="A2.2 OFFLINE Docker isolation smoke; trusted operator only")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-only", action="store_true", help="Static validation only; never contacts Docker")
    mode.add_argument("--run-docker", action="store_true", help="Explicitly execute a synthetic Docker probe")
    args = parser.parse_args(argv)
    try:
        if args.check_only:
            image = (HERE / "Dockerfile").read_text(encoding="utf-8")
            _ensure("FROM " + BASE_IMAGE in image, "DOCKERFILE_BASE_MISMATCH")
            _ensure("USER 65532:65532" in image and "ENTRYPOINT" in image, "DOCKERFILE_POLICY_MISMATCH")
            result = {"status": "PASS", "mode": "static_only", "docker_executed": False}
        else:
            result = run_smoke()
        print(json.dumps(result, sort_keys=True))
        return 0
    except SandboxRefused as exc:
        print(json.dumps({"status": "FAIL", "code": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
