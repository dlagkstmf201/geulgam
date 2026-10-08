/*
 * 글감 찾기 — AI 중계 함수
 *
 * 학생 화면에서 온 질문을 Claude에게 대신 물어보고 답만 돌려줍니다.
 * API 키는 이 서버에만 있고 학생 화면으로 나가지 않습니다.
 *
 * 환경 변수
 *   ANTHROPIC_API_KEY  (필수) 없으면 전체가 '안내 모드'로 작동합니다
 *   MODEL              (선택) 기본값 claude-haiku-5-5
 *   RATE_MAX           (선택) 한 기기가 한 시간에 부를 수 있는 최대 횟수, 기본 80
 */

const MODEL = process.env.MODEL || "claude-haiku-5-5";
const RATE_MAX = Number(process.env.RATE_MAX || 80);

/* 같은 기기가 지나치게 많이 부르는 것을 막습니다.
   서버가 새로 뜨면 초기화되지만, 한 반 수업에는 충분합니다. */
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const hour = 3600000;
  const rec = hits.get(ip);
  if (!rec || now - rec.start > hour) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 500) hits.clear();
    return true;
  }
  rec.n += 1;
  return rec.n <= RATE_MAX;
}

const TONE =
  "당신은 고등학생의 자전적 소설 쓰기를 곁에서 돕는 글쓰기 도우미입니다. " +
  "학생이 '나를 자라게 한 순간'을 꺼내고 그것을 한 장면의 소설로 쓰도록 돕는 것이 목표입니다. " +
  "다만 '성장'이라는 말을 직접 쓰거나 교훈을 묻지는 마세요. 구체적인 순간을 물으면 성장은 저절로 드러납니다. " +
  "말투는 존댓말로 부드럽고 진중하게. 장난스럽거나 가벼운 표현, 이모지, 느낌표 남발은 절대 쓰지 않습니다.";

const NEVER_WRITE =
  "절대 규칙: 당신은 학생을 대신해 문장을 써 주지 않습니다. 고쳐 쓴 문장이나 예시 문장을 제시하면 " +
  "이 수업은 실패합니다. 당신이 할 수 있는 것은 학생이 쓴 말을 그대로 인용해 지목하는 것, " +
  "질문하는 것, 잘된 곳을 알아봐 주는 것뿐입니다.";

function storyOf(s) {
  if (!s) return "";
  if (typeof s === "string") return s;
  const body = (s.parts || []).map((p) => `${p.l}: ${p.t}`).join(" / ");
  return (s.opener || s.title || "") + (body ? ` — ${body}` : "");
}

function buildPrompt(kind, p) {
  p = p || {};
  if (kind === "deepen") {
    const told = ((p.story && p.story.parts) || []).map((x) => `· ${x.l}: ${x.t}`).join("\n");
    return (
      `${TONE}\n\n학생이 방금 고른 이야기와, 지금까지 들려준 내용입니다.\n` +
      `[고른 이야기] ${(p.story && p.story.opener) || ""}\n${told ? told + "\n" : ""}` +
      `\n이번에는 ${p.beat}를 물어봐 주세요.\n` +
      "규칙: 학생이 실제로 쓴 표현을 살짝 짚으며 구체적으로, 한 문장으로만. " +
      "'무엇을 배웠는지'나 '무엇을 깨달았는지'처럼 교훈을 요구하는 질문은 절대 하지 마세요. " +
      "그렇게 물으면 학생이 상투적인 답으로 도망갑니다. 대신 그때의 행동, 말, 몸의 감각처럼 " +
      "구체적인 것을 물으세요. 질문 문장 하나만 출력하고 다른 말은 붙이지 마세요."
    );
  }
  if (kind === "reframe") {
    return (
      `${TONE}\n\n학생이 '잘 모르겠다'고 했습니다. 다그치지 말고, 지금까지와 다른 각도에서 ` +
      "경험을 떠올릴 수 있는 질문 하나를 새로 만들어 주세요.\n" +
      `[이미 물어본 각도] ${(p.tried || []).join(", ") || "없음"}\n` +
      "규칙: 위와 겹치지 않는 새로운 각도에서 묻되, 사람이 달라지는 자리를 건드리세요. " +
      "예를 들면 처음 해 본 일, 내가 틀렸던 일, 어른에게 실망한 일, 멀어진 관계, " +
      "그만둔 일, 무서웠지만 해낸 일, 남에게 상처 준 일 같은 것입니다. " +
      "'성장'이나 '배움' 같은 말은 쓰지 말고, 아주 구체적인 장면을 예로 들어 " +
      "'어 그건 있었지' 하고 떠오르게 하세요. 한 문장. 질문만 출력."
    );
  }
  if (kind === "narrow") {
    return (
      `${TONE}\n\n학생이 이 경험을 소설로 쓰기로 정했습니다.\n` +
      `[경험] ${storyOf(p.story)}\n[말하고 싶은 것] ${p.seedline || ""}\n\n` +
      "이 경험 전체가 아니라 '딱 한 장면'만 고르도록 돕는 질문을 하나 만들어 주세요. " +
      `학생이 쓴 표현을 짚으며, 어느 순간을 남길지 묻습니다. ${NEVER_WRITE} 한 문장. 질문만 출력.`
    );
  }
  if (kind === "stuck") {
    const f = p.frame || {};
    return (
      `${TONE}\n\n학생이 초고를 쓰다가 막혔습니다.\n` +
      `[한 장면] ${p.shot || ""}\n[인물 이름] ${p.name || ""}\n` +
      `[뼈대] 들머리: ${f.open || ""} / 흔들림: ${f.shake || ""} / 남는 것: ${f.rest || ""}\n` +
      `[지금까지 쓴 글]\n${p.so_far || ""}\n\n${NEVER_WRITE}\n` +
      "학생이 다음 줄을 스스로 쓸 수 있도록, 아주 구체적인 질문 하나만 하세요. " +
      "예를 들어 그 순간 눈에 보인 것, 손이 하고 있던 일, 들린 소리를 묻습니다. 한 문장. 질문만 출력."
    );
  }
  if (kind === "polish") {
    return (
      `${TONE}\n\n학생이 쓴 초고입니다.\n\n${p.draft || ""}\n\n${NEVER_WRITE}\n\n` +
      "이 글을 읽고 아래 형식으로만 답하세요. 한 줄에 하나씩, 구분자는 ||| 입니다.\n" +
      "설명이나 인사말은 쓰지 마세요. 바로 첫 줄부터 시작하세요.\n\n" +
      "KEEP|||글에서 그대로 옮긴 가장 잘 쓴 문장|||왜 좋은지 한 문장\n" +
      "NOTE|||글에서 그대로 옮긴 고칠 문장|||학생이 스스로 고치게 돕는 질문\n" +
      "NOTE|||(최대 3줄까지)|||...\n" +
      "END|||마지막 문장에 대한 한 문장 평\n\n" +
      "NOTE 는 특히 감정을 직접 말한 문장('서운했다' 같은)과 설명으로 때운 문장을 찾으세요. " +
      "질문 자리에 고쳐 쓴 문장을 넣으면 안 됩니다. 질문만 적으세요.\n" +
      "END 는 마지막 문장이 '깨달았다', '성장했다', '그 일을 통해' 같은 선언으로 끝났다면 " +
      "그 점을 알려주고 행동이나 사물로 끝내도록 권하세요. 아니면 잘된 점을 말하세요.\n" +
      "KEEP 과 NOTE 의 인용은 반드시 학생 글에 있는 그대로여야 합니다."
    );
  }
  if (kind === "sift") {
    const list = (p.seeds || []).map((s, i) => `${i}) ${s}`).join("\n");
    return (
      `${TONE}\n\n학생이 모은 글감(씨앗)들입니다. 자전적 소설감으로서 세 잣대로 살펴봐 주세요. ` +
      "좋은 글감은 특별한 사건이 아니라 '그 학생만 할 수 있는 이야기'이고, " +
      "그 일을 겪기 전과 후의 내가 달라져 있는 이야기입니다.\n" +
      "세 잣대는 각각 1점에서 3점입니다.\n" +
      "고유함: 누가 겪어도 똑같으면 1, 그 관계나 상황이 그 사람만의 것이면 3\n" +
      "변화: 전과 후가 거의 같으면 1, 달라진 것이 뚜렷하면 3\n" +
      "속마음: 겉사건만 있으면 1, 남모를 감정이 깔려 있으면 3\n\n" +
      `[씨앗]\n${list}\n\n` +
      "아래 형식으로만 답하세요. 씨앗 하나당 한 줄, 번호 순서대로, 구분자는 ||| 입니다.\n" +
      "설명이나 인사말은 쓰지 마세요. 바로 첫 줄부터 시작하세요.\n\n" +
      "번호|||고유함점수|||변화점수|||속마음점수|||한 문장 조언\n\n" +
      "예시 — 0|||3|||2|||3|||겉으로는 작은 일이지만 그 거리감은 본인만 아는 감정입니다.\n\n" +
      "조언은 약한 씨앗도 버리지 말고 '여기를 이렇게 파면 특별해진다'고 길을 내주세요. " +
      "'성장했다', '배웠다' 같은 상투적인 말은 쓰지 마세요."
    );
  }
  return null;
}

/* 줄 단위 형식을 읽습니다. 답이 중간에 잘려도 거기까지는 살아남습니다. */
const SEP = "|||";
function parseLines(kind, text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

  if (kind === "polish") {
    const out = { keep: null, notes: [], ending: "" };
    for (const line of lines) {
      const f = line.split(SEP).map((x) => x.trim());
      if (f.length < 2) continue;
      const tag = f[0].toUpperCase().replace(/[^A-Z]/g, "");
      if (tag === "KEEP" && f[1]) out.keep = { quote: f[1], why: f[2] || "" };
      else if (tag === "NOTE" && f[1] && out.notes.length < 3) out.notes.push({ quote: f[1], ask: f[2] || "" });
      else if (tag === "END" && f[1]) out.ending = f[1];
    }
    return (out.keep || out.notes.length || out.ending) ? out : null;
  }

  if (kind === "sift") {
    const rows = [];
    for (const line of lines) {
      const f = line.split(SEP).map((x) => x.trim());
      if (f.length < 5) continue;
      const i = parseInt(f[0].replace(/[^0-9]/g, ""), 10);
      if (!isFinite(i)) continue;
      rows[i] = {
        scores: { unique: clamp(f[1]), change: clamp(f[2]), inner: clamp(f[3]) },
        note: f[4] || ""
      };
    }
    const filled = rows.filter(Boolean).length;
    return filled ? rows : null;
  }
  return null;
}
function clamp(v) {
  const n = Math.round(Number(String(v).replace(/[^0-9]/g, "")));
  return isFinite(n) ? Math.max(1, Math.min(3, n)) : 2;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const s = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (s >= 0 && end > s) { try { return JSON.parse(text.slice(s, end + 1)); } catch (e) {} }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({});

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({});          // 안내 모드로 수업은 계속됩니다

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch (e) { body = {}; }

  // 화면이 열릴 때 'AI를 쓸 수 있는 상태인가'만 묻는 신호.
  // Claude를 부르지 않으므로 비용이 들지 않습니다.
  if (body.kind === "ping") return res.status(200).json({ ok: true, model: MODEL });

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!allowed(ip)) return res.status(429).json({});

  try {
    const prompt = buildPrompt(body.kind, body.payload);
    if (!prompt) return res.status(400).json({});

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        // 한국어는 토큰을 많이 먹습니다. 답이 잘려 형식이 깨지지 않도록 넉넉히 둡니다.
        max_tokens: body.json ? 2000 : 400,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) throw new Error("anthropic " + r.status);

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("").trim();

    if (!body.json) return res.status(200).json({ text });

    // 줄 단위로 먼저 읽고, 혹시 JSON 으로 왔으면 그것도 받아 줍니다.
    const parsed = parseLines(body.kind, text) || parseJson(text);
    return res.status(200).json({ data: parsed, raw: parsed ? undefined : text.slice(0, 500) });
  } catch (e) {
    console.error("[ask 실패]", e.message);
    // 실패해도 학생 화면은 안내 모드로 이어집니다.
    // 무엇이 문제인지는 /api/check 를 열어 보시면 한국어로 알려 줍니다.
    return res.status(200).json({ error: e.message });
  }
};
