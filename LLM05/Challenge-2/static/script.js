let conversation = JSON.parse(localStorage.getItem("llm05c2_conversation") || "[]");

function saveConversation() {
  localStorage.setItem("llm05c2_conversation", JSON.stringify(conversation));
}

const MAX_LEN = 2000;
const REQUEST_TIMEOUT_MS = 130000;

const termWindow = document.getElementById("termWindow");
const emptyState = document.getElementById("emptyState");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const modelInput = document.getElementById("model");
const errorBanner = document.getElementById("errorBanner");
const charCount = document.getElementById("charCount");
const connStatus = document.getElementById("connStatus");
const themeToggle = document.getElementById("themeToggle");

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

function hideEmptyState() {
  if (emptyState) emptyState.classList.add("hidden");
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
    body.innerHTML = marked.parse(text);
  } else {
    body.textContent = text;
  }

  col.appendChild(body);

  div.appendChild(who);
  div.appendChild(col);

  termWindow.appendChild(div);
  termWindow.scrollTop = termWindow.scrollHeight;
  return div;
}

function appendPending() {
  hideEmptyState();
  const div = document.createElement("div");
  div.className = "line assistant pending";
  div.innerHTML = `<div class="who"></div><div class="line-col"><div class="body"><span class="dots"><span></span><span></span><span></span></span> thinking...</div></div>`;
  termWindow.appendChild(div);
  termWindow.scrollTop = termWindow.scrollHeight;
  return div;
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
    showError("Type a message first.");
    return;
  }
  if (raw.length > MAX_LEN) {
    showError(`Message is too long (${raw.length}/${MAX_LEN} characters).`);
    return;
  }

  conversation.push({ role: "user", content: raw });
  const outgoingMessages = conversation.map(m => ({ role: m.role, content: m.content }));
  appendLine("user", raw);

  const payload = {
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

  if (data.reply) {
    conversation.push({ role: "assistant", content: data.reply });
  }
  saveConversation();

  appendLine("assistant", data.reply || "");

  userInput.focus();
}

resetBtn.addEventListener("click", () => {
  clearError();
  conversation = [];
  localStorage.removeItem("llm05c2_conversation");
  termWindow.innerHTML = "";
  if (emptyState) {
    termWindow.appendChild(emptyState);
    emptyState.classList.remove("hidden");
  }
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

updateCharCount();
autoResize();
rehydrateConversation();
