"""Opt-in, immutable-by-hash review bundle for the A1 model adapter.

This module is a *data minimization gate*, not a sandbox or antivirus tool.
Only explicit, human-reviewed source files can enter a new, separate bundle.
Never treat user-supplied files as trusted just because they pass these checks.
"""

from __future__ import annotations

import hashlib
import os
import json
import re
import shutil
from pathlib import Path
from collections.abc import Iterable

from .workspace import AccessDenied, ReadOnlyWorkspace

MANIFEST = "review-manifest.json"
VERSION = 1
MAX_FILES = 12
MAX_FILE_BYTES = 64_000
MAX_TOTAL_BYTES = 192_000

# Conservative detection; a passing scan does NOT mean a file has no secrets or PII.
_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", re.I),
    re.compile(r"\b(?:sk-proj-|sk-[A-Za-z0-9]{18}|ghp_|github_pat_|sb_secret_|xox[baprs]-)[A-Za-z0-9_\-]{8,}"),
    re.compile(r"(?im)^\s*(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*\S+"),
)


class SnapshotRejected(AccessDenied):
    """A source file or a prepared review bundle failed validation."""


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_bytes(data: dict) -> bytes:
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _scan(raw: bytes) -> None:
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SnapshotRejected("Review files must be UTF-8") from exc
    if any(pattern.search(content) for pattern in _SECRET_PATTERNS):
        raise SnapshotRejected("Potential credential detected: exclude or manually redact before bundling")


def _paths(values: Iterable[str]) -> tuple[str, ...]:
    if isinstance(values, (str, bytes)):
        raise SnapshotRejected("Expected an explicit list of file paths")
    items = tuple(values)
    if not 1 <= len(items) <= MAX_FILES or len(set(x.casefold() for x in items)) != len(items):
        raise SnapshotRejected("Provide 1-12 unique file paths (case-insensitive)")
    if MANIFEST in items:
        raise SnapshotRejected("Reserved manifest name")
    return items


def _safe_source_read(workspace: ReadOnlyWorkspace, relative: str) -> bytes:
    # A0 checks each component, forbids symlinks and validates suffixes.
    # On an untrusted mutating source filesystem, a separate OS sandbox is needed.
    original = workspace._checked_file(relative)
    if relative not in workspace.approved_files:
        raise SnapshotRejected("Source file was not explicitly approved")
    # Read raw bytes: platform text-mode newline conversion must not change
    # approved source content or make snapshot hashes platform-dependent.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(original, flags)
    with os.fdopen(fd, "rb") as handle:
        if os.fstat(handle.fileno()).st_nlink != 1:
            raise SnapshotRejected("Hard-linked files cannot be snapshotted")
        content = handle.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise SnapshotRejected("File exceeds the A1 per-file limit")
    _scan(content)
    return content


def create_review_snapshot(source: str | Path, destination: str | Path,
                           approved_files: Iterable[str]) -> dict:
    """Create a new offline bundle; never modify source or reuse a destination."""
    filenames = _paths(approved_files)
    root = Path(source).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise SnapshotRejected("Source must be a directory")
    supplied_dest = Path(destination).expanduser()
    if not supplied_dest.name or supplied_dest.name in (".", ".."):
        raise SnapshotRejected("Invalid destination")
    parent = supplied_dest.parent.resolve(strict=True)
    dest = parent / supplied_dest.name
    if dest.exists() or dest.is_symlink():
        raise SnapshotRejected("Destination already exists; no overwrite permitted")
    if dest.is_relative_to(root) or root.is_relative_to(dest):
        raise SnapshotRejected("Snapshot must be separate from the source repository")

    workspace = ReadOnlyWorkspace(root, max_file_bytes=MAX_FILE_BYTES,
                                  approved_files=filenames)
    files: dict[str, bytes] = {}
    total = 0
    # Validate everything before writing anything.
    for path in filenames:
        data = _safe_source_read(workspace, path)
        files[path] = data
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise SnapshotRejected("Snapshot exceeds total size allowance")
    manifest = {"version": VERSION,
                "files": [{"path": path, "sha256": _sha(files[path]), "bytes": len(files[path])}
                          for path in sorted(files)]}
    manifest_data = _canonical_bytes(manifest)
    try:
        dest.mkdir(mode=0o700)
        for path, data in files.items():
            target = dest / path
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(data)
            target.chmod(0o600)
        (dest / MANIFEST).write_bytes(manifest_data)
        (dest / MANIFEST).chmod(0o600)
    except Exception:
        # Only delete a destination directory created by THIS function.
        if dest.exists() and dest.is_dir() and not dest.is_symlink():
            shutil.rmtree(dest)
        raise
    return {"manifest_sha256": _sha(manifest_data), "file_count": len(files),
            "total_bytes": total, "destination": str(dest)}


def validate_review_task(task: str) -> None:
    """Prevent accidental credential pastes/oversized prompts; manual review still required."""
    if not isinstance(task, str) or not 1 <= len(task.strip()) <= 1_200:
        raise SnapshotRejected("Model review task must contain 1–1200 characters")
    _scan(task.encode("utf-8"))


class VerifiedReviewWorkspace(ReadOnlyWorkspace):
    """Restrict all model-visible reads and listings to a hash-pinned manifest."""

    def __init__(self, root: str | Path, *, expected_manifest_sha256: str):
        location = Path(root).expanduser().resolve(strict=True)
        if not re.fullmatch(r"[0-9a-f]{64}", expected_manifest_sha256):
            raise SnapshotRejected("Expected a SHA-256 manifest digest")
        manifest_path = location / MANIFEST
        if manifest_path.is_symlink() or not manifest_path.is_file():
            raise SnapshotRejected("No valid review manifest")
        if manifest_path.stat().st_size > 16_000:
            raise SnapshotRejected("Manifest exceeds size limit")
        manifest_data = manifest_path.read_bytes()
        if _sha(manifest_data) != expected_manifest_sha256:
            raise SnapshotRejected("Manifest digest mismatch")
        try:
            payload = json.loads(manifest_data)
            entries = payload["files"]
            if payload["version"] != VERSION or not isinstance(entries, list):
                raise ValueError("Invalid version or files")
            paths = _paths(x["path"] for x in entries)
            if len(paths) != len(entries):
                raise ValueError("Duplicate entries")
            expected = {}
            for x in entries:
                if set(x) != {"path", "sha256", "bytes"}:
                    raise ValueError("Invalid manifest fields")
                if not isinstance(x["bytes"], int) or not 0 <= x["bytes"] <= MAX_FILE_BYTES:
                    raise ValueError("Invalid size")
                if not isinstance(x["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", x["sha256"]):
                    raise ValueError("Invalid checksum")
                expected[x["path"]] = (x["sha256"], x["bytes"])
        except (KeyError, ValueError, TypeError, AttributeError) as exc:
            raise SnapshotRejected("Malformed review manifest") from exc
        super().__init__(location, max_file_bytes=MAX_FILE_BYTES, approved_files=paths)
        # Detect unexpected files including hidden names and symlinks.
        physical: set[str] = set()
        for obj in location.rglob("*"):
            if obj.is_symlink():
                raise SnapshotRejected("Snapshot contains a symlink")
            if obj.is_file():
                if obj.stat().st_nlink != 1:
                    raise SnapshotRejected("Snapshot contains a hardlink")
                physical.add(obj.relative_to(location).as_posix())
        if physical != set(paths) | {MANIFEST}:
            raise SnapshotRejected("Snapshot has missing or extra files")
        self._expected = expected
        for path in paths:
            self.read_file(path)

    def read_file(self, relative: str) -> str:
        try:
            if relative not in self.approved_files:
                raise AccessDenied("File not on review manifest")
            path = self._checked_file(relative)
            flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(path, flags)
            with os.fdopen(fd, "rb") as handle:
                raw = handle.read(MAX_FILE_BYTES + 1)
        except (AccessDenied, OSError) as exc:
            raise SnapshotRejected("File access denied by snapshot policy") from exc
        expected = self._expected[relative]
        if (len(raw), _sha(raw)) != (expected[1], expected[0]):
            raise SnapshotRejected("Approved file changed since manifest creation")
        _scan(raw)
        return raw.decode("utf-8")

    def list_files(self, *, suffix: str = "", limit: int = 100) -> list[str]:
        if suffix and suffix not in {Path(p).suffix.lower() for p in self.approved_files}:
            raise SnapshotRejected("Suffix is not present in this review bundle")
        if not isinstance(limit, int) or not 1 <= limit <= 200:
            raise SnapshotRejected("Limit must be 1 to 200")
        return sorted(p for p in self.approved_files if not suffix or Path(p).suffix.lower() == suffix)[:limit]
