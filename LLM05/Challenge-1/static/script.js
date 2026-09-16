let sessionId = localStorage.getItem("llm05c1_session_id") || null;
let conversation = JSON.parse(localStorage.getItem("llm05c1_conversation") || "[]");

function saveConversation() {
  localStorage.setItem("llm05c1_conversation", JSON.stringify(conversation));
}

const MAX_LEN = 2000;
const REQUEST_TIMEOUT_MS = 130000;

const termWindow = document.getElementById("termWindow");
const emptyState = document.getElementById("emptyState");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const modelInput = document.getElementById("model");
const statusText = document.getElementById("statusText");
const statusBox = document.getElementById("statusBox");
const attemptCount = document.getElementById("attemptCount");
const totalRows = document.getElementById("totalRows");
const tableSummary = document.getElementById("tableSummary");
const reasonBox = document.getElementById("reasonBox");
const reasonText = document.getElementById("reasonText");
const errorBanner = document.getElementById("errorBanner");
const charCount = document.getElementById("charCount");
const connStatus = document.getElementById("connStatus");
const themeToggle = document.getElementById("themeToggle");

let marked_ready = typeof marked !== "undefined";
let dompurify_ready = typeof DOMPurify !== "undefined";
if (marked_ready) marked.setOptions({ breaks: true });

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
  });
}

function renderMarkdown(text) {
  if (!marked_ready) return escapeHtml(text || "");
  try {
    const html = marked.parse(text || "");
    return dompurify_ready ? DOMPurify.sanitize(html) : html;
  } catch (e) {
    console.error("Markdown render failed, falling back to plain text:", e);
    return escapeHtml(text || "");
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function showError(message) {
  errorBanner.textContent = "⚠ " + message;
  errorBanner.classList.remove("hidden");
  setStatus("error");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function setStatus(state) {
  connStatus.classList.remove("ok", "error");
  if (state === "ok") {
    connStatus.textContent = "● connected";
    connStatus.classList.add("ok");
  } else if (state === "error") {
    connStatus.textContent = "● connection issue";
    connStatus.classList.add("error");
  } else {
    connStatus.textContent = "";
  }
}

function ensureSessionId() {
  if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    localStorage.setItem("llm05c1_session_id", sessionId);
  }
  return sessionId;
}

function hideEmptyState() {
  if (emptyState) emptyState.classList.add("hidden");
}

function appendLine(role, text) {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line " + role;
  const who = document.createElement("div");
  who.className = "who";
  const body = document.createElement("div");
  body.className = "body";
  if (role === "assistant") {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }
  div.appendChild(who);
  div.appendChild(body);
  termWindow.appendChild(div);
  termWindow.scrollTop = termWindow.scrollHeight;
  return div;
}

function appendPending() {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line assistant pending";
  div.innerHTML = `<div class="who"></div><div class="body"><span class="dots"><span></span><span></span><span></span></span> thinking...</div>`;
  termWindow.appendChild(div);
  termWindow.scrollTop = termWindow.scrollHeight;
  return div;
}

function markSolved(reason) {
  statusText.textContent = "Solved";
  const dot = statusBox.querySelector(".dot");
  if (dot) { dot.classList.remove("pending"); dot.classList.add("solved"); }
  if (reason) reasonText.textContent = reason;
  reasonBox.classList.remove("hidden");
}

function updateCharCount() {
  const len = userInput.value.length;
  charCount.textContent = `${len} / ${MAX_LEN}`;
  charCount.classList.toggle("over-limit", len > MAX_LEN);
}

function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function renderTableSummary(tables, total) {
  totalRows.textContent = total;
  if (!tables.length) {
    tableSummary.innerHTML = `<div class="field-hint">no tables found</div>`;
    return;
  }
  const rows = tables.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${t.exists ? t.rows : "dropped"}</td></tr>`).join("");
  tableSummary.innerHTML = `<table class="mini-table"><thead><tr><th>table</th><th>rows</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function refreshTables() {
  if (!sessionId) return;
  try {
    const res = await fetchWithTimeout(`/api/tables?session_id=${encodeURIComponent(sessionId)}`, {}, 10000);
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.tables)) renderTableSummary(data.tables, data.total_rows);
  } catch (e) {
  }
}

async function refreshStatus() {
  if (!sessionId) return;
  try {
    const res = await fetchWithTimeout(`/api/status?session_id=${encodeURIComponent(sessionId)}`, {}, 10000);
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data === "object") {
      if (Number.isFinite(data.attempts)) attemptCount.textContent = data.attempts;
      if (data.solved) markSolved(data.solved_reason);
    }
  } catch (e) {
  }
}

function rehydrateConversation() {
  if (!Array.isArray(conversation) || !conversation.length) return;
  conversation.forEach(m => {
    if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
      appendLine(m.role, m.content);
    }
  });
}

async function sendMessage() {
  clearError();
  const raw = userInput.value.trim();

  if (!raw) {
    showError("Type a request first.");
    return;
  }
  if (raw.length > MAX_LEN) {
    showError(`Message is too long (${raw.length}/${MAX_LEN} characters).`);
    return;
  }

  conversation.push({ role: "user", content: raw });
  const outgoingMessages = conversation;
  appendLine("user", raw);

  const payload = {
    session_id: ensureSessionId(),
    model: modelInput.value.trim() || null,
    messages: outgoingMessages,
  };

  userInput.value = "";
  updateCharCount();
  autoResize();
  sendBtn.disabled = true;
  userInput.disabled = true;
  const pendingEl = appendPending();

  let res;
  try {
    res = await fetchWithTimeout("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    pendingEl.remove();
    sendBtn.disabled = false;
    userInput.disabled = false;
    if (err.name === "AbortError") {
      showError("Request timed out. The model may be slow, unreachable, or Ollama isn't running.");
    } else {
      showError("Network error - could not reach the server. Is app.py running?");
    }
    conversation.pop();
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    pendingEl.remove();
    sendBtn.disabled = false;
    userInput.disabled = false;
    showError(`Server returned an unreadable response (HTTP ${res.status}).`);
    conversation.pop();
    return;
  }

  pendingEl.remove();
  sendBtn.disabled = false;
  userInput.disabled = false;

  if (!res.ok) {
    showError(data && data.error ? data.error : `Request failed (HTTP ${res.status}).`);
    conversation.pop();
    return;
  }
  if (!data || typeof data !== "object") {
    showError("Server response was malformed.");
    conversation.pop();
    return;
  }

  setStatus("ok");
  sessionId = data.session_id || sessionId;
  if (sessionId) localStorage.setItem("llm05c1_session_id", sessionId);

  if (data.reply) conversation.push({ role: "assistant", content: data.reply });
  saveConversation();

  appendLine("assistant", data.reply || "");

  attemptCount.textContent = Number.isFinite(data.attempts) ? data.attempts : "?";
  if (data.solved) markSolved(data.solved_reason);

  refreshTables();
  userInput.focus();
}

resetBtn.addEventListener("click", async () => {
  clearError();
  resetBtn.disabled = true;
  try {
    if (sessionId) {
      const res = await fetchWithTimeout("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }, 10000);
      if (!res.ok) {
        showError("Reset request failed on the server, but local state has been cleared anyway.");
      }
    }
  } catch (err) {
    showError("Could not reach the server to reset - local state has been cleared anyway.");
  } finally {
    resetBtn.disabled = false;
  }

  sessionId = null;
  conversation = [];
  localStorage.removeItem("llm05c1_session_id");
  localStorage.removeItem("llm05c1_conversation");
  termWindow.innerHTML = "";
  if (emptyState) {
    termWindow.appendChild(emptyState);
    emptyState.classList.remove("hidden");
  }
  statusText.textContent = "Not solved";
  const dot = statusBox.querySelector(".dot");
  if (dot) { dot.classList.add("pending"); dot.classList.remove("solved"); }
  reasonBox.classList.add("hidden");
  attemptCount.textContent = "0";
  totalRows.textContent = "15";
  tableSummary.innerHTML = "";
  updateCharCount();
});

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
userInput.addEventListener("input", () => { updateCharCount(); autoResize(); });

if (!marked_ready) {
  console.warn("marked.js failed to load - markdown will render as plain text.");
}
if (!dompurify_ready) {
  console.warn("DOMPurify failed to load - markdown sanitization is disabled, falling back to plain text.");
}

updateCharCount();
autoResize();
rehydrateConversation();
if (sessionId) {
  refreshStatus();
  refreshTables();
}
