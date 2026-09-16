#!/usr/bin/env python3
import logging
import os
import threading
import time
import uuid
from collections import deque

import requests
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)
log = logging.getLogger("llm10-challenge-1")
logging.basicConfig(level=logging.INFO)

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("MODEL", "qwen2.5:latest")

MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY = 40

RATE_WINDOW_SECONDS = 60
BUDGET_WINDOW_REQUESTS = 30

BACKSTOP_CONCURRENCY = 24
BACKSTOP_NUM_PREDICT = 512
BACKSTOP_TIMEOUT = 120

SYSTEM_PROMPT = """You are Nimbus Assistant, the free chat assistant on Nimbus Software's
public website.

Answer questions from your own knowledge, in a friendly and helpful tone. You have
no tools, no access to any customer account and no way to look anything up, so if a
question needs live or private data, say so plainly.

Keep answers reasonably short unless the user asks for detail.
"""

SESSIONS: dict[str, dict] = {}

TOTALS = {
    "requests": 0,
    "prompt_tokens": 0,
    "output_tokens": 0,
    "tokens_billed": 0,
    "in_flight": 0,
    "peak_concurrent": 0,
    "peak_window_requests": 0,
    "refused_by_rate_limit": 0,
    "refused_by_backstop": 0,
    "solved": False,
    "solved_reason": "",
}

REQUEST_TIMES: deque = deque()
STATE_LOCK = threading.Lock()


class ProviderError(Exception):
    pass


def get_session(session_id: str) -> dict:
    with STATE_LOCK:
        if session_id not in SESSIONS:
            SESSIONS[session_id] = {
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}],
                "attempts": 0,
            }
        return SESSIONS[session_id]


def record_request() -> int:
    now = time.time()
    with STATE_LOCK:
        REQUEST_TIMES.append(now)
        in_window = prune_window()
        TOTALS["requests"] += 1
        TOTALS["peak_window_requests"] = max(TOTALS["peak_window_requests"], in_window)
        check_budget(in_window)
        return in_window


def prune_window() -> int:
    cutoff = time.time() - RATE_WINDOW_SECONDS
    while REQUEST_TIMES and REQUEST_TIMES[0] < cutoff:
        REQUEST_TIMES.popleft()
    return len(REQUEST_TIMES)


def check_budget(in_window: int) -> None:
    if TOTALS["solved"] or in_window <= BUDGET_WINDOW_REQUESTS:
        return
    TOTALS["solved"] = True
    TOTALS["solved_reason"] = (
        f"the service answered {in_window} requests inside a {RATE_WINDOW_SECONDS}-second "
        f"window against a budget of {BUDGET_WINDOW_REQUESTS}, and refused none of them. "
        f"There is no per-session limit, no per-IP limit, no global limit, no daily quota "
        f"and no token budget anywhere in the request path, so nothing was ever going to "
        f"say no."
    )


def bill(usage: dict) -> None:
    with STATE_LOCK:
        TOTALS["prompt_tokens"] += usage["prompt_tokens"]
        TOTALS["output_tokens"] += usage["output_tokens"]
        TOTALS["tokens_billed"] += usage["prompt_tokens"] + usage["output_tokens"]


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4)


def call_ollama(messages, model):
    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": BACKSTOP_NUM_PREDICT},
            },
            timeout=BACKSTOP_TIMEOUT,
        )
    except requests.exceptions.ConnectTimeout:
        raise ProviderError(f"Timed out connecting to Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ConnectionError:
        raise ProviderError(f"Could not reach Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ReadTimeout:
        raise ProviderError(f"Ollama took too long to respond (>{BACKSTOP_TIMEOUT}s). Try a smaller/faster model.")
    except requests.exceptions.RequestException as e:
        raise ProviderError(f"Network error talking to Ollama: {e}")

    if resp.status_code == 404:
        raise ProviderError(f"Model '{model}' isn't pulled yet. Run: ollama pull {model}")
    if resp.status_code >= 500:
        raise ProviderError(f"Ollama server error (HTTP {resp.status_code}). Check `ollama serve` logs.")
    if resp.status_code != 200:
        raise ProviderError(f"Ollama returned unexpected status {resp.status_code}: {resp.text[:300]}")

    try:
        data = resp.json()
    except ValueError:
        raise ProviderError("Ollama returned a response that wasn't valid JSON.")

    message = data.get("message")
    if not isinstance(message, dict):
        raise ProviderError("Ollama's response was missing the expected 'message' field.")

    prompt_tokens = data.get("prompt_eval_count")
    output_tokens = data.get("eval_count")
    measured = (
        isinstance(prompt_tokens, int) and not isinstance(prompt_tokens, bool)
        and isinstance(output_tokens, int) and not isinstance(output_tokens, bool)
    )
    if not measured:
        prompt_tokens = sum(estimate_tokens(m.get("content", "")) for m in messages)
        output_tokens = estimate_tokens(message.get("content") or "")

    return message, {
        "prompt_tokens": int(prompt_tokens),
        "output_tokens": int(output_tokens),
        "measured": measured,
    }


def meter_state() -> dict:
    with STATE_LOCK:
        return {
            "requests_in_window": prune_window(),
            "window_seconds": RATE_WINDOW_SECONDS,
            "budget_requests": BUDGET_WINDOW_REQUESTS,
            "peak_window_requests": TOTALS["peak_window_requests"],
            "total_requests": TOTALS["requests"],
            "tokens_billed": TOTALS["tokens_billed"],
            "prompt_tokens": TOTALS["prompt_tokens"],
            "output_tokens": TOTALS["output_tokens"],
            "in_flight": TOTALS["in_flight"],
            "peak_concurrent": TOTALS["peak_concurrent"],
            "refused_by_rate_limit": TOTALS["refused_by_rate_limit"],
            "refused_by_backstop": TOTALS["refused_by_backstop"],
            "backstop_concurrency": BACKSTOP_CONCURRENCY,
            "solved": TOTALS["solved"],
            "solved_reason": TOTALS["solved_reason"],
        }


@app.route("/")
def index():
    return render_template(
        "index.html",
        default_model=DEFAULT_MODEL,
        ollama_host=OLLAMA_HOST,
        max_message_length=MAX_MESSAGE_LENGTH,
        window_seconds=RATE_WINDOW_SECONDS,
        budget_requests=BUDGET_WINDOW_REQUESTS,
    )


@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(force=True, silent=True)
    if body is None:
        return jsonify({"error": "Request body must be valid JSON."}), 400
    if not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    session_id = body.get("session_id") or str(uuid.uuid4())
    if not isinstance(session_id, str):
        return jsonify({"error": "session_id must be a string."}), 400

    raw_message = body.get("message")
    if raw_message is None:
        return jsonify({"error": "'message' field is required."}), 400
    if not isinstance(raw_message, str):
        return jsonify({"error": "'message' must be a string."}), 400
    user_message = raw_message.strip()
    if not user_message:
        return jsonify({"error": "Message cannot be empty."}), 400
    if len(user_message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)."}), 400

    model = body.get("model") or None
    if model is not None and not isinstance(model, str):
        return jsonify({"error": "'model' must be a string."}), 400
    model = model or DEFAULT_MODEL

    try:
        session = get_session(session_id)
    except Exception:
        log.exception("Failed to load/create session")
        return jsonify({"error": "Could not load session state."}), 500

    with STATE_LOCK:
        if TOTALS["in_flight"] >= BACKSTOP_CONCURRENCY:
            TOTALS["refused_by_backstop"] += 1
            over_backstop = True
        else:
            over_backstop = False
            TOTALS["in_flight"] += 1
            TOTALS["peak_concurrent"] = max(TOTALS["peak_concurrent"], TOTALS["in_flight"])

    if over_backstop:
        return jsonify({
            "error": (
                f"Lab backstop: {BACKSTOP_CONCURRENCY} generations are already in flight. "
                f"This is a guardrail on the lab so a burst cannot pin the process. It is "
                f"not a control the application has - there is no rate limit in the "
                f"request path."
            ),
            "session_id": session_id,
            **meter_state(),
        }), 503

    record_request()

    with STATE_LOCK:
        session["attempts"] += 1
        session["messages"].append({"role": "user", "content": user_message})
        if len(session["messages"]) > MAX_HISTORY:
            session["messages"] = [session["messages"][0]] + session["messages"][-(MAX_HISTORY - 1):]
        messages = list(session["messages"])

    try:
        reply, usage = call_ollama(messages, model)
    except ProviderError as e:
        return jsonify({"error": str(e), "session_id": session_id, **meter_state()}), 502
    except Exception as e:
        log.exception("Unexpected error calling provider")
        return jsonify({"error": f"Unexpected server error: {e}"}), 500
    finally:
        with STATE_LOCK:
            TOTALS["in_flight"] = max(0, TOTALS["in_flight"] - 1)

    bill(usage)

    reply_text = reply.get("content") or ""

    with STATE_LOCK:
        if reply_text:
            session["messages"].append({"role": "assistant", "content": reply_text})
        if len(session["messages"]) > MAX_HISTORY:
            session["messages"] = [session["messages"][0]] + session["messages"][-(MAX_HISTORY - 1):]
        attempts = session["attempts"]

    return jsonify({
        "session_id": session_id,
        "reply": reply_text,
        "attempts": attempts,
        "usage": {
            "prompt_tokens": usage["prompt_tokens"],
            "output_tokens": usage["output_tokens"],
            "measured": usage["measured"],
        },
        **meter_state(),
    })


@app.route("/api/state", methods=["POST"])
def state():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id")
    attempts = 0
    if isinstance(session_id, str) and session_id in SESSIONS:
        attempts = SESSIONS[session_id]["attempts"]
    return jsonify({"attempts": attempts, **meter_state()})


@app.route("/api/reset", methods=["POST"])
def reset():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id", "")
    with STATE_LOCK:
        if session_id and isinstance(session_id, str):
            SESSIONS.pop(session_id, None)
        REQUEST_TIMES.clear()
        in_flight = TOTALS["in_flight"]
        TOTALS.update({
            "requests": 0,
            "prompt_tokens": 0,
            "output_tokens": 0,
            "tokens_billed": 0,
            "in_flight": in_flight,
            "peak_concurrent": in_flight,
            "peak_window_requests": 0,
            "refused_by_rate_limit": 0,
            "refused_by_backstop": 0,
            "solved": False,
            "solved_reason": "",
        })
    return jsonify({"ok": True})


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(500)
def server_error(e):
    log.exception("Unhandled server error")
    return jsonify({"error": "Internal server error."}), 500


if __name__ == "__main__":
    log.info(
        "No rate limit, no quota, no auth. Solve budget: more than %d requests in %ds. "
        "Lab backstop: %d concurrent, num_predict %d.",
        BUDGET_WINDOW_REQUESTS, RATE_WINDOW_SECONDS, BACKSTOP_CONCURRENCY, BACKSTOP_NUM_PREDICT,
    )
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
