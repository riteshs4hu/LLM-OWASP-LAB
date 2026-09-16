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

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const clearDocBtn = document.getElementById("clearDocBtn");
const docNameEl = document.getElementById("docName");
const docSizeStat = document.getElementById("docSizeStat");

const mDocSize = document.getElementById("mDocSize");
const mDocTokens = document.getElementById("mDocTokens");
const mTurnChars = document.getElementById("mTurnChars");
const mTotalChars = document.getElementById("mTotalChars");
const mQuestions = document.getElementById("mQuestions");
const mWasted = document.getElementById("mWasted");
const mElapsed = document.getElementById("mElapsed");
const meterFill = document.getElementById("meterFill");
const meterPct = document.getElementById("meterPct");
const meterNote = document.getElementById("meterNote");

let budgetTotalChars = 2000000;

const UPLOAD_TIMEOUT_MS = 600000;

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("en-US");
}

function humanBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "none";
  const units = ["B", "KB", "MB", "GB"];
  let size = v;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return i === 0 ? Math.round(size) + " B" : size.toFixed(1) + " " + units[i];
}

function setNote(text, level) {
  if (!meterNote) return;
  if (!text) {
    meterNote.classList.add("hidden");
    meterNote.textContent = "";
    return;
  }
  meterNote.textContent = text;
  meterNote.classList.remove("hidden", "alert", "warn");
  if (level) meterNote.classList.add(level);
}

function renderMeter(state) {
  if (!state || typeof state !== "object") return;

  if (Number.isFinite(Number(state.budget_total_chars))) {
    budgetTotalChars = Number(state.budget_total_chars);
  }

  const sizeLabel = state.doc_bytes ? humanBytes(state.doc_bytes) : "none";
  if (mDocSize) mDocSize.textContent = sizeLabel;
  if (docSizeStat) docSizeStat.textContent = sizeLabel;
  if (mDocTokens) mDocTokens.textContent = fmtInt(state.doc_tokens);
  if (mTurnChars) mTurnChars.textContent = fmtInt(state.turn_chars);
  if (mTotalChars) mTotalChars.textContent = fmtInt(state.total_chars);
  if (mQuestions) mQuestions.textContent = fmtInt(state.questions);
  if (mWasted) mWasted.textContent = fmtInt(state.wasted_tokens) + " tok";
  if (mElapsed) mElapsed.textContent = Number(state.elapsed || 0).toFixed(1) + "s";
  if (attemptCount) attemptCount.textContent = fmtInt(state.questions);

  if (docNameEl) {
    docNameEl.textContent = state.doc_name
      ? state.doc_name + " - " + sizeLabel + ", re-sent " + fmtInt(state.resends) + " time(s)"
      : "No document loaded";
    docNameEl.classList.toggle("loaded", Boolean(state.doc_name));
  }

  const share = budgetTotalChars > 0 ? Number(state.total_chars || 0) / budgetTotalChars : 0;
  if (meterFill) {
    meterFill.style.width = Math.min(100, share * 100).toFixed(1) + "%";
    meterFill.classList.toggle("warn", share >= 0.6 && share < 1);
    meterFill.classList.toggle("over", share >= 1);
  }
  if (meterPct) {
    meterPct.textContent = share >= 1
      ? "budget blown (" + fmtInt(share * 100) + "%)"
      : fmtInt(share * 100) + "% of budget";
  }

  if (state.solved) markSolved(state.solved_reason);
}

function updateForecast(state) {
  if (!state || !state.doc_tokens) {
    setNote("", null);
    return;
  }
  const perTurn = Number(state.doc_tokens) || 0;
  const wasted = Number(state.wasted_tokens) || 0;
  if (wasted > 0) {
    setNote(
      "Every question re-sends the whole document: " + fmtInt(perTurn) + " tokens each time. " +
      fmtInt(wasted) + " tokens of that have been pure repetition so far - the same bytes, " +
      "billed again, because the app never chunks, retrieves or caches.",
      wasted > perTurn * 3 ? "alert" : "warn"
    );
  } else {
    setNote(
      "The next question will carry all " + fmtInt(perTurn) + " document tokens with it, " +
      "and so will the one after that.",
      null
    );
  }
}

function renderFailure(container, reason, state) {
  const box = document.createElement("div");
  box.className = "tool-event violated";

  const header = document.createElement("div");
  header.className = "tool-event-header";
  header.innerHTML =
    '<span class="tool-name">request failed</span>' +
    '<span class="tool-detail">' + escapeHtml(Number(state && state.elapsed || 0).toFixed(1)) + 's</span>' +
    '<span class="violation-badge">denial of service</span>';

  const line = document.createElement("div");
  line.className = "result-line blocked";
  line.textContent = reason || "The upstream request failed.";

  const detail = document.createElement("div");
  detail.className = "tool-detail";
  detail.textContent =
    "The turn still cost " + fmtInt(state && state.turn_chars) +
    " characters of prompt. Failing under the weight of the document is the " +
    "denial of service, not an escape from it.";

  box.appendChild(header);
  box.appendChild(line);
  box.appendChild(detail);
  container.appendChild(box);
}

async function sendMessage() {
  clearError();
  const message = userInput.value.trim();

  if (!message) {
    showError("Type a question first.");
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
  const pendingEl = appendPending("sending the whole document again...");

  const data = await postJSON("/api/chat", {
    session_id: sessionId,
    message,
    model: modelInput.value.trim() || null,
  });

  pendingEl.remove();
  setComposerBusy(false);

  if (!data) return;

  rememberSession(data.session_id);

  if (data.failed) {
    const line = appendLine("assistant", "");
    line.bodyEl.remove();
    renderFailure(line.col, data.failure_reason, data);
    showError(data.failure_reason || "The request to the model failed.");
  } else {
    appendLine("assistant", data.reply || "(the model returned an empty reply)");
  }

  renderMeter(data);
  updateForecast(data);
  scrollToBottom();
  userInput.focus();
}

async function uploadDocument() {
  clearError();
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    showError("Choose a text file first.");
    return;
  }

  const file = fileInput.files[0];
  const form = new FormData();
  form.append("file", file, file.name);
  if (sessionId) form.append("session_id", sessionId);

  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading " + humanBytes(file.size) + "...";
  }
  if (docNameEl) docNameEl.textContent = "Uploading " + file.name + " (" + humanBytes(file.size) + ")...";

  let res;
  try {
    res = await fetchWithTimeout("/api/upload", { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
  } catch (err) {
    if (err && err.name === "AbortError") {
      showError("The upload timed out. That is the vulnerability working as designed - try a smaller file.");
    } else {
      showError("Network error during upload - could not reach the server. Is the app running?");
    }
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = "Upload"; }
    await loadState();
    return;
  } finally {
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = "Upload"; }
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    showError(`Server returned an unreadable response to the upload (HTTP ${res.status}).`);
    await loadState();
    return;
  }

  if (!res.ok) {
    showError(data && data.error ? data.error : `Upload failed (HTTP ${res.status}).`);
    await loadState();
    return;
  }

  setStatus("ok");
  rememberSession(data.session_id);
  renderMeter(data);
  updateForecast(data);
  hideEmptyState();
  appendLine(
    "assistant",
    "Loaded **" + (data.doc_name || file.name) + "** (" + humanBytes(data.doc_bytes) +
    ", about " + fmtInt(data.doc_tokens) + " tokens). It will be attached in full to " +
    "every question you ask from now on."
  );
  scrollToBottom();
}

async function clearDocument() {
  clearError();
  if (!sessionId) {
    showError("There is no document loaded yet.");
    return;
  }
  if (clearDocBtn) clearDocBtn.disabled = true;

  const data = await postJSON("/api/document", { session_id: sessionId }, 15000);

  if (clearDocBtn) clearDocBtn.disabled = false;
  if (!data) return;

  if (fileInput) fileInput.value = "";
  renderMeter(data);
  updateForecast(data);
  appendLine("assistant", "Document cleared. The question counters and the cumulative total stay - those characters were already sent.");
  scrollToBottom();
}

async function loadState() {
  if (!sessionId) {
    if (docNameEl && !docNameEl.classList.contains("loaded")) {
      docNameEl.textContent = "No document loaded";
    }
    return;
  }
  const data = await postJSON("/api/state", { session_id: sessionId }, 15000);
  if (!data) return;
  renderMeter(data);
  updateForecast(data);
}

if (uploadBtn) uploadBtn.addEventListener("click", () => uploadDocument());
if (clearDocBtn) clearDocBtn.addEventListener("click", () => clearDocument());

if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (!docNameEl) return;
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      docNameEl.textContent = "Ready to upload: " + file.name + " (" + humanBytes(file.size) + ")";
      docNameEl.classList.remove("loaded");
    }
  });
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
    if (fileInput) fileInput.value = "";
    if (docNameEl) {
      docNameEl.textContent = "No document loaded";
      docNameEl.classList.remove("loaded");
    }
    setNote("", null);
    renderMeter({
      doc_name: "", doc_bytes: 0, doc_tokens: 0, turn_chars: 0, total_chars: 0,
      questions: 0, resends: 0, wasted_tokens: 0, elapsed: 0,
      budget_total_chars: budgetTotalChars, solved: false, solved_reason: "",
    });
    updateCharCount();
  });
}

loadState();
