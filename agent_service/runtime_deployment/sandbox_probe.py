"""Inside-container A2.2 probe. Verifies synthetic snapshot and OS constraints.

Never executes source files or starts an AI model. The trusted host-side smoke
runner alone controls Docker lifecycle and sets the expected manifest hash.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
from pathlib import Path

ROOT = Path("/review")
ALLOWED_MAX_FILES = 12
MAX_FILE_BYTES = 64_000
MAX_TOTAL_BYTES = 192_000
NO_SECRETS = {
    "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
    "DATABASE_URL", "GITHUB_TOKEN", "GH_TOKEN", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "DOCKER_HOST",
    "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY",
}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class ProbeFailure(Exception):
    pass


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise ProbeFailure(message)


def validate_synthetic_snapshot(root: Path, expected_digest: str) -> dict:
    """Parse only inert, explicitly bounded JSON/text; never imports review files."""
    ensure(isinstance(expected_digest, str) and SHA256.fullmatch(expected_digest) is not None, "BAD_EXPECTED_DIGEST")
    ensure(root.is_dir() and not root.is_symlink(), "MISSING_SNAPSHOT")
    manifest = root / "review-manifest.json"
    ensure(manifest.is_file() and not manifest.is_symlink(), "MISSING_MANIFEST")
    ensure(manifest.stat().st_size <= 16_000, "MANIFEST_TOO_LARGE")
    raw = manifest.read_bytes()
    ensure(hashlib.sha256(raw).hexdigest() == expected_digest, "MANIFEST_CHANGED")
    try:
        document = json.loads(raw)
        ensure(type(document) is dict and set(document) == {"version", "files"}, "BAD_MANIFEST_SCHEMA")
        ensure(type(document["version"]) is int and document["version"] == 1, "BAD_MANIFEST_VERSION")
        entries = document["files"]
        ensure(type(entries) is list and 1 <= len(entries) <= ALLOWED_MAX_FILES, "BAD_MANIFEST_FILES")
        expected_names: set[str] = set()
        total = 0
        for entry in entries:
            ensure(type(entry) is dict and set(entry) == {"path", "sha256", "bytes"}, "BAD_ENTRY")
            name, digest, size = entry["path"], entry["sha256"], entry["bytes"]
            ensure(type(name) is str and name != "" and "\\" not in name and ":" not in name, "BAD_ENTRY_PATH")
            parts = name.split("/")
            ensure(all(part not in ("", ".", "..") and not part.startswith(".") for part in parts), "BAD_ENTRY_PATH")
            ensure(name != "review-manifest.json" and name.casefold() not in {n.casefold() for n in expected_names}, "DUPLICATE_PATH")
            ensure(type(digest) is str and SHA256.fullmatch(digest) is not None, "BAD_ENTRY_DIGEST")
            ensure(type(size) is int and 0 <= size <= MAX_FILE_BYTES, "BAD_ENTRY_SIZE")
            file = root
            for part in parts:
                file = file / part
                ensure(not file.is_symlink(), "SYMLINK_DENIED")
            ensure(file.is_file() and file.stat().st_nlink == 1, "FILE_MISSING_OR_LINKED")
            ensure(file.stat().st_size <= MAX_FILE_BYTES, "FILE_TOO_LARGE")
            data = file.read_bytes()
            ensure(len(data) == size and hashlib.sha256(data).hexdigest() == digest, "FILE_CHANGED")
            total += len(data)
            ensure(total <= MAX_TOTAL_BYTES, "BUNDLE_TOO_LARGE")
            expected_names.add(name)
        physical: set[str] = set()
        physical_directories: set[str] = set()
        expected_directories = {
            "/".join(path.split("/")[:depth])
            for path in expected_names
            for depth in range(1, len(path.split("/")))
        }
        for folder, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                item = Path(folder) / name
                ensure(not item.is_symlink(), "SYMLINK_DENIED")
                if item.is_dir():
                    physical_directories.add(item.relative_to(root).as_posix())
                elif item.is_file():
                    ensure(item.stat().st_nlink == 1, "HARDLINK_DENIED")
                    physical.add(item.relative_to(root).as_posix())
                else:
                    raise ProbeFailure("SPECIAL_FILE_DENIED")
        ensure(physical == expected_names | {"review-manifest.json"}, "UNEXPECTED_FILES")
        ensure(physical_directories == expected_directories, "UNEXPECTED_DIRECTORIES")
        return {"file_count": len(expected_names), "total_bytes": total, "manifest_verified": True}
    except (ValueError, TypeError, KeyError, UnicodeDecodeError, OSError) as exc:
        raise ProbeFailure("INVALID_SNAPSHOT") from exc


def verify_os() -> dict:
    ensure(os.name == "posix" and os.geteuid() == 65532 and os.getegid() == 65532, "WRONG_USER")
    ensure(not any(name in os.environ for name in NO_SECRETS), "SECRET_ENV_PRESENT")
    for forbidden in ("/var/run/docker.sock", "/run/docker.sock", "/workspace", "/repo", "/host"):
        ensure(not Path(forbidden).exists(), "HOST_ACCESS_PATH_PRESENT")
    ro = getattr(os, "ST_RDONLY", 1)
    ensure(os.statvfs("/").f_flag & ro != 0, "ROOT_NOT_READONLY")
    ensure(os.statvfs(ROOT).f_flag & ro != 0, "SNAPSHOT_MOUNT_NOT_READONLY")
    # CI and Docker Desktop must enforce noexec/nosuid/nodev for the ONLY tmpfs.
    for flag_name in ("ST_NOEXEC", "ST_NOSUID", "ST_NODEV"):
        flag = getattr(os, flag_name, None)
        ensure(flag is not None and os.statvfs("/tmp").f_flag & flag != 0, "TMPFS_MISSING_" + flag_name)
    status = Path("/proc/self/status").read_text(encoding="utf-8")
    def status_value(key: str) -> str:
        m = re.search(rf"(?m)^{re.escape(key)}:\s*(\S+)", status)
        ensure(m is not None, "MISSING_PROC_" + key)
        return m.group(1)
    ensure(status_value("NoNewPrivs") == "1", "PRIVILEGE_ESCALATION_NOT_DISABLED")
    ensure(int(status_value("CapEff"), 16) == 0, "CAPABILITIES_PRESENT")
    ensure(status_value("Seccomp") == "2", "SECCOMP_NOT_FILTERED")
    # No route beyond loopback: exercise an actual outbound IPv4 connection.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.5)
        ensure(s.connect_ex(("1.1.1.1", 443)) != 0, "NETWORK_EGRESS_ALLOWED")
    return {"non_root": True, "readonly_root": True, "readonly_snapshot": True,
            "no_new_privileges": True, "capabilities_dropped": True,
            "seccomp_filtered": True, "no_outbound_network": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    try:
        os_checks = verify_os()
        bundle = validate_synthetic_snapshot(ROOT, args.expected_sha256)
    except ProbeFailure as exc:
        print(json.dumps({"status": "FAIL", "code": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps({"status": "PASS", "checks": os_checks, "bundle": bundle}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
