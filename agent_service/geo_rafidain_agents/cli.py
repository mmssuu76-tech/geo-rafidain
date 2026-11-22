"""Offline self-check, explicit review-bundle creation, and guarded model invocation."""

from __future__ import annotations

import argparse
import json
import os
from .workspace import ReadOnlyWorkspace
from .review_snapshot import create_review_snapshot, VerifiedReviewWorkspace, SnapshotRejected, validate_review_task


def main() -> int:
    parser = argparse.ArgumentParser(description="Geo Rafidain A1 restricted development reviewer")
    parser.add_argument("--repo", required=True, help="Local source for offline checks, or reviewed snapshot for --task")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-check", action="store_true", help="Offline inventory; no API call")
    mode.add_argument("--prepare-snapshot", metavar="NEW_FOLDER", help="Create a separate offline bundle, never overwrite")
    mode.add_argument("--task", help="Optional model-assisted review against a verified bundle only")
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

    # Deliberate fail-closed compatibility break: --task is no longer allowed on
    # a live repository just because the operator wrote --allow-file.
    if not (args.authorize_model_call and args.manifest_sha256 and args.allow_file and args.model):
        parser.error("--task requires --authorize-model-call, --manifest-sha256, --model and --allow-file")
    try:
        validate_review_task(args.task)
        workspace = VerifiedReviewWorkspace(args.repo, expected_manifest_sha256=args.manifest_sha256)
    except SnapshotRejected as exc:
        parser.error(f"Invalid review bundle: {exc}")
    if set(args.allow_file) != workspace.approved_files or len(args.allow_file) != len(workspace.approved_files):
        parser.error("--allow-file paths must exactly match the approved manifest")
    if not os.environ.get("OPENAI_API_KEY"):
        parser.error("Set OPENAI_API_KEY only in a separately authorized, isolated environment")
    try:
        from agents import Runner, set_tracing_disabled
    except ImportError:
        parser.error("Install the pinned SDK from agent_service/requirements.txt")
    set_tracing_disabled(True)
    from .agent import build_agent
    # SDK tools are read-only; the process still needs OS isolation before general use.
    result = Runner.run_sync(build_agent(workspace, model=args.model), args.task, max_turns=6)
    print(result.final_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
