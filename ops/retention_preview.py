#!/usr/bin/env python3
"""Fail-closed, aggregate-only PREVIEW for Geo Rafidain retention cleanup.

This tool has no live/delete mode. It never accepts a caller-provided URL.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Callable

ENDPOINT = (
    "https://nrvewrdwmonlzamsvdjm.supabase.co/functions/v1/"
    "retention-cleanup?dry_run=1"
)
MAX_BYTES = 16_384
REQUIRED_FIELDS = {
    "dry_run", "invalid_metadata", "scanned", "request_files",
    "request_deliverables", "cutoff",
}


class PreviewError(Exception):
    """Sanitized operational error; never contains response body or credentials."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise PreviewError("redirect_disallowed")


def validate_payload(payload: Any, *, now: dt.datetime | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != REQUIRED_FIELDS:
        raise PreviewError("unexpected_response_shape")
    if payload["dry_run"] is not True:
        raise PreviewError("preview_not_confirmed")
    for key in ("scanned", "invalid_metadata", "request_files", "request_deliverables"):
        value = payload[key]
        if type(value) is not int or value < 0:
            raise PreviewError("invalid_aggregate_count")
    if payload["scanned"] > 100 or payload["invalid_metadata"] > payload["scanned"]:
        raise PreviewError("aggregate_out_of_bounds")

    cutoff = payload["cutoff"]
    if not isinstance(cutoff, str):
        raise PreviewError("invalid_cutoff")
    try:
        actual = dt.datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PreviewError("invalid_cutoff") from None
    if actual.tzinfo is None:
        raise PreviewError("invalid_cutoff_timezone")
    now = now or dt.datetime.now(dt.timezone.utc)
    expected = now.astimezone(dt.timezone.utc) - dt.timedelta(days=90)
    if abs((actual.astimezone(dt.timezone.utc) - expected).total_seconds()) > 900:
        raise PreviewError("unexpected_cutoff_age")
    return payload


def request_preview(secret: str, *, opener: Callable[..., Any] | None = None,
                    now: dt.datetime | None = None) -> dict[str, Any]:
    if not secret or not secret.strip() or "\r" in secret or "\n" in secret:
        raise PreviewError("missing_or_invalid_secret")
    req = urllib.request.Request(
        ENDPOINT,
        data=b"",  # POST; no request body and no client information
        method="POST",
        headers={
            "Authorization": "Bearer " + secret,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    try:
        with opener(req, timeout=25) as response:
            if response.status != 200:
                raise PreviewError("unexpected_http_status")
            raw = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        # Deliberately do not log response bodies, headers, URL, or exception text.
        raise PreviewError("http_status_" + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PreviewError("transport_error") from None
    if len(raw) > MAX_BYTES:
        raise PreviewError("response_too_large")
    try:
        parsed = json.loads(raw)
    except (ValueError, UnicodeError):
        raise PreviewError("invalid_json") from None
    return validate_payload(parsed, now=now)


def main() -> int:
    try:
        result = request_preview(os.environ.get("RETENTION_CRON_SECRET", ""))
    except PreviewError as exc:
        print("RETENTION_PREVIEW_FAILED=" + str(exc), file=sys.stderr)
        return 1
    except Exception:
        print("RETENTION_PREVIEW_FAILED=unexpected_error", file=sys.stderr)
        return 1

    summary = (
        f"RETENTION_PREVIEW_OK dry_run=true scanned={result['scanned']} "
        f"request_files={result['request_files']} "
        f"request_deliverables={result['request_deliverables']} "
        f"invalid_metadata={result['invalid_metadata']} cutoff={result['cutoff']}"
    )
    print(summary)
    if result["scanned"] == 100:
        print("RETENTION_PREVIEW_NOTICE=first_100_only")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        try:
            with open(summary_path, "a", encoding="utf-8") as file:
                file.write("### Retention cleanup — safe preview only\n\n")
                file.write("| Field | Aggregate result |\n|---|---|\n")
                for k in ("scanned", "request_files", "request_deliverables", "invalid_metadata", "cutoff"):
                    file.write(f"| {k} | {result[k]} |\n")
                file.write("\nNo deletions were requested. Database comparison remains a separate approval gate.\n")
        except OSError:
            print("RETENTION_PREVIEW_NOTICE=summary_write_failed")

    if result["invalid_metadata"]:
        print("RETENTION_PREVIEW_FAILED=invalid_metadata_detected", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
