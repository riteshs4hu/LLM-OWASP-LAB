#!/usr/bin/env python3
import logging
import os
import time
import uuid

import requests
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)
log = logging.getLogger("llm10-challenge-2")
logging.basicConfig(level=logging.INFO)


HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("MODEL", "qwen2.5:latest")

MAX_MESSAGE_LENGTH = 2000
MAX_HISTORY = 20

HISTORY_REPLY_CHARS = 2000

BUDGET_TOTAL_CHARS = 2000000

SYSTEM_PROMPT = """You are DocuChat, a document question-answering assistant.

The user's uploaded document is included at the start of their message, between
the markers BEGIN DOCUMENT and END DOCUMENT. Answer their question using that
document. If the document does not contain the answer, say so plainly rather
than guessing. Keep answers short and specific.
"""

SESSIONS: dict[str, dict] = {}


class ProviderError(Exception):
    pass


def human_bytes(n: int) -> str:
    size = float(max(0, int(n)))
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024.0 or unit == "GB":
            if unit == "B":
                return f"{int(size)} B"
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} GB"


def blank_session() -> dict:
    return {
        "messages": [],
        "doc_name": "",
        "doc_text": "",
        "doc_bytes": 0,
        "questions": 0,
        "total_chars": 0,
        "last_turn_chars": 0,
        "last_elapsed": 0.0,
        "resends": 0,
        "solved": False,
        "solved_reason": "",
    }


def get_session(session_id: str) -> dict:
    session = SESSIONS.get(session_id)
    if session is None:
        session = blank_session()
        SESSIONS[session_id] = session
    return session


def call_ollama(messages, model):
    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={"model": model, "messages": messages, "stream": False},
            timeout=120,
        )
    except requests.exceptions.ConnectTimeout:
        raise ProviderError(f"Timed out connecting to Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ConnectionError:
        raise ProviderError(f"Could not reach Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ReadTimeout:
        raise ProviderError("Ollama took too long to respond (>120s). Try a smaller/faster model.")
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

    return message


def build_prompt(session: dict, question: str) -> list:
    doc = session["doc_text"]
    if doc:
        content = (
            "BEGIN DOCUMENT\n"
            f"{doc}\n"
            "END DOCUMENT\n\n"
            f"Question: {question}"
        )
    else:
        content = question

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(session["messages"])
    messages.append({"role": "user", "content": content})
    return messages


def prompt_chars(messages: list) -> int:
    total = 0
    for m in messages:
        content = m.get("content") if isinstance(m, dict) else None
        if isinstance(content, str):
            total += len(content)
    return total


def check_budget(session: dict) -> None:
    if session["solved"] or session["total_chars"] <= BUDGET_TOTAL_CHARS:
        return
    session["solved"] = True
    doc_desc = (
        f"a {human_bytes(session['doc_bytes'])} document "
        f"(\"{session['doc_name']}\", about {len(session['doc_text']) // 4:,} tokens)"
        if session["doc_bytes"]
        else "the conversation alone"
    )
    session["solved_reason"] = (
        f"{session['total_chars']:,} characters have now been sent to the model in one "
        f"session, past the {BUDGET_TOTAL_CHARS:,}-character. {doc_desc} was "
        f"re-sent in full {session['resends']} time(s) across {session['questions']} "
    )


def meter_state(session: dict) -> dict:
    doc_chars = len(session["doc_text"])
    doc_tokens = doc_chars // 4
    wasted = doc_tokens * max(0, session["questions"] - 1)
    return {
        "doc_name": session["doc_name"],
        "doc_bytes": session["doc_bytes"],
        "doc_bytes_human": human_bytes(session["doc_bytes"]) if session["doc_bytes"] else "none",
        "doc_chars": doc_chars,
        "doc_tokens": doc_tokens,
        "questions": session["questions"],
        "resends": session["resends"],
        "turn_chars": session["last_turn_chars"],
        "total_chars": session["total_chars"],
        "total_tokens": session["total_chars"] // 4,
        "wasted_tokens": wasted,
        "elapsed": round(session["last_elapsed"], 2),
        "budget_total_chars": BUDGET_TOTAL_CHARS,
        "solved": session["solved"],
        "solved_reason": session["solved_reason"],
    }


@app.route("/")
def index():
    return render_template(
        "index.html",
        default_model=DEFAULT_MODEL,
        ollama_host=OLLAMA_HOST,
        budget_total_chars=BUDGET_TOTAL_CHARS,
    )


@app.route("/api/upload", methods=["POST"])
def upload():
    session_id = request.form.get("session_id") or str(uuid.uuid4())
    if not isinstance(session_id, str):
        return jsonify({"error": "session_id must be a string."}), 400

    upload_file = request.files.get("file")
    if upload_file is None:
        return jsonify({"error": "No file was uploaded. Choose a text file first."}), 400
    if not upload_file.filename:
        return jsonify({"error": "The uploaded file has no name."}), 400

    try:
        raw = upload_file.read()
    except OSError as e:
        return jsonify({"error": f"Could not read the uploaded file: {e}"}), 400
    except MemoryError:
        return jsonify({"error": "The server ran out of memory reading that upload."}), 500

    if not raw:
        return jsonify({"error": "The uploaded file is empty."}), 400

    text = raw.decode("utf-8", errors="replace")

    session = get_session(session_id)
    session["doc_name"] = os.path.basename(upload_file.filename)[:200]
    session["doc_text"] = text
    session["doc_bytes"] = len(raw)

    log.info(
        "session %s uploaded %s (%s, %d characters) - it will be re-sent on every turn",
        session_id[:8], session["doc_name"], human_bytes(len(raw)), len(text),
    )

    payload = {"session_id": session_id, "ok": True}
    payload.update(meter_state(session))
    return jsonify(payload)


@app.route("/api/document", methods=["POST"])
def clear_document():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id")
    if not isinstance(session_id, str) or session_id not in SESSIONS:
        return jsonify({"error": "No document is loaded for this session."}), 404

    session = SESSIONS[session_id]
    session["doc_name"] = ""
    session["doc_text"] = ""
    session["doc_bytes"] = 0

    payload = {"session_id": session_id, "ok": True}
    payload.update(meter_state(session))
    return jsonify(payload)


@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(force=True, silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    session_id = body.get("session_id") or str(uuid.uuid4())
    if not isinstance(session_id, str):
        return jsonify({"error": "session_id must be a string."}), 400

    raw_message = body.get("message")
    if not isinstance(raw_message, str):
        return jsonify({"error": "'message' is required and must be a string."}), 400
    question = raw_message.strip()
    if not question:
        return jsonify({"error": "Message cannot be empty."}), 400
    if len(question) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)."}), 400

    model = body.get("model") or None
    if model is not None and not isinstance(model, str):
        return jsonify({"error": "'model' must be a string."}), 400
    model = model or DEFAULT_MODEL

    session = get_session(session_id)

    messages = build_prompt(session, question)
    sent_chars = prompt_chars(messages)

    session["questions"] += 1
    session["last_turn_chars"] = sent_chars
    session["total_chars"] += sent_chars
    if session["doc_text"]:
        session["resends"] += 1
    check_budget(session)

    started = time.time()
    failed = False
    failure_reason = ""
    reply_text = ""

    try:
        reply = call_ollama(messages, model)
        reply_text = (reply.get("content") or "").strip()
    except ProviderError as e:
        failed = True
        failure_reason = str(e)
    except MemoryError:
        failed = True
        failure_reason = "The server ran out of memory building the request for that document."
    except Exception as e:
        log.exception("Unexpected error during the chat turn")
        return jsonify({"error": f"Unexpected server error: {e}"}), 500

    session["last_elapsed"] = time.time() - started

    if not failed:
        session["messages"].append({"role": "user", "content": question})
        session["messages"].append({
            "role": "assistant",
            "content": reply_text[:HISTORY_REPLY_CHARS],
        })
        if len(session["messages"]) > MAX_HISTORY:
            session["messages"] = session["messages"][-MAX_HISTORY:]

    payload = {
        "session_id": session_id,
        "reply": reply_text,
        "failed": failed,
        "failure_reason": failure_reason,
    }
    payload.update(meter_state(session))
    return jsonify(payload)


@app.route("/api/state", methods=["POST"])
def state():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id")
    if not isinstance(session_id, str) or session_id not in SESSIONS:
        return jsonify(meter_state(blank_session()))
    return jsonify(meter_state(SESSIONS[session_id]))


@app.route("/api/reset", methods=["POST"])
def reset():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id", "")
    if session_id and isinstance(session_id, str):
        SESSIONS.pop(session_id, None)
    return jsonify({"ok": True})


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({"error": "Upload rejected as too large by the server or a proxy in front of it."}), 413


@app.errorhandler(500)
def server_error(e):
    log.exception("Unhandled server error")
    return jsonify({"error": "Internal server error."}), 500


if __name__ == "__main__":
    log.info(
        "Upload size limit: none (MAX_CONTENT_LENGTH is unset). Solve budget: %d characters.",
        BUDGET_TOTAL_CHARS,
    )
    app.run(host=HOST, port=PORT, debug=False)
