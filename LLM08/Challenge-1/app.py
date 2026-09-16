#!/usr/bin/env python3
import io
import logging
import math
import os
import re
import threading
import time
import uuid
from collections import Counter

import requests
from flask import Flask, request, jsonify, render_template, session, redirect
from pypdf import PdfReader
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = os.urandom(32)
log = logging.getLogger("llm08-challenge-1")
logging.basicConfig(level=logging.INFO)

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("MODEL", "nemotron-3-ultra:cloud")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")

DATA_DIR = os.getenv("DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))

TENANTS = {
    "tenant-a": {"id": "tenant-a", "name": "Northwind Systems", "label": "Tenant A"},
    "tenant-b": {"id": "tenant-b", "name": "Vertex Retail", "label": "Tenant B"},
}

USERS = {
    "alice": {"password": "TenantA@123", "tenant": "tenant-a", "display": "Alice Munro"},
    "bob": {"password": "TenantB@123", "tenant": "tenant-b", "display": "Bob Ellery"},
}

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "RAGAdmin@123"

MAX_MESSAGE_LENGTH = 4000
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
ALLOWED_EXTENSIONS = {".txt", ".pdf"}
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES + (256 * 1024)

CHUNK_CHARS = 480
CHUNK_OVERLAP = 80
TOP_K = 3

SYSTEM_PROMPT = """You are the tenant knowledge assistant.

Answer the user's question using ONLY the context passages provided below. Do
not use anything you know outside that context, and do not guess. If the
context does not answer the question, say that you do not have that
information.

Be brief. State the answer directly, then stop.
"""

TOKEN_RE = re.compile(r"[a-z0-9]+")

DOCUMENTS: list[dict] = []
STATE_LOCK = threading.Lock()
SESSIONS: dict[str, dict] = {}

INDEX = {
    "chunks": [],
    "vectors": [],
    "backend": "not built",
    "backend_note": "",
    "built_at": None,
    "dirty": True,
    "doc_count": 0,
    "signature": {},
}

TOTALS = {
    "questions": 0,
    "reindexes": 0,
}


class ProviderError(Exception):
    pass


def tokenise(text: str) -> list[str]:
    return TOKEN_RE.findall((text or "").lower())


class TfidfVectoriser:

    def __init__(self, documents: list[str]):
        self.vocab: dict[str, int] = {}
        doc_freq: Counter = Counter()
        for text in documents:
            for token in set(tokenise(text)):
                doc_freq[token] += 1
        for token in sorted(doc_freq):
            self.vocab[token] = len(self.vocab)
        total = max(1, len(documents))
        self.idf = {
            token: math.log((total + 1) / (freq + 1)) + 1.0
            for token, freq in doc_freq.items()
        }

    def vector(self, text: str) -> list[float]:
        counts = Counter(t for t in tokenise(text) if t in self.vocab)
        vec = [0.0] * len(self.vocab)
        for token, count in counts.items():
            vec[self.vocab[token]] = (1.0 + math.log(count)) * self.idf.get(token, 1.0)
        return vec


FALLBACK = {"vectoriser": None}


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / math.sqrt(na * nb)


def ollama_embed(texts: list[str]) -> list[list[float]]:
    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/embed",
            json={"model": EMBED_MODEL, "input": texts},
            timeout=(5, 180),
        )
    except requests.exceptions.ConnectTimeout:
        raise ProviderError(f"Timed out connecting to Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ConnectionError:
        raise ProviderError(f"Could not reach Ollama at {OLLAMA_HOST}. Is `ollama serve` running?")
    except requests.exceptions.ReadTimeout:
        raise ProviderError("Ollama took too long to return embeddings (>180s).")
    except requests.exceptions.RequestException as e:
        raise ProviderError(f"Network error talking to Ollama: {e}")

    if resp.status_code == 404:
        raise ProviderError(f"Embedding model '{EMBED_MODEL}' isn't pulled yet. Run: ollama pull {EMBED_MODEL}")
    if resp.status_code >= 500:
        raise ProviderError(f"Ollama server error (HTTP {resp.status_code}) while embedding.")
    if resp.status_code != 200:
        raise ProviderError(f"Ollama returned HTTP {resp.status_code} while embedding: {resp.text[:200]}")

    try:
        data = resp.json()
    except ValueError:
        raise ProviderError("Ollama returned a non-JSON response while embedding.")

    vectors = data.get("embeddings")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise ProviderError("Ollama's embedding response did not contain one vector per input.")
    return vectors


def extract_text(filename: str, raw: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(raw))
            pages = [(page.extract_text() or "") for page in reader.pages]
        except Exception as e:
            raise ValueError(f"Could not read that PDF: {e}")
        text = "\n".join(pages).strip()
        if not text:
            raise ValueError("That PDF contains no extractable text. Scanned images are not supported.")
        return text
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", "replace")


def make_document(name: str, text: str, tenant: str, origin: str) -> dict:
    return {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "text": text,
        "tenant": tenant,
        "origin": origin,
        "chars": len(text),
        "uploaded_at": time.time(),
    }


def load_seed_documents() -> None:
    for tenant_id in TENANTS:
        folder = os.path.join(DATA_DIR, tenant_id)
        if not os.path.isdir(folder):
            log.warning("seed folder %s is missing", folder)
            continue
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            ext = os.path.splitext(name)[1].lower()
            if not os.path.isfile(path) or ext not in ALLOWED_EXTENSIONS:
                continue
            try:
                text = extract_text(name, open(path, "rb").read())
            except ValueError as e:
                log.warning("skipping seed document %s - %s", name, e)
                continue
            DOCUMENTS.append(make_document(name, text, tenant_id, "seed"))
    log.info("loaded %d seed documents across %d tenants", len(DOCUMENTS), len(TENANTS))


def chunk_text(text: str) -> list[str]:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text or "") if b.strip()]
    chunks = []
    buffer = ""
    for block in blocks:
        if len(buffer) + len(block) + 2 <= CHUNK_CHARS:
            buffer = f"{buffer}\n\n{block}" if buffer else block
            continue
        if buffer:
            chunks.append(buffer)
        while len(block) > CHUNK_CHARS:
            chunks.append(block[:CHUNK_CHARS])
            block = block[CHUNK_CHARS - CHUNK_OVERLAP:]
        buffer = block
    if buffer:
        chunks.append(buffer)
    return chunks or [(text or "").strip()]


def build_index() -> dict:
    with STATE_LOCK:
        docs = list(DOCUMENTS)

    chunks = []
    for doc in docs:
        for position, body in enumerate(chunk_text(doc["text"])):
            chunks.append({
                "doc_id": doc["id"],
                "doc_name": doc["name"],
                "tenant": doc["tenant"],
                "origin": doc["origin"],
                "position": position,
                "text": body,
            })

    if not chunks:
        with STATE_LOCK:
            INDEX.update({
                "chunks": [], "vectors": [], "backend": "empty", "backend_note": "",
                "built_at": time.time(), "dirty": False, "doc_count": 0,
                "signature": {},
            })
            TOTALS["reindexes"] += 1
        return index_state()

    texts = [f"{c['doc_name']}\n{c['text']}" for c in chunks]
    backend = EMBED_MODEL
    note = ""
    try:
        vectors = ollama_embed(texts)
    except ProviderError as e:
        FALLBACK["vectoriser"] = TfidfVectoriser(texts)
        vectors = [FALLBACK["vectoriser"].vector(t) for t in texts]
        backend = "tf-idf (fallback)"
        note = (
            f"{e} Falling back to the in-process TF-IDF vectoriser, so retrieval still "
            f"works and the challenge is unaffected."
        )
        log.warning("embedding backend unavailable - %s", e)
    else:
        FALLBACK["vectoriser"] = None

    with STATE_LOCK:
        INDEX.update({
            "chunks": chunks,
            "vectors": vectors,
            "backend": backend,
            "backend_note": note,
            "built_at": time.time(),
            "dirty": False,
            "doc_count": len(docs),
            "signature": {d["id"]: d["uploaded_at"] for d in docs},
        })
        TOTALS["reindexes"] += 1
    return index_state()


def embed_query(text: str) -> list[float]:
    if FALLBACK["vectoriser"] is not None:
        return FALLBACK["vectoriser"].vector(text)
    try:
        return ollama_embed([text])[0]
    except ProviderError as e:
        log.warning("embedding backend lost mid-session - %s", e)
        texts = [f"{c['doc_name']}\n{c['text']}" for c in INDEX["chunks"]]
        FALLBACK["vectoriser"] = TfidfVectoriser(texts)
        with STATE_LOCK:
            INDEX["vectors"] = [FALLBACK["vectoriser"].vector(t) for t in texts]
            INDEX["backend"] = "tf-idf (fallback)"
            INDEX["backend_note"] = f"{e} Falling back to the in-process TF-IDF vectoriser."
        return FALLBACK["vectoriser"].vector(text)


def retrieve(question: str) -> list[dict]:
    if not INDEX["chunks"]:
        return []
    qvec = embed_query(question)
    scored = []
    for chunk, vector in zip(INDEX["chunks"], INDEX["vectors"]):
        scored.append((cosine(qvec, vector), chunk))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    hits = []
    for score, chunk in scored[:TOP_K]:
        hit = dict(chunk)
        hit["score"] = round(score, 4)
        hits.append(hit)
    return hits


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


def index_drift() -> dict:
    signature = INDEX["signature"]
    live = {d["id"]: d["uploaded_at"] for d in DOCUMENTS}
    added = [i for i in live if i not in signature]
    removed = [i for i in signature if i not in live]
    changed = [i for i in live if i in signature and live[i] != signature[i]]
    return {
        "added": len(added),
        "removed": len(removed),
        "changed": len(changed),
        "total": len(added) + len(removed) + len(changed),
    }


def index_state() -> dict:
    per_tenant = {}
    for tenant_id in TENANTS:
        per_tenant[tenant_id] = sum(1 for c in INDEX["chunks"] if c["tenant"] == tenant_id)
    pending = index_drift()
    return {
        "pending": pending,
        "backend": INDEX["backend"],
        "backend_note": INDEX["backend_note"],
        "built_at": INDEX["built_at"],
        "dirty": pending["total"] > 0,
        "chunks": len(INDEX["chunks"]),
        "chunks_by_tenant": per_tenant,
        "indexed_documents": INDEX["doc_count"],
        "documents": len(DOCUMENTS),
        "reindexes": TOTALS["reindexes"],
    }


def public_state(session_id: str = "") -> dict:
    attempts = 0
    if session_id and session_id in SESSIONS:
        attempts = SESSIONS[session_id]["attempts"]
    return {
        "attempts": attempts,
        "questions": TOTALS["questions"],
        "index": index_state(),
    }


def document_summary(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "tenant": doc["tenant"],
        "tenant_label": TENANTS.get(doc["tenant"], {}).get("label", doc["tenant"]),
        "origin": doc["origin"],
        "chars": doc["chars"],
        "preview": doc["text"][:200].strip(),
    }


def current_user() -> dict | None:
    username = session.get("user")
    if not username or username not in USERS:
        return None
    user = USERS[username]
    tenant = TENANTS[user["tenant"]]
    return {
        "username": username,
        "display": user["display"],
        "tenant": tenant["id"],
        "tenant_name": tenant["name"],
        "tenant_label": tenant["label"],
    }


def is_admin() -> bool:
    return bool(session.get("admin"))


def admin_tenant() -> str:
    tenant = session.get("admin_tenant")
    return tenant if tenant in TENANTS else "tenant-a"


def require_admin():
    if not is_admin():
        return jsonify({"error": "Not signed in as an administrator."}), 401
    return None


@app.route("/")
def index():
    user = current_user()
    if user is None:
        return redirect("/login")
    return render_template(
        "index.html",
        default_model=DEFAULT_MODEL,
        ollama_host=OLLAMA_HOST,
        max_message_length=MAX_MESSAGE_LENGTH,
        user=user,
        admin_username=ADMIN_USERNAME,
        admin_password=ADMIN_PASSWORD,
    )


@app.route("/login")
def login_page():
    if current_user() is not None:
        return redirect("/")
    accounts = [
        {
            "username": name,
            "password": record["password"],
            "tenant_label": TENANTS[record["tenant"]]["label"],
            "tenant_name": TENANTS[record["tenant"]]["name"],
        }
        for name, record in USERS.items()
    ]
    return render_template("login.html", tenants=list(TENANTS.values()), accounts=accounts)


@app.route("/api/login", methods=["POST"])
def api_login():
    body = request.get_json(force=True, silent=True) or {}
    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({"error": "Username and password are required."}), 400
    record = USERS.get(username)
    if record is None or record["password"] != password:
        return jsonify({"error": "Invalid username or password."}), 401
    session["user"] = username
    return jsonify({"ok": True})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user", None)
    return jsonify({"ok": True})


@app.route("/admin")
def admin():
    return render_template(
        "admin.html",
        signed_in=is_admin(),
        admin_tenant=admin_tenant(),
        tenants=list(TENANTS.values()),
        max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
    )


@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    body = request.get_json(force=True, silent=True) or {}
    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({"error": "Username and password are required."}), 400
    if username != ADMIN_USERNAME or password != ADMIN_PASSWORD:
        return jsonify({"error": "Invalid username or password."}), 401
    session["admin"] = True
    session.setdefault("admin_tenant", "tenant-a")
    return jsonify({"ok": True, "tenant": admin_tenant()})


@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin", None)
    session.pop("admin_tenant", None)
    return jsonify({"ok": True})


@app.route("/api/admin/tenant", methods=["POST"])
def switch_tenant():
    denied = require_admin()
    if denied:
        return denied
    body = request.get_json(force=True, silent=True) or {}
    tenant = body.get("tenant")
    if tenant not in TENANTS:
        return jsonify({"error": "Unknown tenant."}), 400
    session["admin_tenant"] = tenant
    return jsonify({"ok": True, "tenant": tenant})


@app.route("/api/admin/documents", methods=["GET"])
def list_documents():
    denied = require_admin()
    if denied:
        return denied
    tenant = admin_tenant()
    return jsonify({
        "tenant": tenant,
        "tenant_label": TENANTS[tenant]["label"],
        "tenant_name": TENANTS[tenant]["name"],
        "documents": [document_summary(d) for d in DOCUMENTS if d["tenant"] == tenant],
        "index": index_state(),
    })


@app.route("/api/admin/documents", methods=["POST"])
def upload_document():
    denied = require_admin()
    if denied:
        return denied

    tenant = admin_tenant()
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "Choose a .txt or .pdf file to upload."}), 400

    name = secure_filename(uploaded.filename)
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only .txt and .pdf documents are accepted."}), 400

    raw = uploaded.read()
    if not raw:
        return jsonify({"error": "That file is empty."}), 400
    if len(raw) > MAX_UPLOAD_BYTES:
        return jsonify({"error": f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)."}), 400

    try:
        text = extract_text(name, raw)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    with STATE_LOCK:
        base, extension = os.path.splitext(name)
        final = name
        suffix = 2
        while any(d["name"] == final and d["tenant"] == tenant for d in DOCUMENTS):
            final = f"{base}-{suffix}{extension}"
            suffix += 1
        doc = make_document(final, text, tenant, "uploaded")
        DOCUMENTS.append(doc)
        INDEX["dirty"] = True

    return jsonify({"ok": True, "document": document_summary(doc), "index": index_state()})


@app.route("/api/admin/documents/<doc_id>", methods=["DELETE"])
def delete_document(doc_id):
    denied = require_admin()
    if denied:
        return denied
    tenant = admin_tenant()
    with STATE_LOCK:
        doc = next((d for d in DOCUMENTS if d["id"] == doc_id and d["tenant"] == tenant), None)
        if doc is None:
            return jsonify({"error": "No document with that id in this tenant."}), 404
        DOCUMENTS.remove(doc)
        INDEX["dirty"] = True
    return jsonify({"ok": True, "index": index_state()})


@app.route("/api/admin/reindex", methods=["POST"])
def reindex():
    denied = require_admin()
    if denied:
        return denied
    try:
        state = build_index()
    except Exception as e:
        log.exception("Failed to rebuild the index")
        return jsonify({"error": f"Could not rebuild the index: {e}"}), 500
    return jsonify({"ok": True, "index": state})


@app.route("/api/chat", methods=["POST"])
def chat():
    user = current_user()
    if user is None:
        return jsonify({"error": "Not signed in. Sign in at /login."}), 401

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
    question = raw_message.strip()
    if not question:
        return jsonify({"error": "Message cannot be empty."}), 400
    if len(question) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)."}), 400

    model = body.get("model") or None
    if model is not None and not isinstance(model, str):
        return jsonify({"error": "'model' must be a string."}), 400
    model = model or DEFAULT_MODEL

    if not INDEX["chunks"]:
        return jsonify({
            "error": "The vector index is empty. An administrator needs to run Update RAG.",
            "session_id": session_id,
            **public_state(session_id),
        }), 503

    with STATE_LOCK:
        if session_id not in SESSIONS:
            SESSIONS[session_id] = {"attempts": 0}
        SESSIONS[session_id]["attempts"] += 1
        TOTALS["questions"] += 1

    try:
        hits = retrieve(question)
    except Exception as e:
        log.exception("Retrieval failed")
        return jsonify({"error": f"Retrieval failed: {e}"}), 500

    context = "\n\n".join(
        f"[Source: {hit['doc_name']}]\n{hit['text']}" for hit in hits
    ) or "(no passages retrieved)"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Context passages:\n\n{context}\n\nQuestion: {question}"},
    ]

    try:
        reply = call_ollama(messages, model)
    except ProviderError as e:
        return jsonify({"error": str(e), "session_id": session_id, **public_state(session_id)}), 502
    except Exception as e:
        log.exception("Unexpected error calling provider")
        return jsonify({"error": f"Unexpected server error: {e}"}), 500

    return jsonify({
        "session_id": session_id,
        "reply": reply.get("content") or "",
        "user": user,
        "sources": [
            {
                "name": hit["doc_name"],
                "score": hit["score"],
                "tenant": hit["tenant"],
                "tenant_label": TENANTS.get(hit["tenant"], {}).get("label", hit["tenant"]),
            }
            for hit in hits
        ],
        **public_state(session_id),
    })


@app.route("/api/state", methods=["POST"])
def state():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id")
    payload = public_state(session_id if isinstance(session_id, str) else "")
    payload["user"] = current_user()
    return jsonify(payload)


@app.route("/api/reset", methods=["POST"])
def reset():
    body = request.get_json(force=True, silent=True) or {}
    session_id = body.get("session_id", "")
    with STATE_LOCK:
        if session_id and isinstance(session_id, str):
            SESSIONS.pop(session_id, None)
        DOCUMENTS.clear()
        TOTALS.update({"questions": 0, "reindexes": 0})
        INDEX.update({
            "chunks": [], "vectors": [], "backend": "not built", "backend_note": "",
            "built_at": None, "dirty": True, "doc_count": 0, "signature": {},
        })
    FALLBACK["vectoriser"] = None
    load_seed_documents()
    try:
        build_index()
    except Exception:
        log.exception("Failed to rebuild the index after reset")
    return jsonify({"ok": True, **public_state()})


@app.errorhandler(401)
def unauthorised(e):
    return jsonify({"error": "Not signed in."}), 401


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)."}), 413


@app.errorhandler(500)
def server_error(e):
    log.exception("Unhandled server error")
    return jsonify({"error": "Internal server error."}), 500


load_seed_documents()
try:
    build_index()
except Exception:
    log.exception("Initial index build failed")


if __name__ == "__main__":
    log.info(
        "Shared index: %d documents, %d chunks across %d tenants, embeddings via %s.",
        len(DOCUMENTS), len(INDEX["chunks"]), len(TENANTS), INDEX["backend"],
    )
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
