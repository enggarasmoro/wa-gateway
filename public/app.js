const API_BASE = "/api";
let refreshInterval;

showDashboard();

function authFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.headers || {}),
    },
  });
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("loginError");

  try {
    const res = await authFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success) {
      showDashboard();
    } else {
      errorEl.textContent = data.error || "Login failed";
      errorEl.style.display = "block";
    }
  } catch (err) {
    errorEl.textContent = "Connection error";
    errorEl.style.display = "block";
  }
});

function showDashboard() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  fetchStatus();
  fetchLogs();
  clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    fetchStatus();
    fetchLogs();
  }, 5000);
}

function showLogin() {
  clearInterval(refreshInterval);
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loginPage").style.display = "flex";
}

document.getElementById("btnDashboardLogout").addEventListener("click", async () => {
  try {
    await authFetch("/auth/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});

async function fetchStatus() {
  try {
    const res = await authFetch("/dashboard/status");

    if (res.status === 401) {
      showLogin();
      return;
    }

    const data = await res.json();
    if (data.success) {
      const d = data.data;
      const connEl = document.getElementById("statusConnection");
      connEl.textContent = d.isConnected ? "Connected" : "Disconnected";
      connEl.className =
        "value " +
        (d.isConnected
          ? "status-connected"
          : d.state === "WAITING_FOR_QR_SCAN"
          ? "status-waiting"
          : "status-disconnected");

      document.getElementById("statusState").textContent = d.state || "-";
      document.getElementById("statusPhone").textContent = d.phoneNumber
        ? `+${d.phoneNumber}`
        : "-";
      document.getElementById("statusUptime").textContent = formatUptime(d.uptime);

      if (d.hasQR && !d.isConnected) {
        fetchQR();
      } else {
        document.getElementById("qrImage").classList.add("hidden");
        document.getElementById("qrPlaceholder").classList.remove("hidden");
        document.getElementById("qrPlaceholder").textContent = d.isConnected
          ? "Connected"
          : "Waiting for QR code...";
      }
    }
  } catch (err) {
    console.error("Status fetch error:", err);
  }
}

async function fetchQR() {
  try {
    const res = await authFetch("/dashboard/qr");
    const data = await res.json();
    if (data.success && data.data.qrCode) {
      document.getElementById("qrImage").src = data.data.qrCode;
      document.getElementById("qrImage").classList.remove("hidden");
      document.getElementById("qrPlaceholder").classList.add("hidden");
    }
  } catch (err) {
    console.error("QR fetch error:", err);
  }
}

async function fetchLogs() {
  try {
    const res = await authFetch("/dashboard/logs");
    if (res.status === 401) {
      showLogin();
      return;
    }
    const data = await res.json();
    if (data.success) {
      renderLogs(data.data);
    }
  } catch (err) {
    console.error("Logs fetch error:", err);
  }
}

function renderLogs(logs) {
  const container = document.getElementById("logList");
  container.replaceChildren();

  if (!logs || logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "No messages yet";
    container.appendChild(empty);
    return;
  }

  for (const log of logs) {
    const item = document.createElement("div");
    item.className = "log-item";

    const status = document.createElement("div");
    status.className = `log-status ${log.success ? "success" : "error"}`;

    const content = document.createElement("div");
    content.className = "log-content";

    const target = document.createElement("div");
    target.className = "log-target";
    target.textContent = log.target || "-";
    content.appendChild(target);

    if (log.message) {
      const message = document.createElement("div");
      message.className = "log-message";
      message.textContent = log.message;
      content.appendChild(message);
    }

    if (log.error) {
      const error = document.createElement("div");
      error.className = "log-message log-error";
      error.textContent = log.error;
      content.appendChild(error);
    }

    const time = document.createElement("div");
    time.className = "log-time";
    time.textContent = formatTime(log.timestamp);

    item.append(status, content, time);
    container.appendChild(item);
  }
}

document.getElementById("sendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const target = document.getElementById("target").value;
  const message = document.getElementById("message").value;
  const resultEl = document.getElementById("sendResult");

  resultEl.style.display = "none";

  try {
    const res = await authFetch("/dashboard/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, message }),
    });

    const data = await res.json();
    resultEl.textContent = data.message;
    resultEl.className = "send-result " + (data.success ? "success" : "error");
    resultEl.style.display = "block";

    if (data.success) {
      document.getElementById("message").value = "";
      fetchLogs();
    }
  } catch (err) {
    resultEl.textContent = "Failed to send message";
    resultEl.className = "send-result error";
    resultEl.style.display = "block";
  }
});

document.getElementById("btnWALogout").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to logout WhatsApp? You will need to scan QR code again.")) {
    return;
  }

  try {
    const res = await authFetch("/dashboard/logout", { method: "POST" });
    const data = await res.json();
    alert(data.message || (data.success ? "Logged out" : "Failed"));
    fetchStatus();
  } catch (err) {
    alert("Failed to logout");
  }
});

function formatUptime(seconds) {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}
