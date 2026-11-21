"""Standard-library tests: no network, no real credentials, and no database changes."""
from __future__ import annotations

import datetime as dt
import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("retention_preview", ROOT / "ops" / "retention_preview.py")
assert spec is not None and spec.loader is not None
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
NOW = dt.datetime(2026, 11, 21, 0, 0, tzinfo=dt.timezone.utc)


def payload(**changes):
    base = {
        "dry_run": True,
        "scanned": 1,
        "request_files": 2,
        "request_deliverables": 1,
        "invalid_metadata": 0,
        "cutoff": (NOW - dt.timedelta(days=90)).isoformat().replace("+00:00", "Z"),
    }
    base.update(changes)
    return base


class FakeResponse:
    status = 200
    def __init__(self, body): self._data = io.BytesIO(body)
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, n): return self._data.read(n)


class RetentionPreviewTests(unittest.TestCase):
    def test_explicit_nonmutating_post_and_pinned_endpoint(self):
        seen = []
        def opener(request, *, timeout):
            seen.append((request, timeout))
            return FakeResponse(json.dumps(payload()).encode())
        r = preview.request_preview("example-test-secret", opener=opener, now=NOW)
        self.assertEqual(r["scanned"], 1)
        request, timeout = seen[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, preview.ENDPOINT)
        self.assertTrue(request.full_url.endswith("?dry_run=1"))
        self.assertEqual(request.get_header("Authorization"), "Bearer example-test-secret")
        self.assertEqual(timeout, 25)

    def test_no_secret_no_network(self):
        def invalid_opener(*args, **kwargs):
            self.fail("network must not occur")
        with self.assertRaises(preview.PreviewError):
            preview.request_preview("", opener=invalid_opener)

    def test_rejects_no_dry_run(self):
        with self.assertRaises(preview.PreviewError):
            preview.validate_payload(payload(dry_run=False), now=NOW)

    def test_rejects_unexpected_identifiers_and_missing_field(self):
        for change in ({"request_id": "some-client-id"}, {"deleted": 1}):
            with self.subTest(change=change), self.assertRaises(preview.PreviewError):
                preview.validate_payload(payload(**change), now=NOW)
        invalid = payload()
        del invalid["cutoff"]
        with self.assertRaises(preview.PreviewError):
            preview.validate_payload(invalid, now=NOW)

    def test_rejects_invalid_counts(self):
        for change in ({"scanned": -1}, {"scanned": True}, {"scanned": 101},
                       {"invalid_metadata": 3}, {"request_files": "2"}):
            with self.subTest(change=change), self.assertRaises(preview.PreviewError):
                preview.validate_payload(payload(**change), now=NOW)

    def test_rejects_stale_and_timezone_less_cutoff(self):
        with self.assertRaises(preview.PreviewError):
            preview.validate_payload(payload(cutoff="2025-01-01T00:00:00Z"), now=NOW)
        with self.assertRaises(preview.PreviewError):
            preview.validate_payload(payload(cutoff="2026-08-23T00:00:00"), now=NOW)

    def test_rejects_large_or_invalid_response(self):
        for body in (b"!", b"x" * (preview.MAX_BYTES + 1)):
            with self.subTest(size=len(body)), self.assertRaises(preview.PreviewError):
                preview.request_preview("test", opener=lambda *a, **k: FakeResponse(body), now=NOW)

    def test_zero_counts_are_valid(self):
        r = preview.validate_payload(payload(scanned=0, request_files=0, request_deliverables=0), now=NOW)
        self.assertEqual(r["scanned"], 0)

    def test_failure_message_never_includes_credentials(self):
        with patch.dict("os.environ", {"RETENTION_CRON_SECRET": "client-sensitive-value"}):
            with patch.object(preview, "request_preview", side_effect=preview.PreviewError("transport_error")):
                stderr = io.StringIO()
                with patch("sys.stderr", stderr):
                    self.assertEqual(preview.main(), 1)
                self.assertNotIn("client-sensitive-value", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
