const tokenKey = "dayneko-admin-token";
let token = localStorage.getItem(tokenKey) || "";
let configured = false;
let activeView = "overview";

const pageState = {
  users: { limit: 50, offset: 0, total: 0 },
  records: { limit: 50, offset: 0, total: 0 },
  requests: { limit: 50, offset: 0, total: 0 }
};

const $ = (selector) => document.querySelector(selector);

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function errorMessage(body, status) {
  const detail = body?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || JSON.stringify(item)).join("；");
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return detail || `请求失败：${status}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body;
}

function setAuthMessage(message) {
  $("#authMessage").textContent = typeof message === "string" ? message : JSON.stringify(message);
}

function pagerText(state) {
  if (!state.total) return "0 / 0";
  const from = state.offset + 1;
  const to = Math.min(state.offset + state.limit, state.total);
  return `${from}-${to} / ${state.total}`;
}

function setPager(name, data) {
  const state = pageState[name];
  state.total = data.total ?? data.items.length;
  state.limit = data.limit ?? state.limit;
  state.offset = data.offset ?? state.offset;
  const text = $(`#${name}PagerText`);
  const prev = $(`[data-page="${name}:prev"]`);
  const next = $(`[data-page="${name}:next"]`);
  if (text) text.textContent = pagerText(state);
  if (prev) prev.disabled = state.offset <= 0;
  if (next) next.disabled = state.offset + state.limit >= state.total;
}

function resetPage(name) {
  pageState[name].offset = 0;
}

function renderStats(summary) {
  $("#dbPath").textContent = summary.database || "数据库已连接";
  $("#stats").innerHTML = [
    ["用户", summary.users],
    ["记录", summary.records],
    ["好友关系", summary.friendships],
    ["好友申请", summary.friendRequests]
  ].map(([label, value]) => `
    <article class="stat">
      <span>${label}</span>
      <strong>${value ?? 0}</strong>
    </article>
  `).join("");

  $("#kindList").innerHTML = (summary.recordsByKind || []).map((item) => `
    <article class="kind-row">
      <strong>${item.kind}</strong>
      <span>${item.count}</span>
    </article>
  `).join("") || `<p class="empty">暂无记录。</p>`;
}

function rowButton(label, className = "") {
  return `<button class="${className}" type="button">${label}</button>`;
}

async function loadUsers() {
  if (!token) return;
  const state = pageState.users;
  const params = new URLSearchParams({
    q: $("#userSearch").value.trim(),
    limit: String(state.limit),
    offset: String(state.offset)
  });
  const data = await api(`/admin/api/users?${params.toString()}`);
  setPager("users", data);
  $("#usersTable").innerHTML = data.items.map((user) => `
    <article class="row three" data-user-id="${user.id}">
      <div>
        <strong>${user.name}</strong>
        <small>${user.handle} · ${user.id}</small>
      </div>
      <div>
        <small>记录 ${user.record_count || 0}</small>
        <small>${user.updated_at || ""}</small>
      </div>
      <div>${rowButton("删除", "danger")}</div>
    </article>
  `).join("") || `<p class="empty">没有找到用户。</p>`;

  $("#usersTable").querySelectorAll(".danger").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const row = event.currentTarget.closest("[data-user-id]");
      const id = row.dataset.userId;
      if (!confirm(`确认删除用户 ${id} 以及关联记录、好友关系和好友申请吗？`)) return;
      await api(`/admin/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    });
  });
}

function dateTimeFilterValue(id, endOfDay = false) {
  const value = $(id).value;
  if (!value) return "";
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+00:00`;
}

async function loadRecords() {
  if (!token) return;
  const state = pageState.records;
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset)
  });
  const kind = $("#recordKind").value;
  const q = $("#recordSearch").value.trim();
  const fromTime = dateTimeFilterValue("#recordFrom");
  const toTime = dateTimeFilterValue("#recordTo", true);
  if (kind) params.set("kind", kind);
  if (q) params.set("q", q);
  if (fromTime) params.set("from_time", fromTime);
  if (toTime) params.set("to_time", toTime);
  const data = await api(`/admin/api/records?${params.toString()}`);
  setPager("records", data);
  $("#recordsTable").innerHTML = data.items.map((record) => `
    <article class="row three" data-record-id="${record.id}">
      <div>
        <strong>${record.kind}</strong>
        <small>${record.id} · ${record.userId}</small>
        <small>${record.updatedAt || ""}</small>
      </div>
      <pre>${JSON.stringify(record.payload, null, 2)}</pre>
      <div>${rowButton("删除", "danger")}</div>
    </article>
  `).join("") || `<p class="empty">没有找到记录。</p>`;

  $("#recordsTable").querySelectorAll(".danger").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const row = event.currentTarget.closest("[data-record-id]");
      const id = row.dataset.recordId;
      if (!confirm(`确认删除记录 ${id} 吗？`)) return;
      await api(`/admin/api/records/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    });
  });
}

async function loadRequests() {
  if (!token) return;
  const state = pageState.requests;
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset)
  });
  const data = await api(`/admin/api/friend-requests?${params.toString()}`);
  setPager("requests", data);
  $("#requestsTable").innerHTML = data.items.map((request) => `
    <article class="row three" data-request-id="${request.id}">
      <div>
        <strong>${request.status}</strong>
        <small>${request.id}</small>
      </div>
      <div>
        <small>from ${request.from_user_id}</small>
        <small>to ${request.to_user_id}</small>
      </div>
      <div>${rowButton("删除", "danger")}</div>
    </article>
  `).join("") || `<p class="empty">暂无好友申请。</p>`;

  $("#requestsTable").querySelectorAll(".danger").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const row = event.currentTarget.closest("[data-request-id]");
      const id = row.dataset.requestId;
      if (!confirm(`确认删除申请 ${id} 吗？`)) return;
      await api(`/admin/api/friend-requests/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    });
  });
}

async function refresh() {
  if (!token) return;
  const summary = await api("/admin/api/summary");
  renderStats(summary);
  if (activeView === "users") await loadUsers();
  if (activeView === "records") await loadRecords();
  if (activeView === "requests") await loadRequests();
}

async function loadStatus() {
  const status = await api("/admin/api/status");
  configured = status.configured;
  $("#authMode").textContent = configured ? "管理员登录" : "初始化管理员";
  $("#authTitle").textContent = configured ? "登录后台" : "设置后台密码";
  $("#passwordInput").placeholder = configured ? "输入管理员密码" : "至少 8 位密码";
  $("#authCard").classList.toggle("hidden", Boolean(token));
  if (token) await refresh().catch(() => {
    token = "";
    localStorage.removeItem(tokenKey);
    $("#authCard").classList.remove("hidden");
  });
}

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#passwordInput").value;
  setAuthMessage("");
  if (!configured && password.length < 8) {
    setAuthMessage("管理员密码至少需要 8 位。");
    return;
  }
  try {
    if (!configured) {
      await api("/admin/api/setup", { method: "POST", body: JSON.stringify({ password }) });
      configured = true;
    }
    const result = await api("/admin/api/login", { method: "POST", body: JSON.stringify({ password }) });
    token = result.token;
    localStorage.setItem(tokenKey, token);
    $("#authCard").classList.add("hidden");
    $("#passwordInput").value = "";
    await refresh();
  } catch (error) {
    setAuthMessage(error.message || error);
  }
});

$("#logoutButton").addEventListener("click", () => {
  token = "";
  localStorage.removeItem(tokenKey);
  $("#authCard").classList.remove("hidden");
});

$("#refreshButton").addEventListener("click", () => refresh().catch((error) => alert(error.message)));
$("#userSearch").addEventListener("input", () => {
  resetPage("users");
  loadUsers().catch(() => undefined);
});
["recordKind", "recordSearch", "recordFrom", "recordTo"].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => {
    resetPage("records");
    loadRecords().catch(() => undefined);
  });
});

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", async () => {
    const [name, direction] = button.dataset.page.split(":");
    const state = pageState[name];
    state.offset = Math.max(0, state.offset + (direction === "next" ? state.limit : -state.limit));
    if (name === "users") await loadUsers();
    if (name === "records") await loadRecords();
    if (name === "requests") await loadRequests();
  });
});

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", async () => {
    activeView = button.dataset.view;
    document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `${activeView}View`));
    await refresh().catch((error) => alert(error.message));
  });
});

loadStatus().catch((error) => setAuthMessage(error.message || error));
