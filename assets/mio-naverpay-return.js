const ACCOUNT_ENDPOINT = "https://osccvepkxhmrfomtfgfj.supabase.co/functions/v1/mio-account";

const resultBox = document.querySelector("#naverpay-result");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderFailure(message) {
  resultBox.innerHTML = `
    <div class="empty error-box">
      <strong>결제 처리가 완료되지 않았습니다.</strong><br />
      ${escapeHtml(message || "네이버페이 결제 결과를 확인하지 못했습니다.")}
    </div>
    <p class="hint"><a class="button ghost compact" href="/account/">계정 페이지로 돌아가기</a></p>`;
}

function renderSuccess(data) {
  const key = data.license_key || "";
  resultBox.innerHTML = `
    <p class="hint">${escapeHtml(data.message || "결제가 확인되어 라이선스가 발급되었습니다.")}</p>
    <dl class="payment-lines">
      <div><dt>라이선스 ID</dt><dd>${escapeHtml(data.license_id || "-")}</dd></div>
      <div><dt>만료일</dt><dd>${escapeHtml(data.expires_at || "-")}</dd></div>
    </dl>
    ${key ? `<textarea class="trial-key" readonly>${escapeHtml(key)}</textarea><button id="copy-license-key" class="button primary full" type="button">라이선스 키 복사</button>` : ""}
    <p class="hint">계정 페이지의 내 라이선스 목록에도 자동 연결되었습니다. 프로그램에서는 같은 계정으로 로그인하면 자동 인증됩니다. 자동 인증이 되지 않으면 홈페이지 계정 페이지의 '라이선스 연결' 칸에 위 키를 붙여넣어 연결해 주세요.</p>
    <p><a class="button ghost compact" href="/account/">계정 페이지로 돌아가기</a></p>`;
  document.querySelector("#copy-license-key")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(key);
      document.querySelector("#copy-license-key").textContent = "복사 완료";
    } catch {
      document.querySelector("#copy-license-key").textContent = "직접 선택해 복사해 주세요";
    }
  });
}

async function approve() {
  const params = new URLSearchParams(window.location.search);
  const resultCode = params.get("resultCode") || "";
  if (resultCode !== "Success") {
    renderFailure(params.get("resultMessage") || "구매자가 결제를 취소했거나 결제 시간이 만료되었습니다.");
    return;
  }
  const payload = {
    action: "naverpay_approve",
    record: params.get("record") || "",
    token: params.get("token") || "",
    resultCode,
    paymentId: params.get("paymentId") || "",
    resultMessage: params.get("resultMessage") || "",
    reserveId: params.get("reserveId") || "",
  };
  try {
    const response = await fetch(ACCOUNT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || "네이버페이 결제 승인에 실패했습니다.");
    renderSuccess(data);
  } catch (error) {
    renderFailure(error.message);
  }
}

approve();
