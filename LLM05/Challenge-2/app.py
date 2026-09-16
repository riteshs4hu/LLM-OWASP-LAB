#!/usr/bin/env python3
import logging
import os
import uuid

import requests
from flask import Flask, request, jsonify, render_template, make_response

app = Flask(__name__)
log = logging.getLogger("llm05-challenge-2")
logging.basicConfig(level=logging.INFO)

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("MODEL", "nemotron-3-ultra:cloud")

MAX_MESSAGE_LENGTH = 2000
MAX_MESSAGES = 40
MAX_CONTENT_LENGTH = 8000

SYSTEM_PROMPT = """You are an AI-powered support assistant embedded in a company's live chat widget. Users will ask you questions or make requests, and you reply directly in the chat."""


class ProviderError(Exception):
    pass


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


@app.route("/")
def index():
    resp = make_response(render_template("index.html", default_model=DEFAULT_MODEL, ollama_host=OLLAMA_HOST))

    if not request.cookies.get("demo_session_token"):
        resp.set_cookie("demo_session_token", f"DEMO-{uuid.uuid4().hex[:12]}", httponly=False)
    return resp


@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(force=True, silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    client_messages = body.get("messages")
    if client_messages is None:
        return jsonify({"error": "'messages' is required: a full array of {role, content} objects."}), 400
    if not isinstance(client_messages, list) or not client_messages:
        return jsonify({"error": "'messages' must be a non-empty array."}), 400
    if len(client_messages) > MAX_MESSAGES:
        return jsonify({"error": f"'messages' exceeds the max of {MAX_MESSAGES} entries."}), 400

    validated = []
    for m in client_messages:
        if not isinstance(m, dict) or "role" not in m or "content" not in m:
            return jsonify({"error": "Each entry in 'messages' needs a 'role' and 'content'."}), 400
        role = m.get("role")
        content = m.get("content")
        if role not in ("system", "user", "assistant"):
            return jsonify({"error": f"Unsupported role '{role}' in 'messages'."}), 400
        if not isinstance(content, str):
            return jsonify({"error": "'content' must be a string."}), 400
        if len(content) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"A message exceeds the max length ({MAX_MESSAGE_LENGTH})."}), 400
        validated.append({"role": role, "content": content})

    model = body.get("model") or None
    if model is not None and not isinstance(model, str):
        return jsonify({"error": "'model' must be a string."}), 400
    model = model or DEFAULT_MODEL

    outgoing_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + validated

    try:
        reply = call_ollama(outgoing_messages, model)
    except ProviderError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        log.exception("Unexpected error calling provider")
        return jsonify({"error": f"Unexpected server error: {e}"}), 500

    try:
        raw_content = (reply.get("content", "") or "").strip()
        if not raw_content:
            raw_content = "(the model did not return any content)"
        elif len(raw_content) > MAX_CONTENT_LENGTH:
            raw_content = raw_content[:MAX_CONTENT_LENGTH]

        return jsonify({"reply": raw_content})
    except Exception as e:
        log.exception("Unexpected error processing the reply")
        return jsonify({"error": f"Unexpected server error while processing the response: {e}"}), 500


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
    app.run(host=HOST, port=PORT, debug=False)
