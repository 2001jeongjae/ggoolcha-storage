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
#ggGate { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(3px); }
#ggGate .gg-card { width: min(420px, 100%); background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 22px; display: grid; gap: 12px; }
#ggGate h2 { font-family: var(--font-display); font-weight: 400; font-size: 28px; letter-spacing: 0.5px; margin: 0; }
#ggGate p { margin: 0; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
#ggGate form { display: grid; gap: 8px; }
#ggGate label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
#ggGate input { font: inherit; padding: 10px 12px; border-radius: var(--r); border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); }
#ggGate button { font: inherit; font-weight: 600; padding: 10px 14px; border-radius: var(--r); border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); cursor: pointer; }
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
  // 25초 안에 연결부가 뜨지 않으면(인터넷 끊김 등) 빈 저장소로 시작해서 안내 문구를 띄운다
  setTimeout(function () { window.__ggBootResolve({}); }, 25000);
  window.claude = { use: function (name) { return boot.then(function (api) { return (api && api[name]) || null; }); } };
})();
</script>
"""

out = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="꿀차 EV 자작차 동아리의 부품·공구·소모품 재고와 사용 기록">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231e6b45'/%3E%3Cpath d='M8 12h16v12H8zM11 8h10v4H11z' fill='none' stroke='white' stroke-width='2.4' stroke-linejoin='round'/%3E%3C/svg%3E">
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
