"""Offline-only A2.1 entrypoint; model invocation intentionally disabled."""

from __future__ import annotations

import argparse
import json
from .workspace import ReadOnlyWorkspace
from .review_snapshot import create_review_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description="Geo Rafidain A1 restricted development reviewer")
    parser.add_argument("--repo", required=True, help="Local source for offline checks, or reviewed snapshot for --task")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-check", action="store_true", help="Offline inventory; no API call")
    mode.add_argument("--prepare-snapshot", metavar="NEW_FOLDER", help="Create a separate offline bundle, never overwrite")
    mode.add_argument("--task", help="DISABLED until the separate A2.2 sandbox and A2.3 gateway are accepted")
    parser.add_argument("--allow-file", action="append", default=[], help="Explicitly approved relative path; repeat for each file")
    parser.add_argument("--manifest-sha256", help="Digest printed by the offline bundle creation step")
    parser.add_argument("--authorize-model-call", action="store_true", help="Explicitly acknowledge that approved content is sent to the model provider")
    parser.add_argument("--model", help="Explicit API model id, used only with --task")
    args = parser.parse_args()

    if args.self_check:
        print(json.dumps(ReadOnlyWorkspace(args.repo).test_inventory(), ensure_ascii=False, indent=2))
        return 0
    if args.prepare_snapshot:
        if not args.allow_file:
            parser.error("--prepare-snapshot needs one or more --allow-file")
        result = create_review_snapshot(args.repo, args.prepare_snapshot, args.allow_file)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    # Security hold: A2.1 is offline policy only. A1 could invoke the SDK from
    # the host once a key existed; do not re-enable it until A2.2/A2.3 gates.
    parser.error("Model calls are disabled: require accepted A2.2 sandbox and A2.3 gateway")


if __name__ == "__main__":
    raise SystemExit(main())
