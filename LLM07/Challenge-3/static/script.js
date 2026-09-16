const MAX_LEN = Number(document.body.dataset.maxLen || 2000);
const STORAGE_KEY = document.body.dataset.storageKey || "challenge";
const REQUEST_TIMEOUT_MS = Number(document.body.dataset.timeoutMs || 130000);

let sessionId = localStorage.getItem(STORAGE_KEY + "_session_id") || null;

const termWindow = document.getElementById("termWindow");
const emptyState = document.getElementById("emptyState");
const chatScroll = document.getElementById("chatScroll");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const modelInput = document.getElementById("model");
const errorBanner = document.getElementById("errorBanner");
const charCount = document.getElementById("charCount");
const connStatus = document.getElementById("connStatus");
const themeToggle = document.getElementById("themeToggle");

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const attemptCount = document.getElementById("attemptCount");
const solvedBox = document.getElementById("solvedBox");
const solvedReasonEl = document.getElementById("solvedReason");
const flagBox = document.getElementById("flagBox");
const flagText = document.getElementById("flagText");

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

const marked_ready = typeof marked !== "undefined";
const dompurify_ready = typeof DOMPurify !== "undefined";
if (marked_ready) marked.setOptions({ breaks: true });

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function renderMarkdown(text) {
  if (!marked_ready) return escapeHtml(text || "");
  try {
    const html = marked.parse(text || "");
    return dompurify_ready ? DOMPurify.sanitize(html) : escapeHtml(text || "");
  } catch (e) {
    console.error("Markdown render failed, falling back to plain text:", e);
    return escapeHtml(text || "");
  }
}

function showError(message) {
  if (!errorBanner) return;
  errorBanner.textContent = "" + message;
  errorBanner.classList.remove("hidden");
  setStatus("error");
}

function clearError() {
  if (!errorBanner) return;
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function setStatus(state) {
  if (!connStatus) return;
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
  if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
}

function appendLine(role, text) {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line " + role;

  const who = document.createElement("div");
  who.className = "who";

  const col = document.createElement("div");
  col.className = "line-col";

  const body = document.createElement("div");
  body.className = "body";
  if (role === "assistant") {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }

  col.appendChild(body);
  div.appendChild(who);
  div.appendChild(col);
  termWindow.appendChild(div);
  scrollToBottom();

  div.col = col;
  div.bodyEl = body;
  return div;
}

function appendPending(label) {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line assistant pending";
  div.innerHTML =
    '<div class="who"></div><div class="line-col"><div class="body">' +
    '<span class="dots"><span></span><span></span><span></span></span> ' +
    escapeHtml(label || "thinking...") +
    "</div></div>";
  termWindow.appendChild(div);
  scrollToBottom();
  return div;
}

function markSolved(reason) {
  if (statusText) statusText.textContent = "Solved";
  if (statusBox) {
    const dot = statusBox.querySelector(".dot");
    if (dot) { dot.classList.remove("pending"); dot.classList.add("solved"); }
  }
  if (solvedBox) {
    if (solvedReasonEl) solvedReasonEl.textContent = reason || "the vulnerable code path executed.";
    solvedBox.classList.remove("hidden");
  }
}

function markUnsolved() {
  if (statusText) statusText.textContent = "Not solved";
  if (statusBox) {
    const dot = statusBox.querySelector(".dot");
    if (dot) { dot.classList.add("pending"); dot.classList.remove("solved"); }
  }
  if (solvedBox) solvedBox.classList.add("hidden");
  if (solvedReasonEl) solvedReasonEl.textContent = "";
  if (flagBox) flagBox.classList.add("hidden");
}

function showFlag(flag) {
  if (!flagBox || !flag) return;
  if (flagText) flagText.textContent = flag;
  flagBox.classList.remove("hidden");
}

function updateCharCount() {
  if (!charCount || !userInput) return;
  const len = userInput.value.length;
  charCount.textContent = `${len} / ${MAX_LEN}`;
  charCount.classList.toggle("over-limit", len > MAX_LEN);
}

function autoResize() {
  if (!userInput) return;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
}

function setComposerBusy(busy) {
  if (sendBtn) sendBtn.disabled = busy;
  if (userInput) userInput.disabled = busy;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postJSON(url, payload, timeoutMs) {
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs);
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out. The model may be slow, unreachable, or Ollama isn't running.");
    } else {
      showError("Network error - could not reach the server. Is the app running?");
    }
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    showError(`Server returned an unreadable response (HTTP ${res.status}).`);
    return null;
  }

  if (!res.ok) {
    showError(data && data.error ? data.error : `Request failed (HTTP ${res.status}).`);
    return null;
  }
  if (!data || typeof data !== "object") {
    showError("Server response was malformed.");
    return null;
  }

  setStatus("ok");
  return data;
}

function rememberSession(id) {
  if (!id) return;
  sessionId = id;
  localStorage.setItem(STORAGE_KEY + "_session_id", id);
}

function forgetSession() {
  sessionId = null;
  localStorage.removeItem(STORAGE_KEY + "_session_id");
}

function clearThread() {
  termWindow.innerHTML = "";
  if (emptyState) {
    termWindow.appendChild(emptyState);
    emptyState.classList.remove("hidden");
  }
}

if (sendBtn) sendBtn.addEventListener("click", () => sendMessage());
if (userInput) {
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  userInput.addEventListener("input", () => { updateCharCount(); autoResize(); });
}

if (!marked_ready) {
  console.warn("marked.js failed to load - markdown will render as plain text.");
}
if (!dompurify_ready) {
  console.warn("DOMPurify failed to load - assistant replies will render as plain text.");
}

updateCharCount();
autoResize();

const flagInput = document.getElementById("flagInput");
const flagSubmitBtn = document.getElementById("flagSubmitBtn");
const flagResult = document.getElementById("flagResult");

function showFlagResult(message, kind) {
  if (!flagResult) return;
  flagResult.textContent = message;
  flagResult.classList.remove("ok", "bad", "hidden");
  if (kind) flagResult.classList.add(kind);
}

function clearFlagResult() {
  if (!flagResult) return;
  flagResult.textContent = "";
  flagResult.classList.remove("ok", "bad");
  flagResult.classList.add("hidden");
}

function applyState(data) {
  if (!data) return;
  if (attemptCount) {
    attemptCount.textContent = Number.isFinite(data.attempts) ? data.attempts : "?";
  }
  if (data.solved) {
    markSolved(data.solved_reason);
    showFlag(data.flag);
  }
}

async function sendMessage() {
  clearError();
  const message = userInput.value.trim();

  if (!message) {
    showError("Type a message first.");
    return;
  }
  if (message.length > MAX_LEN) {
    showError(`Message is too long (${message.length}/${MAX_LEN} characters).`);
    return;
  }

  appendLine("user", message);
  userInput.value = "";
  updateCharCount();
  autoResize();
  setComposerBusy(true);
  const pendingEl = appendPending("thinking...");

  const data = await postJSON("/api/chat", {
    session_id: sessionId,
    message,
    model: modelInput.value.trim() || null,
  });

  pendingEl.remove();
  setComposerBusy(false);

  if (!data) return;

  rememberSession(data.session_id);

  appendLine("assistant", data.reply || "");
  applyState(data);

  scrollToBottom();
  userInput.focus();
}

async function submitFlag() {
  clearError();

  if (!flagInput) return;
  const candidate = flagInput.value.trim();
  if (!candidate) {
    showFlagResult("Enter a flag first.", "bad");
    return;
  }

  flagSubmitBtn.disabled = true;
  const data = await postJSON("/api/submit-flag", {
    session_id: sessionId,
    flag: candidate,
  }, 15000);
  flagSubmitBtn.disabled = false;

  if (!data) {
    clearFlagResult();
    return;
  }

  rememberSession(data.session_id);

  if (data.correct) {
    showFlagResult("Correct - that is the token from the internal operator record.", "ok");
    flagInput.value = "";
    applyState(data);
  } else {
    showFlagResult("Not the flag. It is in what the API returns, not in what the bot says.", "bad");
  }
}

if (flagSubmitBtn) {
  flagSubmitBtn.addEventListener("click", () => submitFlag());
}
if (flagInput) {
  flagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitFlag();
    }
  });
}

async function refreshStatus() {
  if (!sessionId) return;
  let res;
  try {
    res = await fetchWithTimeout("/api/session/" + encodeURIComponent(sessionId), {}, 10000);
  } catch (err) {
    return;
  }
  if (!res.ok) return;
  try {
    applyState(await res.json());
  } catch (err) {
  }
}

if (resetBtn) {
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

    forgetSession();
    clearThread();
    markUnsolved();
    clearFlagResult();
    if (flagInput) flagInput.value = "";
    if (attemptCount) attemptCount.textContent = "0";
    updateCharCount();
  });
}

refreshStatus();
