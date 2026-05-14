const ACCOUNT_ENDPOINT = "https://osccvepkxhmrfomtfgfj.supabase.co/functions/v1/mio-account";
const SESSION_KEY = "mio_account_session_v1";
const PLAN_PRICE = {
  1: 9900,
  3: 27900,
  6: 54900,
};
const ADMIN_EMAIL = "donggeonbae.16@gmail.com";
const ADMIN_PAGE_SIZE = 10;

let session = loadSession();
let accountState = null;
let adminState = {
  payments: [],
  accounts: [],
  paymentPage: 1,
  accountPage: 1,
  loaded: false,
};

const $ = (selector) => document.querySelector(selector);

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function paymentStatusLabel(value) {
  return {
    pending: "확인 대기",
    paid: "결제완료",
    cancel_requested: "취소요청",
    cancelled: "취소",
    refunded: "환불",
  }[value] || value || "-";
}

function providerLabel(value) {
  return {
    naverpay: "네이버페이",
    bank_transfer: "무통장 입금",
    smartstore: "스마트스토어",
    payment_link: "결제링크",
    manual: "관리자 등록",
  }[value] || value || "-";
}

function deviceTypeLabel(value) {
  return {
    pc: "PC",
    laptop: "노트북",
    mobile: "모바일",
    other: "기타",
  }[value] || value || "-";
}

function selectedPaymentProvider() {
  return "smartstore";
}

function selectedPaymentMonths() {
  return Number($("#payment-form")?.purchased_months?.value || 1);
}

function paymentOptions() {
  return accountState?.payment_options || {};
}

function paymentOption(provider) {
  return paymentOptions()[provider] || {};
}

function paymentDestinationUrl(provider, months = selectedPaymentMonths()) {
  const option = paymentOption(provider);
  const planUrls = option.plan_urls || {};
  return String(planUrls[String(months)] || option.url || "").trim();
}

function openPaymentDestination(url, existingPopup = null) {
  if (!url) return false;
  const popup = existingPopup || window.open("about:blank", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.location.href = url;
  popup.focus?.();
  return true;
}

function checkoutQueryPlan() {
  const params = new URLSearchParams(window.location.search);
  const plan = Number(params.get("plan") || params.get("months") || 0);
  return [1, 3, 6].includes(plan) ? plan : 0;
}

function applyCheckoutQueryDefaults() {
  const months = checkoutQueryPlan();
  const form = $("#payment-form");
  if (months && form?.purchased_months) form.purchased_months.value = String(months);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeDash(value) {
  const text = String(value ?? "").trim();
  return text ? escapeHtml(text) : "-";
}

function isAdminAccount(data = accountState) {
  const email = String(data?.user?.email || data?.profile?.email || "").trim().toLowerCase();
  return email === ADMIN_EMAIL;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(nextSession) {
  session = nextSession;
  if (session?.access_token) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function showMessage(message, isError = false) {
  const box = $("#message");
  box.textContent = message;
  box.hidden = false;
  box.classList.toggle("error", isError);
}

function clearMessage() {
  const box = $("#message");
  box.hidden = true;
  box.textContent = "";
  box.classList.remove("error");
}

function formDataObject(form) {
  const data = new FormData(form);
  const result = {};
  for (const [key, value] of data.entries()) result[key] = value;
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    result[input.name] = input.checked;
  }
  return result;
}

async function apiPost(action, payload = {}, requireAuth = false) {
  const headers = { "Content-Type": "application/json" };
  if (requireAuth && session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const response = await fetch(ACCOUNT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "요청 처리에 실패했습니다.");
  }
  if (data.session?.access_token) saveSession(data.session);
  return data;
}

async function refreshSessionIfNeeded() {
  if (!session?.refresh_token) return false;
  try {
    await apiPost("refresh", { refresh_token: session.refresh_token });
    return true;
  } catch {
    saveSession(null);
    return false;
  }
}

function renderAuthState() {
  const loggedIn = Boolean(session?.access_token && accountState);
  $("#auth-panel").hidden = loggedIn;
  $("#account-note").hidden = loggedIn;
  $("#dashboard").hidden = !loggedIn;
}

function renderProfile(profile = {}, user = {}) {
  $("#account-title").textContent = profile.display_name || user.email || "내 계정";
  const form = $("#profile-form");
  form.display_name.value = profile.display_name || "";
  form.company_name.value = profile.company_name || "";
  form.phone.value = profile.phone || "";
  form.marketing_opt_in.checked = Boolean(profile.marketing_opt_in);
}

function renderLicenses(licenses = []) {
  const target = $("#license-list");
  if (!licenses.length) {
    target.innerHTML = '<div class="empty">연결된 라이선스가 없습니다.</div>';
    return;
  }
  const rows = licenses.map((item) => {
    const license = item.license || {};
    return `<tr>
      <td>${escapeHtml(license.license_id)}</td>
      <td>${escapeHtml(license.licensee)}</td>
      <td>${escapeHtml(license.expires_at)}</td>
      <td>${license.is_active ? "활성" : "비활성"}</td>
      <td>${escapeHtml(item.linked_at || "")}</td>
    </tr>`;
  }).join("");
  target.innerHTML = `<table>
    <thead><tr><th>라이선스 ID</th><th>그룹/사용자</th><th>만료일</th><th>상태</th><th>연결일</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function setupReleaseDeviceButtons() {
  for (const button of document.querySelectorAll("[data-release-device]")) {
    button.addEventListener("click", async () => {
      clearMessage();
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const data = await apiPost("release_account_device", { device_record_id: button.dataset.releaseDevice }, true);
        renderAccount(data);
        showMessage(data.device_message || "계정 기기 등록을 해제했습니다.");
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }
}

function renderDevices(devices = [], limit = 3) {
  const target = $("#device-list");
  if (!target) return;
  if (!devices.length) {
    target.innerHTML = `<div class="empty">등록된 앱 기기가 없습니다.<br />프로그램 또는 모바일 앱에서 계정으로 로그인하면 기기가 등록됩니다.</div>`;
    return;
  }
  const rows = devices.map((device) => `<tr>
      <td>${escapeHtml(device.device_id || "")}</td>
      <td>${deviceTypeLabel(device.device_type)}</td>
      <td>${escapeHtml(device.platform || "")}</td>
      <td>${device.is_active ? "활성" : "해제됨"}</td>
      <td>${escapeHtml(device.last_seen_at || "")}</td>
      <td>${device.is_active ? `<button class="button ghost small" type="button" data-release-device="${escapeHtml(device.id)}">해제</button>` : escapeHtml(device.revoked_at || "")}</td>
    </tr>`).join("");
  target.innerHTML = `
    <p class="hint">프로그램 또는 모바일 앱에서 계정으로 로그인한 기기만 표시합니다. 홈페이지 브라우저 로그인은 포함하지 않습니다.</p>
    <table>
      <thead><tr><th>기기 ID</th><th>유형</th><th>플랫폼</th><th>상태</th><th>최근 사용</th><th>관리</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  setupReleaseDeviceButtons();
}

function renderSubscriptionSummary(subscription = {}) {
  const target = $("#subscription-summary");
  if (!target) return;
  const totalMonths = Number(subscription.total_paid_months || 0);
  const cancelableMonths = Number(subscription.cancelable_months || 0);
  const cancelDays = Number(subscription.cancel_request_days || paymentOptions().cancel_policy?.request_days || 7);
  if (!totalMonths) {
    target.innerHTML = '<div class="empty">결제완료 이용권이 아직 없습니다.</div>';
    return;
  }
  target.innerHTML = `
    <div class="subscription-grid">
      <div><strong>${escapeHtml(totalMonths)}개월</strong><span>총 결제 개월</span></div>
      <div><strong>${escapeHtml(subscription.active_until || "-")}</strong><span>합산 만료예정</span></div>
      <div><strong>${escapeHtml(cancelableMonths)}개월</strong><span>취소요청 가능</span></div>
    </div>
    <p class="hint">취소요청은 같은 계정에 결제완료 이용권이 2개 이상이고, 해당 이용권 기간이 아직 시작 전이며, 결제확인일로부터 ${escapeHtml(cancelDays)}일 이내일 때만 가능합니다. 실제 환불/매출취소는 스마트스토어 절차로 처리됩니다.</p>`;
}

function setupCancelPaymentButtons() {
  for (const button of document.querySelectorAll("[data-cancel-payment]")) {
    button.addEventListener("click", async () => {
      clearMessage();
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const data = await apiPost("request_payment_cancel", { payment_record_id: button.dataset.cancelPayment }, true);
        renderAccount(data);
        showMessage(data.payment_message || "취소요청을 등록했습니다.");
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }
}

function renderPayments(payments = [], subscription = {}) {
  const target = $("#payment-list");
  if (!payments.length) {
    target.innerHTML = '<div class="empty">결제내역이 없습니다. 결제 후 요청을 등록해 주세요.</div>';
    return;
  }
  const cancelableIds = new Set(subscription.cancelable_payment_ids || []);
  const rows = payments.map((payment) => `<tr>
      <td>${escapeHtml(payment.requested_at || "")}</td>
      <td>${paymentStatusLabel(payment.status)}</td>
      <td>${providerLabel(payment.provider)}</td>
      <td>${escapeHtml(payment.purchased_months || 1)}개월</td>
      <td>${formatKrw(payment.amount_krw)}</td>
      <td>${escapeHtml(payment.order_ref || "")}</td>
      <td>${escapeHtml(payment.license_id_text || "")}</td>
      <td>${escapeHtml(payment.paid_at || "")}</td>
      <td>${cancelableIds.has(payment.id) ? `<button class="button ghost small" type="button" data-cancel-payment="${escapeHtml(payment.id)}">취소요청</button>` : escapeHtml(payment.cancel_requested_at || "")}</td>
    </tr>`).join("");
  target.innerHTML = `<table>
    <thead><tr><th>요청일</th><th>상태</th><th>수단</th><th>기간</th><th>금액</th><th>주문/메모</th><th>라이선스</th><th>결제확인일</th><th>취소</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  setupCancelPaymentButtons();
}

function pageItems(items, page) {
  const total = Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE));
  const safePage = Math.min(total, Math.max(1, Number(page || 1)));
  const start = (safePage - 1) * ADMIN_PAGE_SIZE;
  return { total, safePage, rows: items.slice(start, start + ADMIN_PAGE_SIZE) };
}

function renderPagination(targetSelector, page, total, onPage) {
  const target = $(targetSelector);
  if (!target) return;
  if (total <= 1) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `
    <button class="button ghost small" type="button" data-page="prev">이전</button>
    <span class="hint">${escapeHtml(page)} / ${escapeHtml(total)}</span>
    <button class="button ghost small" type="button" data-page="next">다음</button>
  `;
  target.querySelector('[data-page="prev"]')?.addEventListener("click", () => onPage(page - 1));
  target.querySelector('[data-page="next"]')?.addEventListener("click", () => onPage(page + 1));
}

async function refreshAdminData() {
  if (!isAdminAccount()) {
    renderAdminPanel(false);
    return;
  }
  try {
    const [paymentData, accountData] = await Promise.all([
      apiPost("admin_list_payment_records", {}, true),
      apiPost("admin_list_account_profiles", {}, true),
    ]);
    adminState.payments = paymentData.payments || [];
    adminState.accounts = accountData.accounts || [];
    adminState.loaded = true;
    renderAdminPanel(true);
  } catch (error) {
    renderAdminPanel(true);
    showMessage(error.message || "관리자 정보를 불러오지 못했습니다.", true);
  }
}

function renderAdminPanel(visible = isAdminAccount()) {
  const panel = $("#admin-panel");
  if (!panel) return;
  panel.hidden = !visible;
  if (!visible) return;
  renderAdminPayments();
  renderAdminAccounts();
}

function renderAdminPayments() {
  const target = $("#admin-payment-list");
  if (!target) return;
  if (!adminState.loaded) {
    target.innerHTML = '<div class="empty">관리자 결제내역을 불러오는 중입니다.</div>';
    return;
  }
  if (!adminState.payments.length) {
    target.innerHTML = '<div class="empty">결제내역이 없습니다.</div>';
    renderPagination("#admin-payment-pagination", 1, 1, () => {});
    return;
  }
  const { total, safePage, rows } = pageItems(adminState.payments, adminState.paymentPage);
  adminState.paymentPage = safePage;
  const body = rows.map((payment) => {
    const profile = payment.profile || {};
    return `<tr>
      <td>${escapeDash(payment.requested_at)}</td>
      <td>${escapeDash(profile.email)}</td>
      <td>${escapeDash(profile.display_name)}</td>
      <td>${paymentStatusLabel(payment.status)}</td>
      <td>${escapeHtml(payment.purchased_months || 1)}개월</td>
      <td>${formatKrw(payment.amount_krw)}</td>
      <td>${escapeDash(payment.order_ref)}</td>
      <td>${escapeDash(payment.payer_name)}</td>
      <td>${escapeDash(payment.license_id_text)}</td>
      <td>
        <details>
          <summary>관리</summary>
          <form class="stack-form admin-payment-form" data-admin-payment="${escapeHtml(payment.id)}">
            <input name="status" value="${escapeHtml(payment.status || "pending")}" placeholder="pending/paid/cancelled/refunded" />
            <input name="purchased_months" value="${escapeHtml(payment.purchased_months || 1)}" placeholder="개월" />
            <input name="amount_krw" value="${escapeHtml(payment.amount_krw || PLAN_PRICE[payment.purchased_months] || PLAN_PRICE[1])}" placeholder="금액" />
            <input name="order_ref" value="${escapeHtml(payment.order_ref || "")}" placeholder="주문번호" />
            <input name="payer_name" value="${escapeHtml(payment.payer_name || "")}" placeholder="주문자명" />
            <input name="license_id_text" value="${escapeHtml(payment.license_id_text || "")}" placeholder="라이선스 ID(선택)" />
            <input name="admin_memo" value="${escapeHtml(payment.admin_memo || "")}" placeholder="관리자 메모" />
            <button class="button primary compact" type="submit">저장</button>
            <button class="button danger compact" type="button" data-admin-delete-payment="${escapeHtml(payment.id)}">삭제</button>
          </form>
        </details>
      </td>
    </tr>`;
  }).join("");
  target.innerHTML = `<table>
    <thead><tr><th>요청일</th><th>이메일</th><th>이름</th><th>상태</th><th>기간</th><th>금액</th><th>주문번호</th><th>주문자</th><th>라이선스</th><th>관리</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
  renderPagination("#admin-payment-pagination", safePage, total, (nextPage) => {
    adminState.paymentPage = nextPage;
    renderAdminPayments();
  });
  setupAdminPaymentControls();
}

function renderAdminAccounts() {
  const target = $("#admin-account-list");
  if (!target) return;
  if (!adminState.loaded) {
    target.innerHTML = '<div class="empty">관리자 계정 목록을 불러오는 중입니다.</div>';
    return;
  }
  if (!adminState.accounts.length) {
    target.innerHTML = '<div class="empty">계정이 없습니다.</div>';
    renderPagination("#admin-account-pagination", 1, 1, () => {});
    return;
  }
  const { total, safePage, rows } = pageItems(adminState.accounts, adminState.accountPage);
  adminState.accountPage = safePage;
  const body = rows.map((account) => `<tr>
      <td>${escapeDash(account.email)}</td>
      <td>${escapeDash(account.display_name)}</td>
      <td>${escapeDash(account.company_name)}</td>
      <td>${escapeDash(account.trial_expires_at)}</td>
      <td>${escapeDash(account.created_at)}</td>
      <td><button class="button danger small" type="button" data-admin-delete-account="${escapeHtml(account.user_id)}">계정 삭제</button></td>
    </tr>`).join("");
  target.innerHTML = `<table>
    <thead><tr><th>이메일</th><th>이름</th><th>회사/지점</th><th>체험 만료</th><th>가입일</th><th>관리</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
  renderPagination("#admin-account-pagination", safePage, total, (nextPage) => {
    adminState.accountPage = nextPage;
    renderAdminAccounts();
  });
  setupAdminAccountControls();
}

function setupAdminPaymentControls() {
  for (const form of document.querySelectorAll(".admin-payment-form")) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      const payload = formDataObject(form);
      payload.payment_record_id = form.dataset.adminPayment;
      payload.purchased_months = Number(payload.purchased_months || 1);
      payload.amount_krw = Number(payload.amount_krw || 0);
      try {
        const data = await apiPost("admin_update_payment_record", payload, true);
        showMessage(data.message || "결제내역을 저장했습니다.");
        await refreshAdminData();
        await loadAccount();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  }
  for (const button of document.querySelectorAll("[data-admin-delete-payment]")) {
    button.addEventListener("click", async () => {
      if (!confirm("이 결제내역을 삭제할까요? 연결된 이용권 만료일도 재계산됩니다.")) return;
      clearMessage();
      try {
        const data = await apiPost("admin_delete_payment_record", { payment_record_id: button.dataset.adminDeletePayment }, true);
        showMessage(data.message || "결제내역을 삭제했습니다.");
        await refreshAdminData();
        await loadAccount();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  }
}

function setupAdminAccountControls() {
  for (const button of document.querySelectorAll("[data-admin-delete-account]")) {
    button.addEventListener("click", async () => {
      if (!confirm("이 계정을 삭제할까요? 탈퇴 이력이 남아 같은 이메일 재가입이 차단됩니다.")) return;
      clearMessage();
      try {
        const data = await apiPost("admin_delete_account", { account_user_id: button.dataset.adminDeleteAccount }, true);
        showMessage(data.message || "계정을 삭제했습니다.");
        await refreshAdminData();
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  }
}

function renderPaymentInstructions() {
  const target = $("#payment-instructions");
  if (!target) return;
  const months = selectedPaymentMonths();
  const amount = PLAN_PRICE[months] || PLAN_PRICE[1];
  const smartstore = paymentOption("smartstore");
  const url = paymentDestinationUrl("smartstore", months);
  const autoVerify = Boolean(smartstore.auto_verify_available);
  target.innerHTML = `
    <div class="payment-summary">
      <strong>스마트스토어</strong>
      <span>${escapeHtml(months)}개월 · ${formatKrw(amount)} · VAT 포함</span>
    </div>
    ${url ? `<a class="button ghost full" id="smartstore-buy-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">구매 링크</a>` : '<div class="empty">구매 링크가 아직 서버에 설정되지 않았습니다. 관리자에게 문의해 주세요.</div>'}
    <p class="hint">구매 후 주문번호와 주문자명을 입력하면 서버가 네이버 커머스API로 결제완료 상태를 확인합니다. 결제 후 인증되지 않았거나 키 발급이 되지 않았을 경우 주문서를 캡처하여 support@mio.ai.kr로 보내 주세요.</p>
    ${autoVerify ? "" : '<div class="empty">자동 주문 확인 API가 아직 서버에 설정되지 않아 관리자 확인으로 처리될 수 있습니다.</div>'}`;
}

function renderIssuedLicense(data = {}) {
  const target = $("#issued-license-key");
  if (!target) return;
  const key = data.license_key || data.account_license_key || "";
  if (!key) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const accountKey = !data.license_key && data.account_license_key;
  target.hidden = false;
  target.innerHTML = `
    <p class="hint">${accountKey ? "현재 계정에 활성 라이선스가 연결되어 있습니다." : "라이선스가 자동 발급되었습니다."}</p>
    <div class="empty">라이선스 키는 화면에 표시하지 않습니다. 유료 라이선스 키는 가입 이메일로 발송됩니다. 이메일에서도 확인되지 않거나 프로그램 인증이 되지 않으면 주문서 캡처와 함께 support@mio.ai.kr로 문의해 주세요.</div>
  `;
}

function renderTrial(data = {}) {
  const target = $("#trial-info");
  const trial = data.trial || {};
  const key = data.trial_license_key || "";
  const expires = data.trial_expires_at || trial.expires_at || "";
  if (data.trial_error) {
    target.innerHTML = `<div class="empty">${escapeHtml(data.trial_error)}</div>`;
    return;
  }
  if (key) {
    target.innerHTML = `
      <p class="hint">이메일 인증 후 첫 로그인으로 3일 무료 체험 라이선스가 발급되었습니다. 프로그램에서 로그인하면 자동 등록됩니다.</p>
      <p class="hint">체험 만료: ${escapeHtml(expires)}</p>
    `;
    return;
  }
  if (trial.has_trial_license) {
    target.innerHTML = `<div class="empty">무료 체험 라이선스가 발급되어 있습니다.<br />체험 만료: ${escapeHtml(expires || "-")}</div>`;
    return;
  }
  target.innerHTML = '<div class="empty">이메일 인증 후 첫 로그인 시 3일 무료 체험 라이선스가 자동 발급됩니다.</div>';
}

function renderAccount(data) {
  accountState = data;
  renderAuthState();
  applyCheckoutQueryDefaults();
  renderProfile(data.profile, data.user);
  renderTrial(data);
  renderLicenses(data.licenses || []);
  renderDevices(data.devices || [], data.device_limit || 3);
  renderSubscriptionSummary(data.subscription || {});
  renderPayments(data.payments || [], data.subscription || {});
  renderPaymentInstructions();
  renderIssuedLicense(data);
  if (isAdminAccount(data)) {
    renderAdminPanel(true);
    if (!adminState.loaded) refreshAdminData();
  } else {
    adminState = { payments: [], accounts: [], paymentPage: 1, accountPage: 1, loaded: false };
    renderAdminPanel(false);
  }
}

async function loadAccount() {
  if (!session?.access_token) {
    renderAuthState();
    return;
  }
  try {
    const data = await apiPost("me", {}, true);
    renderAccount(data);
  } catch (error) {
    const refreshed = await refreshSessionIfNeeded();
    if (refreshed) {
      const data = await apiPost("me", {}, true);
      renderAccount(data);
      return;
    }
    saveSession(null);
    accountState = null;
    renderAuthState();
    showMessage(error.message || "로그인이 필요합니다.", true);
  }
}

function setupAuthTabs() {
  for (const tab of document.querySelectorAll("[data-auth-tab]")) {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.authTab;
      document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === tab));
      $("#login-form").hidden = mode !== "login";
      $("#signup-form").hidden = mode !== "signup";
      $("#find-email-form").hidden = mode !== "find-email";
      $("#reset-password-form").hidden = mode !== "reset-password";
      clearMessage();
    });
  }
}

function setupAdminTabs() {
  for (const tab of document.querySelectorAll("[data-admin-tab]")) {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.adminTab;
      document.querySelectorAll("[data-admin-tab]").forEach((item) => item.classList.toggle("active", item === tab));
      $("#admin-payments-panel").hidden = mode !== "payments";
      $("#admin-accounts-panel").hidden = mode !== "accounts";
    });
  }
}

function setupForms() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("login", formDataObject(form));
      renderAccount(data);
      showMessage("로그인되었습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const payload = formDataObject(form);
      if (payload.password !== payload.password_confirm) {
        showMessage("비밀번호와 비밀번호 확인이 일치하지 않습니다.", true);
        return;
      }
      delete payload.password_confirm;
      const email = payload.email;
      const data = await apiPost("signup", payload);
      form.reset();
      document.querySelector('[data-auth-tab="login"]')?.click();
      if ($("#login-form")?.email && email) $("#login-form").email.value = email;
      showMessage(data.message || "회원가입 신청이 완료되었습니다. 입력한 이메일함에서 MIO 인증 메일의 링크를 클릭하면 인증됩니다. 인증 후 로그인해 주세요.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#find-email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("find_email", formDataObject(form));
      const emails = data.emails || [];
      const target = $("#found-email-list");
      target.hidden = false;
      target.innerHTML = emails.length
        ? `가입 이메일: ${emails.map(escapeHtml).join(", ")}`
        : "일치하는 가입 이메일을 찾지 못했습니다.";
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#reset-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const payload = formDataObject(form);
      const email = payload.email;
      const data = await apiPost("request_password_reset", payload);
      form.reset();
      document.querySelector('[data-auth-tab="login"]')?.click();
      if ($("#login-form")?.email && email) $("#login-form").email.value = email;
      showMessage(data.message || "입력한 정보와 일치하는 계정이면 임시비밀번호를 발송했습니다. 메일로 받은 임시비밀번호를 로그인 비밀번호 칸에 입력해 주세요.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("update_profile", formDataObject(form), true);
      renderAccount(data);
      showMessage("계정 정보를 저장했습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  const paymentForm = $("#payment-form");
  paymentForm.purchased_months.addEventListener("change", renderPaymentInstructions);
  applyCheckoutQueryDefaults();
  paymentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    if (!session?.access_token) {
      showMessage("구매 등록은 로그인 후 이용할 수 있습니다.", true);
      return;
    }
    const form = event.currentTarget;
    const button = $("#smartstore-verify-button");
    try {
      const payload = formDataObject(form);
      payload.provider = "smartstore";
      payload.purchased_months = Number(payload.purchased_months || 1);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const data = await apiPost("create_payment_record", payload, true);
      renderAccount(data);
      if (data.license_key) {
        form.reset();
        showMessage(data.payment_message || "결제가 확인되어 라이선스가 자동 발급되었습니다.");
      } else {
        showMessage(data.payment_message || "구매내역을 등록했습니다. 관리자 확인 후 라이선스가 연결됩니다.");
      }
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });

  $("#license-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("link_license_key", formDataObject(form), true);
      form.reset();
      renderAccount(data);
      showMessage("라이선스를 계정에 연결했습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#change-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("change_password", formDataObject(form), true);
      form.reset();
      showMessage(data.message || "비밀번호를 변경했습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  const deleteAccountForm = $("#delete-account-form");
  if (deleteAccountForm) deleteAccountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    if (!session?.access_token) {
      showMessage("로그인이 필요합니다.", true);
      return;
    }
    const form = event.currentTarget;
    const payload = formDataObject(form);
    if (payload.confirm_text !== "계정삭제") {
      showMessage("삭제 확인 문구 `계정삭제`를 정확히 입력해 주세요.", true);
      return;
    }
    try {
      const data = await apiPost("delete_account", payload, true);
      form.reset();
      saveSession(null);
      accountState = null;
      adminState = { payments: [], accounts: [], paymentPage: 1, accountPage: 1, loaded: false };
      renderAuthState();
      renderAdminPanel(false);
      showMessage(data.message || "계정을 삭제했습니다. 같은 이메일로는 다시 가입할 수 없습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#logout-button").addEventListener("click", () => {
    saveSession(null);
    accountState = null;
    adminState = { payments: [], accounts: [], paymentPage: 1, accountPage: 1, loaded: false };
    renderAuthState();
    renderAdminPanel(false);
    showMessage("로그아웃되었습니다.");
  });
}

setupAuthTabs();
setupAdminTabs();
setupForms();
applyCheckoutQueryDefaults();
loadAccount();
