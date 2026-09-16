const errorBanner = document.getElementById("errorBanner");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");

function showError(message) {
  if (!errorBanner) return;
  errorBanner.textContent = String(message);
  errorBanner.classList.remove("hidden");
}

async function signIn() {
  if (errorBanner) errorBanner.classList.add("hidden");
  loginBtn.disabled = true;
  let res;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput ? usernameInput.value : "",
        password: passwordInput ? passwordInput.value : "",
      }),
    });
  } catch (err) {
    loginBtn.disabled = false;
    showError("Network error - could not reach the server.");
    return;
  }
  loginBtn.disabled = false;
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    showError("Server returned an unreadable response (HTTP " + res.status + ").");
    return;
  }
  if (!res.ok) {
    showError(data.error || "Sign in failed (HTTP " + res.status + ").");
    return;
  }
  window.location.href = "/";
}

if (loginBtn) loginBtn.addEventListener("click", signIn);
if (passwordInput) {
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") signIn();
  });
}
