// STORAGE 독립 배포용 연결부
// 화면 코드는 claude.ai용과 똑같이 두고, 그 밑에서 쓰던 저장소(window.claude)를
// Google Firebase(Firestore 데이터베이스 + 익명 로그인)로 바꿔 끼운다.
//  - db     → Firestore 컬렉션 items / loans / purchases / ships
//  - assets → 사진을 줄여서 Firestore photos 컬렉션에 저장 (Storage 유료 요금제 없이)
//  - user   → 기기별 익명 로그인 id
//  - sample → 우리 Vercel 서버(/api/read-order)가 Gemini(무료)로 주문 화면 사진을 읽어 준다
// 탭을 새로 열 때마다 '동아리 입장 코드'를 다시 넣어야 하고, 보안 규칙은
// members 명단에 적힌 코드가 지금 입장 코드와 같은 기기만 읽고 쓰게 막는다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, orderBy, limit, onSnapshot,
  getDocs, getDoc, getDocFromCache, addDoc, setDoc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const photoCache = new Map(), photoWait = new Set();
let fs = null, uid = null, fbUser = null;

// ---------- 오류 코드: Firestore → 화면 코드가 아는 이름 ----------
function mapErr(e) {
  const c = String(e?.code || "");
  const code = c === "permission-denied" ? "invalid_argument"
    : c === "resource-exhausted" ? "quota_exceeded"
    : c === "unauthenticated" ? "revoked"
    : c === "unavailable" ? "unavailable" : c || "upstream_error";
  return Object.assign(new Error(e?.message || String(e)), { code, cause: e });
}
const plain = (o) => JSON.parse(JSON.stringify(o ?? {})); // undefined 값 제거 (Firestore는 거부함)
const wrapDoc = (d) => ({ id: d.id, exists: d.exists(), data: () => d.data(), metadata: {} });
const wrapSnap = (s) => {
  const docs = s.docs.map(wrapDoc);
  return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: s.metadata?.fromCache, hasPendingWrites: s.metadata?.hasPendingWrites } };
};

// ---------- db ----------
function makeQuery(path, cons = []) {
  const ref = () => (cons.length ? query(collection(fs, path), ...cons) : collection(fs, path));
  return {
    where: (f, op, v) => makeQuery(path, [...cons, where(f, op, v)]),
    orderBy: (f, dir = "asc") => makeQuery(path, [...cons, orderBy(f, dir)]),
    limit: (n) => makeQuery(path, [...cons, limit(n)]),
    async get() { try { return wrapSnap(await getDocs(ref())); } catch (e) { throw mapErr(e); } },
    onSnapshot(next, error) {
      return onSnapshot(ref(), (s) => next(wrapSnap(s)), (e) => { if (typeof error === "function") error(mapErr(e)); });
    },
  };
}
function makeDoc(path) {
  const r = doc(fs, path);
  const run = async (p) => { try { return await p; } catch (e) { throw mapErr(e); } };
  return {
    id: r.id, path: r.path,
    get: async () => wrapDoc(await run(getDoc(r))),
    set: (data) => run(setDoc(r, plain(data))),
    update: (data) => run(updateDoc(r, plain(data))),
    delete: () => run(deleteDoc(r)),
  };
}
const db = {
  doc: makeDoc,
  collection: (path) => Object.assign(makeQuery(path), {
    path,
    doc: (id) => makeDoc(id ? `${path}/${id}` : doc(collection(fs, path)).path),
    async add(data) { try { return makeDoc((await addDoc(collection(fs, path), plain(data))).path); } catch (e) { throw mapErr(e); } },
  }),
};

// ---------- 사진 (Firestore 문서 1개 = 사진 1장, 1MB 한도라 작게 줄여서 저장) ----------
async function toJpegDataUrl(blob, max, q) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
const assets = {
  async upload(blob) {
    let url = await toJpegDataUrl(blob, 1280, 0.72);
    if (url.length > 700000) url = await toJpegDataUrl(blob, 960, 0.6);
    if (url.length > 900000) throw Object.assign(new Error("too large"), { code: "too_large" });
    try {
      const r = await addDoc(collection(fs, "photos"), { data: url, createdAt: Date.now(), by: uid });
      photoCache.set(r.id, url);
      return { id: r.id, url, sizeBytes: url.length, contentType: "image/jpeg" };
    } catch (e) { throw mapErr(e); }
  },
  async delete(id) { try { await deleteDoc(doc(fs, "photos", id)); return { deleted: true }; } catch (e) { throw mapErr(e); } },
  async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; },
};
async function loadPhoto(id) {
  if (photoWait.has(id)) return;
  photoWait.add(id);
  await ready;
  let url = PX;
  if (fs) {
    const r = doc(fs, "photos", id);
    try {
      let d = null;
      try { d = await getDocFromCache(r); } catch { d = null; }
      if (!d || !d.exists()) d = await getDoc(r);
      if (d.exists()) url = d.data().data || PX;
    } catch { url = PX; }
  }
  photoCache.set(id, url); photoWait.delete(id);
  const mark = `${PX}#p=${id}`;
  document.querySelectorAll("img").forEach((img) => { if (img.getAttribute("src") === mark) img.src = url; });
}
// 화면 코드의 photoUrl(id)가 부른다: 있으면 바로, 없으면 빈 그림을 두고 불러온 뒤 바꿔 끼움
window.__ggPhoto = (id) => {
  if (!id) return "";
  if (photoCache.has(id)) return photoCache.get(id);
  loadPhoto(id);
  return `${PX}#p=${id}`;
};

// ---------- AI: 주문 화면 사진 읽기 ----------
// 화면 코드는 claude.ai의 sample.json(프롬프트, {images})와 같은 모양으로 부른다.
// 사진은 우리 서버(/api/read-order)로 보내고, 서버가 Gemini API 키로 읽은 결과만 돌려준다.
// 서버는 입장 코드를 맞힌 기기의 로그인 토큰이 있어야 받아 준다.
async function toJpegPart(b) {
  // 서버 한 번에 보낼 수 있는 크기(약 4MB)를 넘지 않게 한 장씩 다시 줄인다
  let url = await toJpegDataUrl(b, 1600, 0.82);
  if (url.length > 900000) url = await toJpegDataUrl(b, 1280, 0.7);
  return { data: url.split(",")[1], mimeType: "image/jpeg" };
}
function parseJson(t) {
  const s = String(t || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), z = s.lastIndexOf("}");
  if (a >= 0 && z > a) return JSON.parse(s.slice(a, z + 1));
  throw Object.assign(new Error("not json"), { code: "invalid_json" });
}
const aiError = (code, msg) => Object.assign(new Error(msg || code), { code });
const sample = Object.assign(async () => { throw aiError("invalid_request", "text only"); }, {
  photosOnly: true, // 재고 질문(이름이 담긴 기록을 보내는 기능)은 이 버전에서 쓰지 않는다
  limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 6, maxInputBytes: 20000000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } }),
  async json(input, opts = {}) {
    const prompt = typeof input === "string" ? input : (input || []).map((m) => m.content).join("\n\n");
    const imgs = opts.images ? (opts.images instanceof Blob ? [opts.images] : [...opts.images]) : [];
    const images = [];
    let total = 0;
    for (const b of imgs.slice(0, 6)) { const part = await toJpegPart(b); total += part.data.length; if (total > 3800000) break; images.push(part); }
    if (opts.signal?.aborted) throw aiError("cancelled");
    let r;
    try {
      const token = await fbUser.getIdToken();
      r = await fetch("/api/read-order", {
        method: "POST", signal: opts.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ prompt, images }),
      });
    } catch (e) { throw aiError(opts.signal?.aborted ? "cancelled" : "upstream_error", String(e?.message || e)); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw aiError("rate_limited", j?.error);
    if (r.status === 401 || r.status === 403) throw aiError("not_granted", j?.error);
    if (r.status === 503 || j?.error === "no_key") throw aiError("sampling_disabled", j?.error);
    if (!r.ok) throw aiError("upstream_error", j?.error || String(r.status));
    return parseJson(j.text);
  },
});

const user = {
  id: async () => uid,
  can: async () => true,
  isOwner: async () => false,
  canEdit: async () => true,
  profiles: async () => ({}),
};

// ---------- 입장 화면 ----------
function overlay(html) {
  let el = document.getElementById("ggGate");
  if (!el) {
    el = document.createElement("div");
    el.id = "ggGate";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "ggGateTitle");
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="gg-card"><h2 id="ggGateTitle">STORAGE</h2>${html}</div>`;
  return el;
}
const closeOverlay = () => document.getElementById("ggGate")?.remove();
function askCode(msg = "") {
  return new Promise((resolve) => {
    const el = overlay(`
      <p>동아리원만 쓸 수 있습니다. 운영진에게 받은 <b>입장 코드</b>를 입력하세요.<br>창을 새로 열 때마다 다시 묻습니다.</p>
      <form id="ggForm" autocomplete="off">
        <label for="ggCode">입장 코드</label>
        <input id="ggCode" type="password" maxlength="60" required autofocus>
        <p class="gg-err" id="ggErr" role="alert">${msg}</p>
        <button type="submit" id="ggGo">입장</button>
      </form>`);
    const form = el.querySelector("#ggForm"), err = el.querySelector("#ggErr"), btn = el.querySelector("#ggGo");
    setTimeout(() => el.querySelector("#ggCode").focus(), 0);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const code = el.querySelector("#ggCode").value.trim(); if (!code) return;
      btn.disabled = true; err.textContent = "확인하는 중…";
      try {
        await setDoc(doc(fs, "members", uid), { code, joinedAt: Date.now() });
        resolve();
      } catch (e) {
        err.textContent = e?.code === "permission-denied" ? "입장 코드가 맞지 않습니다." : "인터넷 연결을 확인하고 다시 시도해 주세요.";
        btn.disabled = false;
      }
    });
  });
}
function fatal(msg) { overlay(`<p>${msg}</p><button type="button" onclick="location.reload()">새로고침</button>`); }

let resolveReady;
const ready = new Promise((r) => (resolveReady = r));
const NONE = { db: null, user: null, assets: null, sample: null };

async function boot() {
  const cfg = window.GGOOLCHA_FIREBASE || {};
  if (!cfg.apiKey || !cfg.projectId) {
    fatal("아직 Firebase 설정 값이 들어 있지 않습니다.<br>index.html 맨 위의 <b>GGOOLCHA_FIREBASE</b> 칸에 Firebase 웹 앱 설정을 붙여 넣어 주세요.");
    return NONE;
  }
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { fs = initializeFirestore(app, {}); }

  // 이 기기의 익명 로그인 (한 번 만들면 브라우저에 남는다)
  let u = await new Promise((res) => { const off = onAuthStateChanged(auth, (x) => { off(); res(x); }); });
  if (!u) {
    try { u = (await signInAnonymously(auth)).user; }
    catch (e) {
      const c = String(e?.code || "");
      fatal(c.includes("operation-not-allowed") || c.includes("admin-restricted")
        ? "Firebase에서 <b>익명 로그인</b>이 꺼져 있습니다. Authentication → 로그인 방법에서 ‘익명’을 사용 설정해 주세요."
        : c.includes("network") ? "인터넷에 연결되어 있지 않습니다. 연결한 뒤 새로고침해 주세요."
        : `로그인하지 못했습니다. (${c || "알 수 없는 오류"})`);
      return NONE;
    }
  }
  uid = u.uid; fbUser = u;

  // 입장 코드: 이 탭에서 이미 맞혔으면(새로고침) 넘어가고, 새 창·새 탭이면 다시 묻는다
  const KEY = "gg-ok-" + uid;
  let ok = false;
  try { ok = sessionStorage.getItem(KEY) === "1"; } catch {}
  if (!ok) await askCode();
  try { sessionStorage.setItem(KEY, "1"); } catch {}
  closeOverlay();
  return { db, user, assets, sample };
}

boot().then(resolveReady, (e) => { fatal(`시작하지 못했습니다. (${e?.code || e?.message || e})`); resolveReady(NONE); });
// 화면 코드는 window.claude.use(이름)으로 기다리고 있다 (index.html 위쪽의 연결 대기 스크립트)
ready.then((api) => window.__ggBootResolve && window.__ggBootResolve(api));
