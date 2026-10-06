"""화면(src/app.html) + Firebase 연결부(src/adapter.js) + 설정(src/firebase-config.js) → 배포용 index.html

사용법:  python3 src/build.py
화면을 고칠 때는 src/app.html 을 고치고 이걸 다시 돌린 뒤, 바뀐 index.html 을 GitHub에 올리면
Vercel이 자동으로 다시 배포한다.
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / "src" / "app.html").read_text(encoding="utf-8")
adapter = (ROOT / "src" / "adapter.js").read_text(encoding="utf-8")
cfg_file = ROOT / "src" / "firebase-config.js"
config = cfg_file.read_text(encoding="utf-8").strip() if cfg_file.exists() else """window.GGOOLCHA_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};"""


def swap(text, old, new):
    assert text.count(old) == 1, f"찾을 수 없음: {old[:60]}"
    return text.replace(old, new)


app = src
# 사진 주소: claude.ai의 /_blob/ 대신 Firestore에서 불러온 사진
app = swap(app, 'const photoUrl = (id) => (id ? "/_blob/" + id : "");',
           'const photoUrl = (id) => (id ? (window.__ggPhoto ? window.__ggPhoto(id) : "") : "");')
# claude.ai 전용 안내 문구
app = swap(app, "데이터 저장소에 연결하지 못했습니다. claude.ai에 로그인한 상태에서 이 페이지를 열어 주세요.",
           "데이터 저장소에 연결하지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.")

head_end = app.index("</style>") + len("</style>")
head, body = app[:head_end], app[head_end:]

gate_css = """<style>
#ggGate { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, #0b0b10 90%, transparent); backdrop-filter: blur(4px); }
#ggGate .gg-card { width: min(420px, 100%); background: var(--surface); color: var(--ink); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow); padding: 0 0 22px; display: grid; gap: 12px; }
#ggGate .gg-card::before { content: ""; height: 9px; background: repeating-linear-gradient(90deg, var(--red) 0 30px, var(--kerb-white) 30px 60px); }
#ggGate .gg-card > * { margin-inline: 22px; }
#ggGate h2 { font-family: var(--font-wordmark); font-style: italic; font-weight: 700; font-size: 40px; line-height: 1; letter-spacing: 0.02em; margin-top: 10px; margin-bottom: 0; }
#ggGate p { margin: 0; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
#ggGate form { display: grid; gap: 8px; }
#ggGate label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
#ggGate input { font: inherit; padding: 10px 12px; border-radius: var(--r); border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); }
#ggGate button { font: inherit; font-weight: 700; padding: 10px 14px; border-radius: var(--r); border: 1px solid var(--red); background: var(--red); color: #fff; cursor: pointer; }
#ggGate button:disabled { opacity: 0.6; cursor: wait; }
#ggGate .gg-err { min-height: 1.4em; color: var(--danger); font-size: 13px; }
</style>
"""

waiter = """<script>
/* 화면 코드가 저장소를 기다리는 자리. Firebase 연결부(아래 module)가 준비되면 채워진다. */
(function () {
  var done = false, resolve;
  var boot = new Promise(function (r) { resolve = r; });
  window.__ggBootResolve = function (api) { if (!done) { done = true; resolve(api); } };
  // 25초 안에 연결부가 뜨지 않으면(인터넷 끊김 등) 빈 저장소로 시작해서 안내 문구를 띄운다.
  // 입장 코드 화면이 떠 있는 동안은 사람이 입력하는 시간이므로 이 시계를 멈춘다(__ggBootHold).
  var timer = setTimeout(function () { window.__ggBootResolve({}); }, 25000);
  window.__ggBootHold = function () { clearTimeout(timer); };
  window.claude = { use: function (name) { return boot.then(function (api) { return (api && api[name]) || null; }); } };
})();
</script>
"""

out = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="EV 자작차 동아리의 부품·공구·소모품 재고와 사용 기록">
<meta name="theme-color" content="#14151b">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='19.5' fill='%230b0b10'/%3E%3Ccircle cx='20' cy='20' r='13.2' fill='none' stroke='%23e10600' stroke-width='3.4' stroke-dasharray='34.6 6.9' transform='rotate(-62 20 20)'/%3E%3Ccircle cx='20' cy='20' r='7.6' fill='%23c9ccd3'/%3E%3Ccircle cx='20' cy='20' r='2.6' fill='%230b0b10'/%3E%3C/svg%3E">
{head.strip()}
{gate_css}
<script>
/* ===== Firebase 설정 (Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정 및 구성) ===== */
{config}
</script>
{waiter}<script type="module">
{adapter}
</script>
</head>
<body>
{body.strip()}
</body>
</html>
"""
dest = ROOT / "index.html"
dest.write_text(out, encoding="utf-8")
print(f"wrote {dest} ({len(out.encode('utf-8')) // 1024} KB)")
