"""Deterministic, read-only repository tools.

These guards restrict what the *agent tools* expose. They are not an OS sandbox;
run the eventual service in a restricted, unprivileged container.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from collections.abc import Iterable


class AccessDenied(ValueError):
    """The requested path is not permitted for agent inspection."""


_ALLOWED_SUFFIXES = frozenset({
    ".css", ".html", ".js", ".json", ".md", ".mjs", ".py", ".sql",
    ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
})
_DENIED_COMPONENTS = frozenset({
    ".git", ".ssh", ".venv", "venv", "node_modules", "__pycache__",
    "vendor", "dist", "build", ".next", ".npm", ".aws", ".config",
    "secrets", "private_keys", "credentials",
})
_DENIED_SUFFIXES = frozenset({".pem", ".key", ".p12", ".pfx", ".crt", ".sqlite", ".db"})
# Defense in depth only. File names cannot prove that content contains no secrets.
_SENSITIVE_FILENAME = re.compile(
    r"(?:^|[_.-])(?:secrets?|credentials?|api[-_]?keys?|private[-_]?keys?|"
    r"access[-_]?tokens?|refresh[-_]?tokens?|service[-_]?role|passwords?)"
    r"(?:[_.-]|$)", re.IGNORECASE,
)


class ReadOnlyWorkspace:
    def __init__(self, root: str | Path, *, max_file_bytes: int = 128_000,
                 approved_files: Iterable[str] = ()):
        # Fail closed: no file content is accessible until a human approves paths.
        self.approved_files = frozenset(approved_files)
        location = Path(root).expanduser().resolve(strict=True)
        if not location.is_dir():
            raise ValueError("Repository root must be an existing directory")
        if max_file_bytes < 1 or max_file_bytes > 1_000_000:
            raise ValueError("max_file_bytes must be between 1 and 1000000")
        self.root = location
        self.max_file_bytes = max_file_bytes

    @staticmethod
    def _is_allowed_component(part: str) -> bool:
        lower = part.lower()
        return bool(part) and lower not in _DENIED_COMPONENTS and not lower.startswith(".env") \
            and not lower.startswith("id_rsa") and not lower.startswith("id_ed25519") \
            and not _SENSITIVE_FILENAME.search(part)

    def _checked_file(self, relative: str) -> Path:
        if not isinstance(relative, str) or not relative or relative != relative.strip():
            raise AccessDenied("Invalid repository path")
        if "\\" in relative or "\x00" in relative or ":" in relative or relative.startswith("/"):
            raise AccessDenied("Only relative POSIX repository paths are allowed")
        parts = relative.split("/")
        if any(part in ("", ".", "..") or not self._is_allowed_component(part) for part in parts):
            raise AccessDenied("Repository path is restricted")
        target = self.root
        for part in parts:
            target = target / part
            if target.is_symlink():
                raise AccessDenied("Symlinks are not readable")
        if target.suffix.lower() not in _ALLOWED_SUFFIXES or target.suffix.lower() in _DENIED_SUFFIXES:
            raise AccessDenied("File type is not on the review allowlist")
        try:
            resolved = target.resolve(strict=True)
        except (FileNotFoundError, OSError) as exc:
            raise AccessDenied("File does not exist") from exc
        if not resolved.is_relative_to(self.root) or not resolved.is_file():
            raise AccessDenied("File must be inside the repository")
        return resolved

    def read_file(self, relative: str) -> str:
        if relative not in self.approved_files:
            raise AccessDenied("File has not been explicitly approved for model access")
        path = self._checked_file(relative)
        if path.stat().st_size > self.max_file_bytes:
            raise AccessDenied("File exceeds maximum review size")
        try:
            with path.open("r", encoding="utf-8") as handle:
                content = handle.read(self.max_file_bytes + 1)
        except (UnicodeError, OSError) as exc:
            raise AccessDenied("File cannot be decoded as UTF-8") from exc
        if len(content.encode("utf-8")) > self.max_file_bytes:
            raise AccessDenied("File exceeds maximum review size")
        return content

    def list_files(self, *, suffix: str = "", limit: int = 100) -> list[str]:
        if suffix and suffix not in _ALLOWED_SUFFIXES:
            raise AccessDenied("Suffix not permitted")
        if not isinstance(limit, int) or not (1 <= limit <= 200):
            raise AccessDenied("Limit must be 1 to 200")
        found: list[str] = []
        for dirpath, dirnames, filenames in os.walk(self.root, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames
                                 if self._is_allowed_component(d)
                                 and not (Path(dirpath) / d).is_symlink())
            for name in sorted(filenames):
                if not self._is_allowed_component(name):
                    continue
                path = Path(dirpath) / name
                if path.is_symlink() or path.suffix.lower() not in _ALLOWED_SUFFIXES:
                    continue
                if suffix and path.suffix.lower() != suffix:
                    continue
                relative = path.relative_to(self.root).as_posix()
                found.append(relative)
                if len(found) >= limit:
                    return found
        return found

    def test_inventory(self) -> dict:
        """Inventory available tests. Does not execute untrusted repository code."""
        paths = self.list_files(limit=200)
        tests = [p for p in paths if p.startswith("tests/") and
                 (p.endswith(".test.mjs") or Path(p).name.startswith("test_") and p.endswith(".py"))]
        workflows = [p for p in paths if p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml"))]
        return {
            "execution_status": "NOT_RUN",
            "test_files_detected": sorted(tests),
            "ci_workflow_files_detected": sorted(workflows),
            "recommendation": "Execute tests only in protected CI or an isolated sandbox; verify run ID and status",
        }
