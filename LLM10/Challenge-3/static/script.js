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

const stopBtn = document.getElementById("stopBtn");
const meterFill = document.getElementById("meterFill");
const meterCap = document.getElementById("meterCap");
const meterCapVal = document.getElementById("meterCapVal");
const mElapsed = document.getElementById("mElapsed");

let streamAbort = null;
let turnActive = false;
let turnStartedAt = 0;
let elapsedTimer = null;

function setTurnBusy(busy) {
  turnActive = busy;
  setComposerBusy(busy);
  if (stopBtn) stopBtn.classList.toggle("hidden", !busy);

  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  if (busy) {
    turnStartedAt = Date.now();

    elapsedTimer = setInterval(() => {
      if (mElapsed) mElapsed.textContent = ((Date.now() - turnStartedAt) / 1000).toFixed(1);
    }, 200);
  }
}

function setText(el, value) {
  if (el) el.textContent = value == null ? "-" : String(value);
}

function setCounter(el, value, hotAt) {
  if (!el) return;
  const n = Number(value) || 0;
  el.textContent = String(n);
  const holder = el.closest(".meter-row") || el.closest(".meter-cell");
  if (holder && typeof hotAt === "number") holder.classList.toggle("hot", n >= hotAt);
}

function setBar(current, budget, label) {
  const c = Number(current) || 0;
  const b = Number(budget) || 0;
  const pct = b > 0 ? Math.min(100, (c / b) * 100) : 0;
  if (meterFill) {
    meterFill.style.width = pct.toFixed(1) + "%";
    meterFill.classList.remove("warn", "danger");
    if (b > 0 && c >= b) meterFill.classList.add("danger");
    else if (pct >= 60) meterFill.classList.add("warn");
  }
  if (meterCapVal) meterCapVal.textContent = label || (c + " / " + b);
  if (meterCap) meterCap.classList.toggle("over", b > 0 && c >= b);
}

function setLinePending(line, label) {
  if (!line || !line.bodyEl) return;
  line.isPending = true;
  line.classList.add("pending");
  line.bodyEl.innerHTML =
    '<span class="dots"><span></span><span></span><span></span></span> ' + escapeHtml(label || "");
  scrollToBottom();
}

function clearLinePending(line, text) {
  if (!line || !line.isPending) return;
  line.isPending = false;
  line.classList.remove("pending");
  if (line.bodyEl) line.bodyEl.innerHTML = text ? renderMarkdown(text) : "";
}

function parseFrame(frame) {
  const parts = [];
  frame.split("\n").forEach((line) => {
    if (line.indexOf("data:") === 0) parts.push(line.slice(5).trim());
  });
  if (!parts.length) return null;
  try {
    return JSON.parse(parts.join("\n"));
  } catch (err) {
    console.warn("Unparseable SSE frame, skipping:", frame);
    return null;
  }
}

function handleEvent(payload, line) {
  if (!payload || typeof payload !== "object") return;

  if (payload.type === "start") {
    if (payload.session_id) rememberSession(payload.session_id);
    updateMeter(payload.meter);
    return;
  }
  if (payload.type === "iteration") {
    renderIteration(line.col, payload.event);
    updateMeter(payload.meter);
    scrollToBottom();
    return;
  }
  if (payload.type === "error") {
    showError(payload.message || "The server reported an error during the turn.");
    return;
  }
  if (payload.type === "done") {
    if (payload.session_id) rememberSession(payload.session_id);
    updateMeter(payload.meter);
    line.isPending = false;
    line.classList.remove("pending");
    if (line.bodyEl) {
      line.bodyEl.innerHTML = renderMarkdown(
        payload.reply || "_(the loop ended without a final message)_"
      );
    }
    if (payload.solved) markSolved(payload.solved_reason);
  }
}

async function streamTurn(jobId, line) {
  streamAbort = new AbortController();

  let res;
  try {
    res = await fetch("/api/stream/" + encodeURIComponent(jobId), {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: streamAbort.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") return { aborted: true };
    showError("Network error - could not open the event stream. Is the app still running?");
    return { failed: true };
  }

  if (!res.ok) {
    let message = `Could not open the event stream (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {  }
    showError(message);
    return { failed: true };
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    showError("This browser cannot read streaming responses, so the turn cannot be displayed.");
    return { failed: true };
  }

  setStatus("ok");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = false;

  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err && err.name === "AbortError") { aborted = true; break; }
      showError("The event stream dropped before the turn finished.");
      break;
    }
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });

    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const payload = parseFrame(frame);
      if (payload) handleEvent(payload, line);
    }
  }

  return { aborted };
}

async function sendMessage() {
  clearError();

  if (turnActive) {
    showError("A turn is already running. Stop it or wait for it to finish.");
    return;
  }

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

  setTurnBusy(true);
  updateMeter(blankMeter(true));

  const line = appendLine("assistant", "");
  setLinePending(line, "running the agent loop...");

  const data = await postJSON("/api/chat", {
    session_id: sessionId,
    message,
    model: modelInput.value.trim() || null,
  }, 30000);

  if (!data) {
    line.remove();
    setTurnBusy(false);
    return;
  }
  if (!data.job_id) {
    line.remove();
    setTurnBusy(false);
    showError("The server accepted the message but returned no job id.");
    return;
  }

  rememberSession(data.session_id);

  const outcome = await streamTurn(data.job_id, line);

  clearLinePending(line, "");
  setTurnBusy(false);
  streamAbort = null;

  scrollToBottom();
  userInput.focus();
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    if (streamAbort) streamAbort.abort();
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    clearError();
    if (streamAbort) streamAbort.abort();
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
    setTurnBusy(false);
    updateMeter(blankMeter(false));
    updateCharCount();
  });
}

const BUDGET_ITERATIONS = 12;

const mIter = document.getElementById("mIter");
const mSearch = document.getElementById("mSearch");
const mSummarize = document.getElementById("mSummarize");
const mRepeat = document.getElementById("mRepeat");
const mCumulative = document.getElementById("mCumulative");
const mPattern = document.getElementById("mPattern");
const peakIterations = document.getElementById("peakIterations");

let lastMeter = {};

function blankMeter(keepSession) {
  return {
    iterations: 0,
    search_web: 0,
    summarize: 0,
    repeated_queries: 0,
    elapsed: 0,
    pattern: "",
    budget: BUDGET_ITERATIONS,
    session_tool_calls: keepSession ? (lastMeter.session_tool_calls || 0) : 0,
    peak_iterations: keepSession ? (lastMeter.peak_iterations || 0) : 0,
  };
}

function updateMeter(meter) {
  if (!meter || typeof meter !== "object") return;
  lastMeter = meter;

  const budget = Number(meter.budget) || BUDGET_ITERATIONS;
  const iterations = Number(meter.iterations) || 0;

  setCounter(mIter, iterations, budget + 1);
  setCounter(mSearch, meter.search_web);
  setCounter(mSummarize, meter.summarize);
  setCounter(mRepeat, meter.repeated_queries, 1);
  setCounter(mCumulative, meter.session_tool_calls);
  setCounter(peakIterations, meter.peak_iterations);
  if (mElapsed) mElapsed.textContent = (Number(meter.elapsed) || 0).toFixed(1);
  if (attemptCount) attemptCount.textContent = String(Number(meter.session_tool_calls) || 0);

  setBar(iterations, budget, iterations + " / " + budget);

  if (mPattern) {
    if (meter.pattern) {
      mPattern.textContent = "Pattern detected: " + meter.pattern + ". Detected, not prevented.";
      mPattern.classList.add("alert");
    } else {
      mPattern.textContent = "No repeating pattern detected yet.";
      mPattern.classList.remove("alert");
    }
  }
}

function renderIteration(col, ev) {
  if (!col || !ev) return;

  const flagged = Boolean(ev.error || ev.repeat || Number(ev.index) > BUDGET_ITERATIONS);

  const box = document.createElement("div");
  box.className = "tool-event" + (flagged ? " violated" : "");

  const header = document.createElement("div");
  header.className = "tool-event-header";

  const index = document.createElement("span");
  index.className = "tool-event-index";
  index.textContent = "#" + (ev.index == null ? "?" : ev.index);

  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = ev.tool || "(unknown tool)";

  header.appendChild(index);
  header.appendChild(name);

  if (ev.detail) {
    const detail = document.createElement("span");
    detail.className = "tool-detail";
    detail.textContent = ev.detail;
    header.appendChild(detail);
  }

  let badgeText = "";
  let badgeClass = "";
  if (ev.error) {
    badgeText = "malformed call";
  } else if (ev.repeat) {
    badgeText = "repeat query";
  } else if (Number(ev.index) > BUDGET_ITERATIONS) {
    badgeText = "over budget";
    badgeClass = " warn";
  }
  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "violation-badge" + badgeClass;
    badge.textContent = badgeText;
    header.appendChild(badge);
  }

  const body = document.createElement("div");
  body.className = "tool-event-body single";

  const block = document.createElement("div");
  block.className = "result-block" + (flagged ? " insecure" : "");

  const label = document.createElement("div");
  label.className = "result-label";
  label.textContent = "Tool result (simulated backend)";

  const text = document.createElement("div");
  text.className = "result-text";
  text.textContent = ev.result || "(no result)";

  block.appendChild(label);
  block.appendChild(text);
  body.appendChild(block);

  box.appendChild(header);
  box.appendChild(body);
  col.appendChild(box);
}

updateMeter(blankMeter(false));
