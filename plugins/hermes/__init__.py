"""Hermes Agent plugin for AgentBuzzer notifications."""

import json
from pathlib import Path
import subprocess


ENTRY = Path(__file__).resolve().parent / "bin" / "agent-buzzer.mjs"


def _send(status, summary, session_id=None, turn_id=None):
    payload = {
        "status": status,
        "summary": summary or "",
        "session_id": session_id,
        "turn_id": turn_id,
    }
    try:
        subprocess.run(
            ["node", str(ENTRY), "hermes-event"],
            input=json.dumps(payload),
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def _finished(session_id, assistant_response, **kwargs):
    _send("completed", assistant_response, session_id, kwargs.get("turn_id"))


def _ended(session_id, completed, interrupted, **kwargs):
    if not completed:
        summary = "本轮已中断" if interrupted else "本轮未完成"
        _send("failed", summary, session_id, kwargs.get("turn_id"))


def _approval(session_key, description, **kwargs):
    _send("needs_input", description or "有操作需要你批准", session_key, kwargs.get("turn_id"))


def register(ctx):
    ctx.register_hook("post_llm_call", _finished)
    ctx.register_hook("on_session_end", _ended)
    ctx.register_hook("pre_approval_request", _approval)
