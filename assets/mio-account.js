const ACCOUNT_ENDPOINT = "https://osccvepkxhmrfomtfgfj.supabase.co/functions/v1/mio-account";
const SESSION_KEY = "mio_account_session_v1";
const PLAN_PRICE = {
  1: 9900,
  3: 27900,
  6: 54900,
};

let session = loadSession();
let accountState = null;

const $ = (selector) => document.querySelector(selector);

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function paymentStatusLabel(value) {
  return {
    pending: "확인 대기",
    paid: "결제완료",
    cancelled: "취소",
    refunded: "환불",
  }[value] || value || "-";
}

function providerLabel(value) {
  return {
    bank_transfer: "무통장 입금",
    smartstore: "스마트스토어",
    payment_link: "결제링크",
    manual: "관리자 등록",
  }[value] || value || "-";
}

function selectedPaymentProvider() {
  return $("#payment-form")?.provider?.value || "bank_transfer";
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

function naverpayAvailable() {
  return Boolean(paymentOptions().naverpay?.available);
}

function openNaverPayCheckout(checkout) {
  if (!checkout?.open_params) throw new Error("네이버페이 결제 준비 정보가 올바르지 않습니다.");
  if (!window.Naver?.Pay?.create) throw new Error("네이버페이 결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const pay = window.Naver.Pay.create({
    mode: checkout.mode || paymentOptions().naverpay?.mode || "production",
    payType: "normal",
    clientId: checkout.clientId,
    chainId: checkout.chainId,
    openType: "page",
  });
  pay.open(checkout.open_params);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function renderPayments(payments = []) {
  const target = $("#payment-list");
  if (!payments.length) {
    target.innerHTML = '<div class="empty">결제내역이 없습니다. 결제 후 요청을 등록해 주세요.</div>';
    return;
  }
  const rows = payments.map((payment) => `<tr>
      <td>${escapeHtml(payment.requested_at || "")}</td>
      <td>${paymentStatusLabel(payment.status)}</td>
      <td>${providerLabel(payment.provider)}</td>
      <td>${escapeHtml(payment.purchased_months || 1)}개월</td>
      <td>${formatKrw(payment.amount_krw)}</td>
      <td>${escapeHtml(payment.order_ref || "")}</td>
      <td>${escapeHtml(payment.license_id_text || "")}</td>
      <td>${escapeHtml(payment.paid_at || "")}</td>
    </tr>`).join("");
  target.innerHTML = `<table>
    <thead><tr><th>요청일</th><th>상태</th><th>수단</th><th>기간</th><th>금액</th><th>주문/메모</th><th>라이선스</th><th>결제확인일</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderPaymentInstructions() {
  const target = $("#payment-instructions");
  if (!target) return;
  const months = selectedPaymentMonths();
  const amount = PLAN_PRICE[months] || PLAN_PRICE[1];
  const available = naverpayAvailable();
  target.innerHTML = `
    <div class="payment-summary">
      <strong>네이버페이</strong>
      <span>${escapeHtml(months)}개월 · ${formatKrw(amount)} · VAT 포함</span>
    </div>
    <p class="hint">결제 완료 후 네이버페이 승인 결과가 돌아오면 서버가 결제금액을 검증하고 같은 계정에 라이선스를 자동 발급·연결합니다.</p>
    ${available ? "" : '<div class="empty">네이버페이 API 키가 아직 서버에 설정되지 않았습니다. 관리자에게 문의해 주세요.</div>'}`;
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
      <p class="hint">이메일 인증 후 첫 로그인으로 3일 무료 체험 라이선스가 발급되었습니다. 이 키는 다시 표시되지 않을 수 있으니 지금 복사해 주세요.</p>
      <textarea class="trial-key" readonly>${escapeHtml(key)}</textarea>
      <button class="button ghost full" type="button" id="copy-trial-key">체험 라이선스 키 복사</button>
      <p class="hint">체험 만료: ${escapeHtml(expires)}</p>
    `;
    $("#copy-trial-key")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(key);
        showMessage("체험 라이선스 키를 복사했습니다.");
      } catch {
        showMessage("자동 복사에 실패했습니다. 키 영역에서 직접 복사해 주세요.", true);
      }
    });
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
  renderPayments(data.payments || []);
  renderPaymentInstructions();
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
      $("#resend-verification-form").hidden = mode !== "reset-password";
      clearMessage();
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
      showMessage(data.message || "회원가입 신청이 완료되었습니다. 이메일 인증 후 로그인해 주세요.");
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
      showMessage(data.message || "가입된 이메일이면 임시비밀번호를 발송했습니다. 메일로 받은 임시비밀번호를 로그인 비밀번호 칸에 입력해 주세요.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#resend-verification-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      const data = await apiPost("resend_verification", formDataObject(form));
      showMessage(data.message || "가입된 이메일이면 인증 메일을 다시 보냈습니다.");
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
      showMessage("네이버페이 구매는 로그인 후 이용할 수 있습니다.", true);
      return;
    }
    if (!naverpayAvailable()) {
      showMessage("네이버페이 API 키가 아직 서버에 설정되지 않았습니다. 관리자에게 문의해 주세요.", true);
      return;
    }
    const form = event.currentTarget;
    const button = $("#naverpay-checkout-button");
    try {
      const payload = formDataObject(form);
      payload.purchased_months = Number(payload.purchased_months || 1);
      button.disabled = true;
      button.textContent = "네이버페이 결제 준비 중...";
      const data = await apiPost("create_naverpay_checkout", payload, true);
      renderAccount(data);
      showMessage("네이버페이 결제창으로 이동합니다.");
      openNaverPayCheckout(data.naverpay);
    } catch (error) {
      showMessage(error.message, true);
      button.disabled = false;
      button.textContent = "네이버페이로 바로 구매";
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

  $("#logout-button").addEventListener("click", () => {
    saveSession(null);
    accountState = null;
    renderAuthState();
    showMessage("로그아웃되었습니다.");
  });
}

setupAuthTabs();
setupForms();
applyCheckoutQueryDefaults();
loadAccount();
