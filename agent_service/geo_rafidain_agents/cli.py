"""Run offline tool validation or opt-in agent analysis on a repository snapshot."""

from __future__ import annotations

import argparse
import json
import os
from .workspace import ReadOnlyWorkspace


def main() -> int:
    parser = argparse.ArgumentParser(description="Geo Rafidain read-only development agent")
    parser.add_argument("--repo", required=True, help="Local repository snapshot (never production filesystem)")
    parser.add_argument("--self-check", action="store_true", help="Offline inventory; no API key needed")
    parser.add_argument("--task", help="Review question for the model (requires OPENAI_API_KEY)")
    parser.add_argument("--allow-file", action="append", default=[],
                        help="Human-reviewed relative file approved for model access; repeat per file")
    args = parser.parse_args()
    workspace = ReadOnlyWorkspace(args.repo, approved_files=args.allow_file)
    if args.self_check:
        print(json.dumps(workspace.test_inventory(), ensure_ascii=False, indent=2))
        return 0
    if not args.task:
        parser.error("Specify --self-check or --task")
    if not args.allow_file:
        parser.error("--task requires at least one explicit --allow-file path")
    if not os.environ.get("OPENAI_API_KEY"):
        parser.error("OPENAI_API_KEY must be set in the isolated server environment")
    try:
        from agents import Runner, set_tracing_disabled
    except ImportError as exc:
        parser.error("Install the pinned optional SDK from agent_service/requirements.txt")
        raise AssertionError("unreachable") from exc
    # Disable SDK trace export by default; model API calls still transmit reviewed content.
    set_tracing_disabled(True)
    from .agent import build_agent
    result = Runner.run_sync(build_agent(workspace), args.task, max_turns=12)
    print(result.final_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
