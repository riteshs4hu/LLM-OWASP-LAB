(function () {
  var saved = localStorage.getItem("theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
})();

const errorBanner = document.getElementById("errorBanner");
const noticeBanner = document.getElementById("noticeBanner");
const loginCard = document.getElementById("loginCard");
const adminBody = document.getElementById("adminBody");
const logoutBtn = document.getElementById("logoutBtn");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const fileInput = document.getElementById("fileInput");

const uploadBtn = document.getElementById("uploadBtn");
const reindexBtn = document.getElementById("reindexBtn");
const dirtyFlag = document.getElementById("dirtyFlag");
const docList = document.getElementById("docList");

const mDocuments = document.getElementById("mDocuments");
const mIndexedDocs = document.getElementById("mIndexedDocs");
const mChunks = document.getElementById("mChunks");
const mBackend = document.getElementById("mBackend");
const mReindexes = document.getElementById("mReindexes");
const mChunksA = document.getElementById("mChunksA");
const mChunksB = document.getElementById("mChunksB");
const tenantSwitch = document.getElementById("tenantSwitch");
const tenantHint = document.getElementById("tenantHint");
let activeTenant = document.body.dataset.tenant || "tenant-a";
const indexNote = document.getElementById("indexNote");

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function showError(message) {
  if (!errorBanner) return;
  errorBanner.textContent = String(message);
  errorBanner.classList.remove("hidden");
}

function clearError() {
  if (!errorBanner) return;
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function showNotice(message) {
  if (!noticeBanner) return;
  noticeBanner.textContent = String(message);
  noticeBanner.classList.remove("hidden");
  setTimeout(() => noticeBanner.classList.add("hidden"), 6000);
}

function setText(el, value) {
  if (el) el.textContent = value;
}

async function api(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    showError("Network error - could not reach the server.");
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    showError("Server returned an unreadable response (HTTP " + res.status + ").");
    return null;
  }
  if (res.status === 401) {
    setSignedIn(false);
    showError(data.error || "Session expired. Sign in again.");
    return null;
  }
  if (!res.ok) {
    showError(data.error || "Request failed (HTTP " + res.status + ").");
    return null;
  }
  return data;
}

function setSignedIn(yes) {
  if (loginCard) loginCard.classList.toggle("hidden", yes);
  if (adminBody) adminBody.classList.toggle("hidden", !yes);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !yes);
}

function renderIndex(index) {
  if (!index) return;
  setText(mDocuments, index.documents || 0);
  setText(mIndexedDocs, index.indexed_documents || 0);
  setText(mChunks, index.chunks || 0);
  setText(mBackend, index.backend || "-");
  setText(mReindexes, index.reindexes || 0);
  const byTenant = index.chunks_by_tenant || {};
  setText(mChunksA, byTenant["tenant-a"] || 0);
  setText(mChunksB, byTenant["tenant-b"] || 0);
  const pending = index.pending || {};
  if (dirtyFlag) {
    dirtyFlag.classList.toggle("hidden", !index.dirty);
    if (index.dirty) {
      const parts = [];
      if (pending.added) parts.push(pending.added + " added");
      if (pending.changed) parts.push(pending.changed + " replaced");
      if (pending.removed) parts.push(pending.removed + " removed");
      dirtyFlag.textContent =
        "Not in the index yet: " + (parts.join(", ") || "changes") +
        ". Answers still come from the last rebuild until you press Update RAG.";
    }
  }
  if (reindexBtn) reindexBtn.classList.toggle("attention", !!index.dirty);
  if (indexNote) {
    if (index.backend_note) {
      indexNote.textContent = index.backend_note;
      indexNote.classList.remove("hidden");
    } else {
      indexNote.classList.add("hidden");
      indexNote.textContent = "";
    }
  }
}

function renderDocuments(documents) {
  if (!docList) return;
  docList.innerHTML = "";
  if (!Array.isArray(documents) || !documents.length) {
    docList.innerHTML = '<p class="ledger-empty">The knowledge base is empty.</p>';
    return;
  }
  documents.forEach((doc) => {
    const item = document.createElement("div");
    item.className = "doc-item";
    item.innerHTML =
      '<div class="doc-head">' +
        '<span class="doc-title">' + escapeHtml(doc.name) + "</span>" +
        '<span class="doc-tag ' + escapeHtml(doc.tenant) + '">' +
          escapeHtml(doc.tenant_label) + "</span>" +
        '<span class="doc-tag ' + (doc.origin === "seed" ? "seed" : "uploaded") + '">' +
          escapeHtml(doc.origin) + "</span>" +
      "</div>" +
      '<div class="doc-meta">' + doc.chars + " characters, owned by " +
        escapeHtml(doc.tenant_label) + "</div>" +
      '<div class="doc-preview">' + escapeHtml(doc.preview) + "</div>";

    const remove = document.createElement("button");
    remove.className = "doc-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const data = await api("/api/admin/documents/" + encodeURIComponent(doc.id), { method: "DELETE" });
      remove.disabled = false;
      if (!data) return;
      showNotice("Deleted " + doc.name + ". Its passages are still in the index and can still be retrieved until you press Update RAG.");
      loadDocuments();
    });
    item.appendChild(remove);
    docList.appendChild(item);
  });
}

async function loadDocuments() {
  const data = await api("/api/admin/documents", { method: "GET" });
  if (!data) return;
  activeTenant = data.tenant;
  renderIndex(data.index);
  renderDocuments(data.documents);
  renderTenantSwitch(data);
}

function renderTenantSwitch(data) {
  if (tenantSwitch) {
    tenantSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tenant === activeTenant);
    });
  }
  if (tenantHint) {
    tenantHint.textContent =
      "Uploads and deletions apply to " + data.tenant_label + " (" + data.tenant_name +
      "). The index itself is shared by every tenant.";
  }
}

if (tenantSwitch) {
  tenantSwitch.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const data = await api("/api/admin/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant: btn.dataset.tenant }),
    });
    if (!data) return;
    activeTenant = data.tenant;
    loadDocuments();
  });
}

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    clearError();
    loginBtn.disabled = true;
    const data = await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput ? usernameInput.value : "",
        password: passwordInput ? passwordInput.value : "",
      }),
    });
    loginBtn.disabled = false;
    if (!data) return;
    if (passwordInput) passwordInput.value = "";
    setSignedIn(true);
    loadDocuments();
  });
}

if (passwordInput) {
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    setSignedIn(false);
  });
}

if (uploadBtn) {
  uploadBtn.addEventListener("click", async () => {
    clearError();
    if (!fileInput || !fileInput.files || !fileInput.files.length) {
      showError("Choose a .txt or .pdf file first.");
      return;
    }
    const form = new FormData();
    form.append("file", fileInput.files[0], fileInput.files[0].name);

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";
    const data = await api("/api/admin/documents", { method: "POST", body: form });
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload";
    if (!data) return;
    fileInput.value = "";
    showNotice("Stored " + data.document.name + ". It is not retrievable until you press Update RAG.");
    loadDocuments();
  });
}

if (reindexBtn) {
  reindexBtn.addEventListener("click", async () => {
    clearError();
    reindexBtn.disabled = true;
    reindexBtn.textContent = "Rebuilding...";
    const data = await api("/api/admin/reindex", { method: "POST" });
    reindexBtn.disabled = false;
    reindexBtn.textContent = "Update RAG";
    if (!data) return;
    renderIndex(data.index);
    showNotice("Knowledge base rebuilt: " + data.index.chunks + " chunks from " + data.index.indexed_documents + " documents.");
    loadDocuments();
  });
}

if (document.body.dataset.signedIn === "yes") {
  setSignedIn(true);
  loadDocuments();
} else {
  setSignedIn(false);
}
