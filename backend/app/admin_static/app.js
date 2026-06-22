const tokenKey = "dayneko-admin-token";
let token = localStorage.getItem(tokenKey) || "";
let configured = false;
let activeView = "overview";
let recordCache = new Map();

const pageState = {
  users: { limit: 50, offset: 0, total: 0 },
  records: { limit: 50, offset: 0, total: 0 },
  requests: { limit: 50, offset: 0, total: 0 }
};

const $ = (selector) => document.querySelector(selector);

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
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
    ["媒体", `${summary.mediaAssets ?? 0} / ${formatBytes(summary.mediaBytes)}`],
    ["好友申请", summary.friendRequests]
  ].map(([label, value]) => `
    <article class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");

  $("#kindList").innerHTML = (summary.recordsByKind || []).map((item) => `
    <article class="kind-row">
      <strong>${escapeHtml(item.kind)}</strong>
      <span>${escapeHtml(item.count)}</span>
    </article>
  `).join("") || `<p class="empty">暂无记录。</p>`;
}

function rowButton(label, className = "", action = "") {
  return `<button class="${className}" type="button" ${action ? `data-action="${action}"` : ""}>${escapeHtml(label)}</button>`;
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
    <article class="row admin-user-row" data-user-id="${escapeHtml(user.id)}">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.handle)} · ${escapeHtml(user.id)}</small>
      </div>
      <div class="inline-edit">
        <input data-field="name" value="${escapeHtml(user.name)}" aria-label="昵称" />
        <input data-field="handle" value="${escapeHtml(user.handle)}" aria-label="handle" />
      </div>
      <div>
        <small>记录 ${escapeHtml(user.record_count || 0)}</small>
        <small>${escapeHtml(user.updated_at || "")}</small>
      </div>
      <div class="row-actions">
        ${rowButton("保存", "soft", "save-user")}
        ${rowButton("删除", "danger", "delete-user")}
      </div>
    </article>
  `).join("") || `<p class="empty">没有找到用户。</p>`;
}

function recordSummary(record) {
  const payload = record.payload || {};
  const title = payload.title || payload.label || payload.name || payload.handle || record.kind;
  const detail = payload.date || payload.startedAt || payload.updatedAt || record.updatedAt || "";
  return { title, detail };
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
  recordCache = new Map(data.items.map((record) => [record.id, record]));
  setPager("records", data);
  $("#recordsTable").innerHTML = data.items.map((record) => {
    const summary = recordSummary(record);
    return `
      <article class="row three" data-record-id="${escapeHtml(record.id)}">
        <div>
          <strong>${escapeHtml(record.kind)} · ${escapeHtml(summary.title)}</strong>
          <small>${escapeHtml(record.id)} · ${escapeHtml(record.userId)}</small>
          <small>${escapeHtml(summary.detail)}</small>
        </div>
        <textarea class="record-editor" spellcheck="false" aria-label="编辑记录 JSON">${escapeHtml(JSON.stringify(record.payload, null, 2))}</textarea>
        <div class="row-actions">
          ${rowButton("保存", "soft", "save-record")}
          ${rowButton("删除", "danger", "delete-record")}
        </div>
      </article>
    `;
  }).join("") || `<p class="empty">没有找到记录。</p>`;
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
    <article class="row three" data-request-id="${escapeHtml(request.id)}">
      <div>
        <strong>${escapeHtml(request.status)}</strong>
        <small>${escapeHtml(request.id)}</small>
      </div>
      <div>
        <small>from ${escapeHtml(request.from_user_id)}</small>
        <small>to ${escapeHtml(request.to_user_id)}</small>
      </div>
      <div class="request-actions">
        <select data-action="request-status" aria-label="申请状态">
          ${["pending", "accepted", "rejected"].map((status) => `<option value="${status}" ${request.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        ${rowButton("删除", "danger", "delete-request")}
      </div>
    </article>
  `).join("") || `<p class="empty">暂无好友申请。</p>`;
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

function dateTimeFilterValue(id, endOfDay = false) {
  const value = $(id).value;
  if (!value) return "";
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+00:00`;
}

function openRecordEditor(record) {
  $("#modalTitle").textContent = `编辑记录：${record.kind}`;
  $("#modalHint").textContent = `${record.id} · ${record.userId}`;
  $("#modalTextarea").value = JSON.stringify(record.payload, null, 2);
  $("#modal").dataset.recordId = record.id;
  $("#modal").classList.add("open");
}

function closeRecordEditor() {
  $("#modal").classList.remove("open");
  $("#modal").dataset.recordId = "";
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

$("#usersTable").addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const row = event.target.closest("[data-user-id]");
  const id = row.dataset.userId;
  if (action === "save-user") {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const handle = row.querySelector('[data-field="handle"]').value.trim();
    await api(`/admin/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, handle })
    });
    await refresh();
  }
  if (action === "delete-user") {
    if (!confirm(`确认删除用户 ${id} 以及关联记录、好友关系、好友申请和媒体文件吗？`)) return;
    await api(`/admin/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }
});

$("#recordsTable").addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const row = event.target.closest("[data-record-id]");
  const id = row.dataset.recordId;
  if (action === "save-record") {
    let payload;
    try {
      payload = JSON.parse(row.querySelector(".record-editor").value);
    } catch {
      alert("JSON 格式不正确。");
      return;
    }
    await api(`/admin/api/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ payload })
    });
    await refresh();
  }
  if (action === "delete-record") {
    if (!confirm(`确认删除记录 ${id} 及其关联媒体文件吗？`)) return;
    await api(`/admin/api/records/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }
});

$("#requestsTable").addEventListener("change", async (event) => {
  if (event.target.dataset.action !== "request-status") return;
  const row = event.target.closest("[data-request-id]");
  const id = row.dataset.requestId;
  await api(`/admin/api/friend-requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: event.target.value })
  });
  await refresh();
});

$("#requestsTable").addEventListener("click", async (event) => {
  if (event.target.dataset.action !== "delete-request") return;
  const row = event.target.closest("[data-request-id]");
  const id = row.dataset.requestId;
  if (!confirm(`确认删除申请 ${id} 吗？`)) return;
  await api(`/admin/api/friend-requests/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refresh();
});

$("#modalClose").addEventListener("click", closeRecordEditor);
$("#modalCancel").addEventListener("click", closeRecordEditor);
$("#modalSave").addEventListener("click", async () => {
  const id = $("#modal").dataset.recordId;
  let payload;
  try {
    payload = JSON.parse($("#modalTextarea").value);
  } catch {
    alert("JSON 格式不正确。");
    return;
  }
  await api(`/admin/api/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ payload })
  });
  closeRecordEditor();
  await refresh();
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
