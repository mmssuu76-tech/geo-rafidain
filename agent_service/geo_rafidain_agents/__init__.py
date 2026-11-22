"""Geo Rafidain agent foundation: read-only by default."""

from .workspace import ReadOnlyWorkspace, AccessDenied

__all__ = ["ReadOnlyWorkspace", "AccessDenied"]
