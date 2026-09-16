let sessionId = localStorage.getItem("challenge3_session_id") || null;
let conversation = JSON.parse(localStorage.getItem("challenge3_conversation") || "[]");

function saveConversation() {
  localStorage.setItem("challenge3_conversation", JSON.stringify(conversation));
}

const MAX_LEN = 4000;
const REQUEST_TIMEOUT_MS = 130000;

const termWindow = document.getElementById("termWindow");
const emptyState = document.getElementById("emptyState");
const chatScroll = document.getElementById("chatScroll");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const modelInput = document.getElementById("model");
const statusText = document.getElementById("statusText");
const statusBox = document.getElementById("statusBox");
const attemptCount = document.getElementById("attemptCount");
const solvedBox = document.getElementById("solvedBox");
const solvedReasonEl = document.getElementById("solvedReason");
const errorBanner = document.getElementById("errorBanner");
const charCount = document.getElementById("charCount");
const connStatus = document.getElementById("connStatus");
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("theme", theme);
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyTheme(isDark ? "light" : "dark");
  });
}

let marked_ready = typeof marked !== "undefined";
let dompurify_ready = typeof DOMPurify !== "undefined";
if (marked_ready) marked.setOptions({ breaks: true });

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
  errorBanner.textContent = "" + message;
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
    connStatus.textContent = "Connected";
    connStatus.classList.add("ok");
  } else if (state === "error") {
    connStatus.textContent = "Connection issue";
    connStatus.classList.add("error");
  } else {
    connStatus.textContent = "";
  }
}

function hideEmptyState() {
  if (emptyState) emptyState.classList.add("hidden");
}

function scrollToBottom() {
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function ensureSessionId() {
  if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    localStorage.setItem("challenge3_session_id", sessionId);
  }
  return sessionId;
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
  scrollToBottom();
  return div;
}

function appendPending() {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line assistant pending";
  div.innerHTML = `<div class="who"></div><div class="body"><span class="dots"><span></span><span></span><span></span></span> processing...</div>`;
  termWindow.appendChild(div);
  scrollToBottom();
  return div;
}

function markSolved(reason) {
  statusText.textContent = "Solved";
  const dot = statusBox.querySelector(".dot");
  if (dot) { dot.classList.remove("pending"); dot.classList.add("solved"); }
  solvedReasonEl.textContent = reason || "the assistant leaked the session username to an external host with no server-side check.";
  solvedBox.classList.remove("hidden");
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

async function sendMessage() {
  clearError();
  const raw = userInput.value.trim();

  if (!raw) {
    showError("Type a message first.");
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
    provider: "ollama",
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
      showError("Network error - could not reach the server. Is the app running?");
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
  if (sessionId) localStorage.setItem("challenge3_session_id", sessionId);

  if (data.reply) conversation.push({ role: "assistant", content: data.reply });
  saveConversation();

  appendLine("assistant", data.reply || "");

  attemptCount.textContent = Number.isFinite(data.attempts) ? data.attempts : "?";
  if (data.solved) markSolved(data.solved_reason);

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
  localStorage.removeItem("challenge3_session_id");
  localStorage.removeItem("challenge3_conversation");
  termWindow.innerHTML = "";
  if (emptyState) {
    termWindow.appendChild(emptyState);
    emptyState.classList.remove("hidden");
  }
  statusText.textContent = "Not solved";
  const dot = statusBox.querySelector(".dot");
  if (dot) { dot.classList.add("pending"); dot.classList.remove("solved"); }
  solvedReasonEl.textContent = "";
  solvedBox.classList.add("hidden");
  attemptCount.textContent = "0";
  updateCharCount();
});

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
userInput.addEventListener("input", () => {
  updateCharCount();
  autoResize();
});

if (!marked_ready) {
  console.warn("marked.js failed to load - markdown will render as plain text.");
}
if (!dompurify_ready) {
  console.warn("DOMPurify failed to load - markdown sanitization is disabled, falling back to plain text.");
}

updateCharCount();
autoResize();
