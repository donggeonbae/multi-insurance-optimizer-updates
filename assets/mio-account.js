const ACCOUNT_ENDPOINT = "https://osccvepkxhmrfomtfgfj.supabase.co/functions/v1/mio-account";
const SUPABASE_PROJECT_URL = "https://osccvepkxhmrfomtfgfj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_6mCr5tiS8IfI6BuXnok9hw_TIDHYUKf";
const SUPABASE_AUTH_STORAGE_KEY = "mio_supabase_social_session_v1";
const SESSION_KEY = "mio_account_session_v1";
const REMEMBER_EMAIL_KEY = "mio_account_remembered_email_v1";
const PLAN_PRICE = {
  1: 9900,
  3: 27900,
  6: 54900,
};
const PLAN_BASE_PRICE_PER_MONTH = 9900;

let session = loadSession();
let accountState = null;
let supabaseAuthClient = null;
let socialProviderAvailability = null;

const $ = (selector) => document.querySelector(selector);

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function planBasePrice(months) {
  return PLAN_BASE_PRICE_PER_MONTH * Number(months || 1);
}

function planDiscountRate(months) {
  const base = planBasePrice(months);
  const sale = PLAN_PRICE[months] || PLAN_PRICE[1];
  if (!base || sale >= base) return 0;
  return Math.round(((base - sale) / base) * 100);
}

function planPriceLabel(months) {
  const base = planBasePrice(months);
  const sale = PLAN_PRICE[months] || PLAN_PRICE[1];
  const discount = planDiscountRate(months);
  if (!discount) return `${months}개월 · ${formatKrw(sale)}`;
  return `${months}개월 · ${formatKrw(base)} → ${formatKrw(sale)} · ${discount}% 할인`;
}

function paymentStatusLabel(value) {
  return {
    pending: "등록 오류",
    paid: "결제완료",
    cancel_requested: "취소요청",
    cancelled: "취소",
    refunded: "환불",
  }[value] || value || "-";
}

function dateLabel(value) {
  return String(value || "").slice(0, 10) || "-";
}

function cancelDoneLabel(payment = {}) {
  const status = String(payment.status || "");
  if (["cancelled", "refunded"].includes(status)) return "완료";
  if (status === "cancel_requested") return "처리중";
  return "-";
}

function trialActive(expires) {
  const time = Date.parse(String(expires || ""));
  return Number.isFinite(time) && time >= Date.now();
}

function providerLabel(value) {
  return {
    kakaopay: "카카오페이",
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
    mobile: "모바일",
  }[value] || "PC";
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

function checkoutQueryProvider() {
  const params = new URLSearchParams(window.location.search);
  const provider = (params.get("payment_provider") || params.get("provider") || "").toLowerCase();
  return ["smartstore", "kakaopay"].includes(provider) ? provider : "";
}

function externalTransactionTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("external_transaction_token") || params.get("google_external_transaction_token") || "").trim();
}

function applyExternalTransactionToken(payload) {
  const token = externalTransactionTokenFromQuery();
  if (!token) return payload;
  payload.external_transaction_token = token;
  payload.google_external_transaction_token = token;
  payload.external_payment_platform = "google_play";
  return payload;
}

function applyCheckoutQueryDefaults() {
  const months = checkoutQueryPlan();
  const form = $("#payment-form");
  if (months) setFormValue(form, "purchased_months", String(months));
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

function socialAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  const createClient = window.supabase?.createClient;
  if (!createClient) return null;
  supabaseAuthClient = createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return supabaseAuthClient;
}

function currentCleanAuthUrl({ keepAppRedirect = true } = {}) {
  const url = new URL(window.location.href);
  url.hash = "";
  for (const key of ["code", "error", "error_code", "error_description", "social", "social_provider"]) {
    url.searchParams.delete(key);
  }
  if (!keepAppRedirect) url.searchParams.delete("app_redirect");
  return url.toString();
}

function requestedSocialProvider() {
  const value = new URLSearchParams(window.location.search).get("social_provider") || "";
  if (["google", "kakao", "custom:naver"].includes(value)) return value;
  if (value === "naver") return "custom:naver";
  return "";
}

function oauthProviderLabel(provider) {
  return {
    google: "Google",
    kakao: "카카오",
    "custom:naver": "네이버",
  }[provider] || provider || "소셜";
}

function normalizeSocialProvider(provider = "") {
  return provider === "naver" ? "custom:naver" : provider;
}

function isNaverSocialProvider(provider = "") {
  return normalizeSocialProvider(provider) === "custom:naver";
}

function naverSocialBridgeStartUrl(redirectUrl) {
  const url = new URL(`${ACCOUNT_ENDPOINT}/social/naver/start`);
  url.searchParams.set("redirect_to", redirectUrl.toString());
  return url.toString();
}

function providerDisabledMessage(provider) {
  return `${oauthProviderLabel(provider)} 로그인은 관리자 콘솔 설정이 완료된 뒤 사용할 수 있습니다. 이메일 로그인 또는 인증메일 회원가입을 이용해 주세요.`;
}

function isSocialProviderDisabled(provider) {
  const normalizedProvider = normalizeSocialProvider(provider);
  return socialProviderAvailability && socialProviderAvailability[normalizedProvider] === false;
}

function applySocialProviderAvailability() {
  for (const button of document.querySelectorAll("[data-oauth-provider]")) {
    const provider = normalizeSocialProvider(button.dataset.oauthProvider || "");
    const disabled = isSocialProviderDisabled(provider);
    button.disabled = disabled;
    button.classList.toggle("disabled", disabled);
    button.title = disabled ? providerDisabledMessage(provider) : "";
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
  }
  renderSocialProviderStatus();
}

function socialProviderStateLabel(provider) {
  const normalizedProvider = normalizeSocialProvider(provider);
  if (!socialProviderAvailability) {
    return `${oauthProviderLabel(normalizedProvider)} 확인 중`;
  }
  if (socialProviderAvailability[normalizedProvider] === undefined) {
    return `${oauthProviderLabel(normalizedProvider)} 설정 확인 필요`;
  }
  return socialProviderAvailability[normalizedProvider]
    ? `${oauthProviderLabel(normalizedProvider)} 사용 가능`
    : `${oauthProviderLabel(normalizedProvider)} 준비 중`;
}

function renderSocialProviderStatus() {
  const box = $("#social-provider-status");
  if (!box) return;
  const providers = ["google", "kakao", "custom:naver"];
  const hasUnavailable = Boolean(socialProviderAvailability) && providers.some((provider) => socialProviderAvailability[provider] !== true);
  box.hidden = !hasUnavailable;
  box.classList.toggle("warning", hasUnavailable);
  box.textContent = hasUnavailable ? providers.map(socialProviderStateLabel).join(" · ") : "";
}

async function refreshSocialProviderAvailability() {
  const availability = {};
  try {
    const response = await fetch(`${SUPABASE_PROJECT_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (response.ok) {
      const settings = await response.json();
      const external = settings?.external || {};
      availability.google = Boolean(external.google);
      availability.kakao = Boolean(external.kakao);
      if (Object.prototype.hasOwnProperty.call(external, "custom:naver") || Object.prototype.hasOwnProperty.call(external, "naver")) {
        availability["custom:naver"] = Boolean(external["custom:naver"] || external.naver);
      }
    }
  } catch {
    // Supabase settings are advisory. Keep buttons enabled unless a provider is
    // explicitly reported as disabled by a reachable source.
  }
  try {
    const socialResponse = await fetch(`${ACCOUNT_ENDPOINT}/social/status`);
    if (socialResponse.ok) {
      const socialStatus = await socialResponse.json();
      const providers = socialStatus?.providers || {};
      if (Object.prototype.hasOwnProperty.call(providers, "custom:naver") || Object.prototype.hasOwnProperty.call(providers, "naver")) {
        availability["custom:naver"] = Boolean(providers["custom:naver"] || providers.naver);
      }
    }
  } catch {
    // Naver bridge status is advisory; the bridge start endpoint will surface
    // provider-specific failures if it becomes unavailable.
  }
  socialProviderAvailability = Object.keys(availability).length ? availability : null;
  applySocialProviderAvailability();
}

function allowedAppRedirectUrl(rawValue = "") {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const isLocalLoopback = ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "localhost"].includes(url.hostname)
      && url.pathname === "/callback";
    const isMioScheme = url.protocol === "mio:" && url.hostname === "auth" && url.pathname === "/callback";
    return (isLocalLoopback || isMioScheme) ? url.toString() : "";
  } catch {
    return "";
  }
}

function requestedAppRedirectUrl() {
  return allowedAppRedirectUrl(new URLSearchParams(window.location.search).get("app_redirect") || "");
}

function hasOAuthReturnPayload() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  return Boolean(
    url.searchParams.get("code")
      || url.searchParams.get("error")
      || hash.get("access_token")
      || hash.get("error"),
  );
}

function oauthReturnErrorMessage() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const message = url.searchParams.get("error_description") || hash.get("error_description");
  const code = url.searchParams.get("error") || hash.get("error");
  if (!message && !code) return "";
  return message || `소셜 로그인에 실패했습니다: ${code}`;
}

function publicSessionFromSupabaseSession(authSession) {
  return {
    access_token: authSession?.access_token || "",
    refresh_token: authSession?.refresh_token || "",
    expires_in: authSession?.expires_in || 0,
    expires_at: authSession?.expires_at || 0,
    token_type: authSession?.token_type || "bearer",
    user: authSession?.user || null,
  };
}

function sessionFromUrlFragment() {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const accessToken = (hash.get("access_token") || "").trim();
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    refresh_token: hash.get("refresh_token") || "",
    expires_in: hash.get("expires_in") || 0,
    expires_at: hash.get("expires_at") || 0,
    token_type: hash.get("token_type") || "bearer",
    user: null,
  };
}

async function adoptSocialAuthSessionFromUrl() {
  const client = socialAuthClient();
  if (!client) return false;
  const errorMessage = oauthReturnErrorMessage();
  if (errorMessage) {
    window.history.replaceState({}, document.title, currentCleanAuthUrl());
    showMessage(errorMessage, true);
    return false;
  }
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      window.history.replaceState({}, document.title, currentCleanAuthUrl());
      showMessage(error.message || "소셜 로그인 세션을 확인하지 못했습니다.", true);
      return false;
    }
  }
  const { data, error } = await client.auth.getSession();
  const authSession = data?.session;
  const publicSession = authSession?.access_token
    ? publicSessionFromSupabaseSession(authSession)
    : sessionFromUrlFragment();
  if (error && !publicSession?.access_token) return false;
  if (!publicSession?.access_token) return false;
  saveSession(publicSession);
  if (code || window.location.hash.includes("access_token")) {
    window.history.replaceState({}, document.title, currentCleanAuthUrl());
  }
  return true;
}

async function startSocialLogin(provider) {
  const normalizedProvider = normalizeSocialProvider(provider);
  if (isSocialProviderDisabled(normalizedProvider)) {
    showMessage(providerDisabledMessage(normalizedProvider), true);
    return;
  }
  const redirectUrl = new URL(`${window.location.origin}/account.html`);
  redirectUrl.searchParams.set("social", "1");
  redirectUrl.searchParams.set("social_provider", normalizedProvider);
  const appRedirect = requestedAppRedirectUrl();
  if (appRedirect) redirectUrl.searchParams.set("app_redirect", appRedirect);
  const appState = new URLSearchParams(window.location.search).get("state") || "";
  if (appState) redirectUrl.searchParams.set("state", appState);
  if (isNaverSocialProvider(normalizedProvider)) {
    window.location.assign(naverSocialBridgeStartUrl(redirectUrl));
    return;
  }
  const client = socialAuthClient();
  if (!client) {
    showMessage("소셜 로그인 스크립트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
    return;
  }
  const { error } = await client.auth.signInWithOAuth({
    provider: normalizedProvider,
    options: { redirectTo: redirectUrl.toString() },
  });
  if (error) {
    const message = /provider is not enabled|unsupported provider/i.test(error.message || "")
      ? providerDisabledMessage(normalizedProvider)
      : (error.message || "소셜 로그인을 시작하지 못했습니다.");
    showMessage(message, true);
  }
}

async function maybeAutoStartSocialLoginFromUrl() {
  const provider = requestedSocialProvider();
  if (!provider || hasOAuthReturnPayload()) return false;
  showMessage(`${oauthProviderLabel(provider)} 로그인 페이지로 이동합니다...`);
  await startSocialLogin(provider);
  return true;
}

function appRedirectWithSessionUrl(appRedirect, authSession) {
  const url = new URL(appRedirect);
  const fragment = new URLSearchParams();
  fragment.set("access_token", authSession?.access_token || "");
  fragment.set("refresh_token", authSession?.refresh_token || "");
  fragment.set("expires_at", String(authSession?.expires_at || ""));
  fragment.set("expires_in", String(authSession?.expires_in || ""));
  fragment.set("token_type", authSession?.token_type || "bearer");
  fragment.set("provider", requestedSocialProvider() || "social");
  fragment.set("state", new URLSearchParams(window.location.search).get("state") || "");
  url.hash = fragment.toString();
  return url.toString();
}

function maybeReturnSessionToApp() {
  const appRedirect = requestedAppRedirectUrl();
  if (!appRedirect || !session?.access_token) return false;
  const url = appRedirectWithSessionUrl(appRedirect, session);
  showMessage("소셜 로그인이 완료되었습니다. 앱으로 돌아갑니다...");
  window.location.replace(url);
  return true;
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

function formField(formOrSelector, name) {
  const form = typeof formOrSelector === "string" ? $(formOrSelector) : formOrSelector;
  return form?.elements?.namedItem(name) || null;
}

function setFormValue(formOrSelector, name, value) {
  const field = formField(formOrSelector, name);
  if (field) field.value = value;
}

function setFormChecked(formOrSelector, name, value) {
  const field = formField(formOrSelector, name);
  if (field) field.checked = Boolean(value);
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
  const accountNote = $("#account-note");
  if (accountNote) accountNote.hidden = loggedIn;
  $("#dashboard").hidden = !loggedIn;
  const accountStepsStrip = $("#account-steps-strip");
  if (accountStepsStrip) accountStepsStrip.hidden = loggedIn;
}

function renderProfile(profile = {}, user = {}) {
  $("#account-title").textContent = profile.display_name || user.email || "내 계정";
  const form = $("#profile-form");
  setFormValue(form, "display_name", profile.display_name || "");
  setFormValue(form, "company_name", profile.company_name || "");
  setFormChecked(form, "marketing_opt_in", profile.marketing_opt_in);
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

function renderDevices(devices = [], limits = {}) {
  const target = $("#device-list");
  if (!target) return;
  const pcLimit = Number(limits.pc || 2);
  const mobileLimit = Number(limits.mobile || 1);
  if (!devices.length) {
    target.innerHTML = `<div class="empty">등록된 앱 기기가 없습니다.<br />프로그램 또는 모바일 앱에서 계정으로 로그인하면 기기가 등록됩니다.<br />계정당 PC 최대 ${pcLimit}대, 모바일 최대 ${mobileLimit}대까지 등록할 수 있습니다.</div>`;
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
    <p class="hint">프로그램 또는 모바일 앱에서 계정으로 로그인한 기기만 표시합니다. 홈페이지 브라우저 로그인은 포함하지 않습니다. 계정당 PC 최대 ${pcLimit}대, 모바일 최대 ${mobileLimit}대까지 등록할 수 있습니다.</p>
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
    <p class="hint">취소는 아직 시작 전인 추가 이용권만 신청할 수 있습니다. 결제완료 이용권이 2개 이상이고 결제확인 후 ${escapeHtml(cancelDays)}일 이내일 때 가능합니다.</p>`;
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
      <td>${escapeHtml(dateLabel(payment.requested_at))}</td>
      <td>${paymentStatusLabel(payment.status)}</td>
      <td>${providerLabel(payment.provider)}</td>
      <td>${escapeHtml(payment.purchased_months || 1)}개월</td>
      <td>${formatKrw(payment.amount_krw)}</td>
      <td>${escapeHtml(payment.order_ref || "")}</td>
      <td>${escapeHtml(payment.license_id_text || "")}</td>
      <td>${escapeHtml(dateLabel(payment.paid_at || payment.confirmed_at))}</td>
      <td>${escapeHtml(dateLabel(payment.cancel_requested_at))}</td>
      <td>${escapeHtml(cancelDoneLabel(payment))}</td>
      <td>${cancelableIds.has(payment.id) ? `<button class="button ghost small" type="button" data-cancel-payment="${escapeHtml(payment.id)}">취소요청</button>` : "-"}</td>
    </tr>`).join("");
  target.innerHTML = `<table>
    <thead><tr><th>요청일</th><th>상태</th><th>수단</th><th>기간</th><th>금액</th><th>주문/메모</th><th>라이선스</th><th>결제확인일</th><th>취소신청일</th><th>취소처리</th><th>관리</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  setupCancelPaymentButtons();
}

function renderPaymentInstructions() {
  const target = $("#payment-instructions");
  if (!target) return;
  const months = selectedPaymentMonths();
  const requestedProvider = checkoutQueryProvider();
  const orderGroup = $("#payment-order-group");
  const payerGroup = $("#payment-payer-group");
  const orderInput = $("#payment-form")?.order_ref;
  const payerInput = $("#payment-form")?.payer_name;
  const submitButton = $("#payment-submit-button");
  if (orderGroup && payerGroup && orderInput && payerInput) {
    orderGroup.hidden = false;
    payerGroup.hidden = false;
    orderInput.required = true;
    payerInput.required = true;
    orderInput.disabled = false;
    payerInput.disabled = false;
  }
  if (submitButton) submitButton.textContent = "주문번호 확인 및 이용권 발급";

  const smartstore = paymentOption("smartstore");
  const naverUrl = paymentDestinationUrl("smartstore", months);
  const autoVerify = Boolean(smartstore.auto_verify_available);
  const kakaoPay = paymentOption("kakaopay");
  const kakaoAvailable = Boolean(kakaoPay.checkout_available || kakaoPay.available);
  const kakaoButton = $("#kakaopay-checkout-button");
  if (kakaoButton) {
    kakaoButton.disabled = false;
    kakaoButton.classList.remove("disabled");
    kakaoButton.classList.toggle("recommended", requestedProvider === "kakaopay");
    kakaoButton.title = kakaoAvailable
      ? "카카오페이 / 바로 결제: 결제 완료 후 같은 계정에 이용권이 자동 발급됩니다."
      : "카카오페이 결제창은 서버 Secret Key 설정 완료 후 열립니다.";
  }
  const naverLink = $("#naverpay-buy-link");
  if (naverLink) {
    naverLink.href = naverUrl || "#";
    naverLink.classList.toggle("disabled", !naverUrl);
    naverLink.classList.toggle("recommended", requestedProvider === "smartstore");
    naverLink.setAttribute("aria-disabled", naverUrl ? "false" : "true");
    naverLink.title = naverUrl
      ? "네이버페이는 구매 후 주문번호와 주문자명을 아래에 등록해야 이용권이 발급됩니다."
      : "네이버페이 구매 페이지가 아직 서버에 설정되지 않았습니다.";
  }

  target.innerHTML = `
    <div class="payment-summary">
      <strong>이용권</strong>
      <span>${escapeHtml(planPriceLabel(months))} · VAT 포함</span>
    </div>
    <div class="payment-flow-cards account-payment-flow">
      <article class="${requestedProvider === "kakaopay" ? "active" : ""}">
        <strong>카카오페이</strong>
        <p>아래 카카오페이 버튼을 누르면 결제창이 바로 열리고, 승인 완료 후 같은 계정에 이용권이 자동 연결됩니다.</p>
      </article>
      <article class="${requestedProvider === "smartstore" ? "active" : ""}">
        <strong>네이버페이</strong>
        <p>네이버페이 구매 페이지에서 결제한 뒤 주문번호와 주문자명을 이 화면에 등록해야 이용권이 발급됩니다.</p>
      </article>
    </div>
    <p class="hint">디지털 소프트웨어 이용권 상품으로 배송지 입력은 없으며, 서비스 제공기간은 선택한 ${escapeHtml(months)}개월입니다.</p>
    <p class="hint">취소 가능 여부와 처리상태는 결제내역에서 확인할 수 있습니다.</p>
    ${autoVerify ? "" : '<div class="empty">자동 주문 확인 API가 연결되지 않으면 구매 등록은 저장되지 않습니다. 잠시 후 다시 시도하거나 support@mio.ai.kr로 문의해 주세요.</div>'}
    ${kakaoAvailable ? "" : '<div class="empty">카카오페이 가맹점 CID는 발급되어 있습니다. 서버 Secret Key 설정이 완료되면 계정 페이지에서 바로 결제하고 같은 계정에 이용권이 자동 발급됩니다.</div>'}`;
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
    <div class="empty">라이선스 키는 화면에 표시하지 않습니다. 유료 라이선스 키는 가입 이메일로 발송됩니다. 프로그램에서 같은 계정으로 로그인하면 자동 인증됩니다. 자동 인증이 되지 않으면 이메일의 라이선스 키를 이 페이지의 '라이선스 연결' 칸에 붙여넣어 연결해 주세요. 이메일에서도 확인되지 않으면 주문서 캡처와 함께 support@mio.ai.kr로 문의해 주세요.</div>
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
    if (expires && !trialActive(expires)) {
      target.innerHTML = `<div class="empty">무료 체험이 만료되었습니다.<br />체험 만료: ${escapeHtml(expires)}</div>`;
      return;
    }
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
  renderDevices(data.devices || [], { pc: data.pc_device_limit || 2, mobile: data.mobile_device_limit || 1 });
  renderSubscriptionSummary(data.subscription || {});
  renderPayments(data.payments || [], data.subscription || {});
  renderPaymentInstructions();
  renderIssuedLicense(data);
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

function cleanKakaoPayReturnUrl() {
  const url = new URL(window.location.href);
  for (const key of ["kakaopay_result", "partner_order_id", "pg_token"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, document.title, url.toString());
}

async function handleKakaoPayReturn() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("kakaopay_result");
  if (!result) return false;
  const partnerOrderId = params.get("partner_order_id") || "";
  const pgToken = params.get("pg_token") || "";
  try {
    if (result === "cancel") {
      showMessage("카카오페이 결제가 취소되었습니다.", true);
      return true;
    }
    if (result === "fail") {
      showMessage("카카오페이 결제가 완료되지 않았습니다. 다시 시도해 주세요.", true);
      return true;
    }
    if (result !== "approve") return false;
    if (!session?.access_token) {
      showMessage("카카오페이 결제 승인을 마무리하려면 먼저 같은 계정으로 로그인해 주세요.", true);
      return true;
    }
    if (!partnerOrderId || !pgToken) {
      showMessage("카카오페이 승인 정보가 부족합니다. 다시 결제해 주세요.", true);
      return true;
    }
    const data = await apiPost("approve_kakaopay_checkout", {
      partner_order_id: partnerOrderId,
      pg_token: pgToken,
    }, true);
    renderAccount(data);
    showMessage(data.payment_message || "카카오페이 결제가 확인되어 라이선스가 자동 발급되었습니다.");
    return true;
  } catch (error) {
    showMessage(error.message || "카카오페이 결제 승인 중 오류가 발생했습니다.", true);
    return true;
  } finally {
    cleanKakaoPayReturnUrl();
  }
}

async function startKakaoPayCheckout() {
  clearMessage();
  if (!session?.access_token) {
    showMessage("카카오페이 결제는 로그인 후 이용할 수 있습니다.", true);
    return;
  }
  const form = $("#payment-form");
  const button = $("#kakaopay-checkout-button");
  const checkoutPopup = window.open("about:blank", "_blank");
  try {
    const payload = formDataObject(form);
    payload.provider = "kakaopay";
    payload.purchased_months = Number(payload.purchased_months || 1);
    applyExternalTransactionToken(payload);
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const data = await apiPost("create_kakaopay_checkout", payload, true);
    if (openPaymentDestination(data.next_redirect_url, checkoutPopup)) {
      showMessage(data.payment_message || "카카오페이 결제창으로 이동합니다.");
    } else {
      showMessage("팝업이 차단되어 결제창을 열지 못했습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.", true);
    }
  } catch (error) {
    if (checkoutPopup && !checkoutPopup.closed) checkoutPopup.close();
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    renderPaymentInstructions();
  }
}

function setupAuthTabs() {
  for (const tab of document.querySelectorAll("[data-auth-tab]")) {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.authTab;
      const loginMode = mode === "login";
      document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === tab));
      $("#login-form").hidden = !loginMode;
      $("#signup-form").hidden = mode !== "signup";
      $("#find-email-form").hidden = mode !== "find-email";
      $("#reset-password-form").hidden = mode !== "reset-password";
      document.querySelectorAll(".login-only-content").forEach((item) => {
        item.hidden = !loginMode;
      });
      clearMessage();
    });
  }
}

function setupRememberedEmail() {
  const form = $("#login-form");
  const checkbox = $("#remember-email");
  const emailInput = formField(form, "email");
  if (!emailInput || !checkbox) return;
  try {
    const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
    if (savedEmail) {
      emailInput.value = savedEmail;
      checkbox.checked = true;
    }
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
}

function saveRememberedEmailIfNeeded(form) {
  const checkbox = $("#remember-email");
  const emailInput = formField(form, "email");
  if (!emailInput || !checkbox) return;
  try {
    if (checkbox.checked) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, emailInput.value.trim());
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    // Remember-email is convenience only; login should continue.
  }
}

function setupSocialLoginButtons() {
  for (const button of document.querySelectorAll("[data-oauth-provider]")) {
    button.addEventListener("click", async () => {
      clearMessage();
      const provider = button.dataset.oauthProvider;
      if (isSocialProviderDisabled(provider)) {
        showMessage(providerDisabledMessage(provider), true);
        return;
      }
      button.setAttribute("aria-busy", "true");
      button.disabled = true;
      try {
        await startSocialLogin(provider);
      } finally {
        button.removeAttribute("aria-busy");
        button.disabled = false;
      }
    });
  }
}

function setupForms() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    const form = event.currentTarget;
    try {
      saveRememberedEmailIfNeeded(form);
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
      if (email) setFormValue("#login-form", "email", email);
      showMessage(data.message || "인증메일을 발송했습니다. 입력한 이메일함에서 인증 링크를 클릭해 인증을 완료한 뒤 로그인해 주세요.");
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
      if (email) setFormValue("#login-form", "email", email);
      showMessage(data.message || "가입된 이메일이면 임시비밀번호를 발송했습니다. 메일로 받은 임시비밀번호를 로그인 비밀번호 칸에 입력해 주세요.");
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
  formField(paymentForm, "purchased_months")?.addEventListener("change", renderPaymentInstructions);
  $("#kakaopay-checkout-button")?.addEventListener("click", startKakaoPayCheckout);
  applyCheckoutQueryDefaults();
  paymentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    if (!session?.access_token) {
      showMessage("구매 등록은 로그인 후 이용할 수 있습니다.", true);
      return;
    }
    const form = event.currentTarget;
    const button = $("#payment-submit-button");
    try {
      const payload = formDataObject(form);
      payload.provider = "smartstore";
      payload.purchased_months = Number(payload.purchased_months || 1);
      applyExternalTransactionToken(payload);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const data = await apiPost("create_payment_record", payload, true);
      renderAccount(data);
      if (data.license_key) {
        form.reset();
        showMessage(data.payment_message || "결제가 확인되어 라이선스가 자동 발급되었습니다.");
      } else {
        showMessage(data.payment_message || "결제 확인은 완료됐지만 자동 발급 결과를 확인하지 못했습니다. support@mio.ai.kr로 문의해 주세요.");
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
      renderAuthState();
      showMessage(data.message || "계정을 삭제했습니다. 같은 이메일로는 다시 가입할 수 없습니다.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#logout-button").addEventListener("click", () => {
    socialAuthClient()?.auth.signOut({ scope: "local" }).catch(() => {});
    saveSession(null);
    accountState = null;
    renderAuthState();
    showMessage("로그아웃되었습니다.");
  });
}

async function bootAccountPage() {
  setupAuthTabs();
  setupRememberedEmail();
  setupForms();
  setupSocialLoginButtons();
  renderSocialProviderStatus();
  await refreshSocialProviderAvailability();
  applyCheckoutQueryDefaults();
  if (await maybeAutoStartSocialLoginFromUrl()) return;
  const adoptedSocialSession = await adoptSocialAuthSessionFromUrl();
  if (adoptedSocialSession && maybeReturnSessionToApp()) return;
  await loadAccount();
  await handleKakaoPayReturn();
  if (maybeReturnSessionToApp()) return;
  if (adoptedSocialSession && accountState) showMessage("소셜 계정으로 로그인되었습니다.");
}

bootAccountPage();
