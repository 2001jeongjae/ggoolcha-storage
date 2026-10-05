// GGOOLCHA STORAGE — 주문 화면 사진 읽기 (Vercel 서버 함수)
//
// 화면이 보낸 (개인정보를 가린) 주문 화면 사진과 지시문을 Gemini API에 넘기고, 답(JSON 글)만 돌려준다.
// - Gemini API 키는 Vercel 환경 변수 GEMINI_API_KEY 에만 있다. 코드와 화면에는 없다.
// - 입장 코드를 맞힌 기기만 쓸 수 있다: 화면이 보낸 Firebase 로그인 토큰으로 Firestore 재고 목록을
//   한 줄 읽어 보고, 보안 규칙이 허락할 때만 진행한다. (관리자 열쇠 없이 규칙을 그대로 재사용)
// - 사진과 결과는 서버에 저장하지 않는다.

const PROJECT = process.env.FIREBASE_PROJECT_ID || "ggoolcha-storage";
const MODELS = (process.env.GEMINI_MODELS || "gemini-3.8-flash,gemini-3.5-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);

async function isMember(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/items?pageSize=1&mask.fieldPaths=name`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await isMember(token))) return res.status(403).json({ error: "not_member" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "no_key" });

  const body = req.body || {};
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const images = Array.isArray(body.images) ? body.images : [];
  if (!prompt || prompt.length > 20000 || images.length > 8) return res.status(400).json({ error: "bad_request" });
  for (const im of images) {
    if (!im || typeof im.data !== "string" || !/^image\/(jpeg|png|webp)$/.test(im.mimeType || "image/jpeg")) return res.status(400).json({ error: "bad_image" });
  }

  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }, ...images.map((im) => ({ inline_data: { mime_type: im.mimeType || "image/jpeg", data: im.data } }))],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  let last = { status: 502, message: "" };
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        return res.status(200).json({ text, model });
      }
      last = { status: r.status, message: String(j.error?.message || "").slice(0, 200) };
      // 키가 틀렸거나 막힌 경우는 다른 모델로 바꿔도 같으니 바로 끝낸다
      if (r.status === 400 && /API key/i.test(last.message)) break;
      if (r.status === 403) break;
    } catch (e) {
      last = { status: 502, message: String(e?.message || e).slice(0, 200) };
    }
  }
  const status = last.status === 429 ? 429 : last.status === 403 || /API key/i.test(last.message) ? 503 : 502;
  return res.status(status).json({ error: status === 503 ? "no_key" : "upstream", detail: last.message });
};
