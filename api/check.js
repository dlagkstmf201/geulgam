/*
 * 글감 찾기 — 점검 화면
 *
 * 브라우저에서 https://<내주소>/api/check 를 열면
 * 지금 무엇이 되고 무엇이 안 되는지 한국어로 알려 줍니다.
 * 학생에게 보여줄 화면은 아니고, 선생님 확인용입니다.
 */

const MODEL = process.env.MODEL || "claude-haiku-5-5";

function page(rows, verdict, next) {
  const body = rows.map(r =>
    `<tr><td class="k">${r[0]}</td><td class="v ${r[2] || ""}">${r[1]}</td></tr>`
  ).join("");
  const steps = next.length
    ? `<h2>이렇게 해 보세요</h2><ol>${next.map(s => `<li>${s}</li>`).join("")}</ol>`
    : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>점검 — 글감 찾기</title>
<style>
 body{font-family:system-ui,-apple-system,"Noto Sans KR",sans-serif;background:#EFF1EB;color:#1B2318;
      margin:0;padding:28px 18px;line-height:1.75}
 .w{max-width:620px;margin:0 auto}
 h1{font-size:22px;margin:0 0 4px}
 .vd{font-size:15px;padding:12px 15px;border-radius:4px;margin:14px 0 22px;font-weight:700}
 .vd.ok{background:#DDE9DD;color:#1F4A36}
 .vd.no{background:#F3E3DD;color:#A33E27}
 table{width:100%;border-collapse:collapse;font-size:14.5px;margin-bottom:8px}
 td{padding:10px 0;border-bottom:1px solid #D8DDD3;vertical-align:top}
 td.k{color:#848C7D;width:34%}
 td.v{word-break:break-all}
 td.v.bad{color:#A33E27;font-weight:700}
 td.v.good{color:#2F6B4F;font-weight:700}
 h2{font-size:16px;margin:26px 0 8px}
 ol{padding-left:20px;margin:0} li{margin-bottom:9px}
 code{background:#F8F9F5;border:1px solid #D8DDD3;border-radius:3px;padding:1px 5px;font-size:13px}
 .ft{margin-top:26px;font-size:12.5px;color:#848C7D}
</style></head><body><div class="w">
<h1>글감 찾기 점검</h1>
<div class="vd ${verdict.ok ? "ok" : "no"}">${verdict.msg}</div>
<table>${body}</table>${steps}
<p class="ft">이 화면은 선생님 확인용입니다. 학생에게는 주소 끝의 <code>/api/check</code> 를 뺀 주소를 주세요.</p>
</div></body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  const key = process.env.ANTHROPIC_API_KEY;
  const rows = [];

  rows.push(["서버", "작동 중 (이 화면이 보이면 파일 구조는 맞습니다)", "good"]);
  rows.push(["쓰는 모델", MODEL]);

  if (!key) {
    rows.push(["API 키", "없음", "bad"]);
    return res.status(200).send(page(rows,
      { ok: false, msg: "API 키가 서버에 없습니다. 그래서 안내 모드로 작동합니다." },
      [
        "Vercel에서 이 프로젝트를 엽니다.",
        "<b>Settings → Environment Variables</b> 로 들어갑니다.",
        "Name 에 <code>ANTHROPIC_API_KEY</code>, Value 에 <code>sk-ant-</code> 로 시작하는 키를 넣고 저장합니다.",
        "<b>중요</b> — <b>Deployments</b> 탭으로 가서 맨 위 항목의 <b>⋯ → Redeploy</b> 를 누릅니다. 환경 변수는 다시 배포해야 반영됩니다.",
        "1~2분 뒤 이 화면을 새로고침하세요."
      ]));
  }

  rows.push(["API 키", "있음 (" + key.slice(0, 7) + "…" + key.slice(-4) + ")", "good"]);

  let r, raw = "";
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16,
        messages: [{ role: "user", content: "안녕하세요라고만 답하세요." }]
      })
    });
    raw = await r.text();
  } catch (e) {
    rows.push(["Claude 연결", "연결 실패: " + e.message, "bad"]);
    return res.status(200).send(page(rows,
      { ok: false, msg: "서버가 Claude에 연결하지 못했습니다." },
      ["잠시 뒤 다시 시도해 보세요.", "계속 같으면 이 화면을 캡처해 알려 주세요."]));
  }

  rows.push(["Claude 응답 코드", String(r.status), r.ok ? "good" : "bad"]);

  if (r.ok) {
    let say = "";
    try {
      const d = JSON.parse(raw);
      say = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    } catch (e) {}
    rows.push(["Claude가 한 말", say || "(비어 있음)", "good"]);
    return res.status(200).send(page(rows,
      { ok: true, msg: "모두 정상입니다. 학생 화면에 'AI 함께'로 떠야 합니다." },
      ["학생 화면을 새로고침한 뒤 오른쪽 위 표시를 확인하세요.",
       "그래도 '안내 모드'면 브라우저 캐시 때문일 수 있습니다. 새로고침을 한 번 더 하거나 다른 브라우저로 열어 보세요."]));
  }

  // 오류 해석
  let msg = "Claude가 요청을 거절했습니다.", tips = [];
  let detail = raw.slice(0, 400);
  try {
    const d = JSON.parse(raw);
    if (d.error && d.error.message) detail = d.error.message;
  } catch (e) {}
  rows.push(["오류 내용", detail, "bad"]);

  if (r.status === 401 || r.status === 403) {
    msg = "API 키가 잘못되었거나 권한이 없습니다.";
    tips = [
      "키를 복사할 때 앞뒤 공백이나 줄바꿈이 섞이지 않았는지 확인하세요.",
      "platform.claude.com 의 <b>Settings → API keys</b> 에서 키가 살아 있는지 확인하세요.",
      "키를 새로 만들어 Vercel 환경 변수에 다시 넣고 <b>Redeploy</b> 하세요."
    ];
  } else if (r.status === 404) {
    msg = "모델 이름이 맞지 않습니다.";
    tips = [
      "Vercel <b>Settings → Environment Variables</b> 에 <code>MODEL</code> 이라는 변수가 있다면 지우거나 <code>claude-haiku-5-5</code> 로 고치세요.",
      "고친 뒤 <b>Deployments → ⋯ → Redeploy</b> 를 누르세요."
    ];
  } else if (r.status === 400 && /credit|balance/i.test(detail)) {
    msg = "크레딧이 부족합니다.";
    tips = [
      "platform.claude.com 의 <b>Billing</b> 에서 크레딧을 충전하세요. 5달러면 충분합니다.",
      "충전 뒤에는 바로 작동합니다. 다시 배포하지 않아도 됩니다."
    ];
  } else if (r.status === 429) {
    msg = "요청이 너무 몰렸습니다.";
    tips = ["1~2분 뒤 다시 시도해 보세요."];
  } else {
    tips = ["위 오류 내용을 캡처해 알려 주세요."];
  }

  return res.status(200).send(page(rows, { ok: false, msg: msg }, tips));
};
