// GGOOLCHA STORAGE 독립 배포용 연결부
// 화면 코드는 claude.ai용과 똑같이 두고, 그 밑에서 쓰던 저장소(window.claude)를
// Google Firebase(Firestore 데이터베이스 + 익명 로그인)로 바꿔 끼운다.
//  - db     → Firestore 컬렉션 items / loans / purchases / ships
//  - assets → 사진을 줄여서 Firestore photos 컬렉션에 저장 (Storage 유료 요금제 없이)
//  - user   → 기기별 익명 로그인 id
//  - sample → Firebase AI Logic(Gemini Developer API, 무료)로 주문 화면 사진 읽기
// 탭을 새로 열 때마다 '동아리 입장 코드'를 다시 넣어야 하고, 보안 규칙은
// members 명단에 적힌 코드가 지금 입장 코드와 같은 기기만 읽고 쓰게 막는다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, orderBy, limit, onSnapshot,
  getDocs, getDoc, getDocFromCache, addDoc, setDoc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const photoCache = new Map(), photoWait = new Set();
let fs = null, uid = null, fbApp = null;

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

// ---------- AI: 주문 화면 사진 읽기 (Gemini) ----------
// 화면 코드는 claude.ai의 sample.json(프롬프트, {images})와 같은 모양으로 부른다.
const AI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]; // 앞의 것이 안 되면 다음 것
let aiModels = null;
function getModels() {
  if (!aiModels) {
    const ai = getAI(fbApp, { backend: new GoogleAIBackend() });
    aiModels = AI_MODELS.map((model) => getGenerativeModel(ai, { model, generationConfig: { responseMimeType: "application/json", temperature: 0 } }));
  }
  return aiModels;
}
const blobToPart = (b) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res({ inlineData: { data: String(r.result).split(",")[1], mimeType: b.type || "image/jpeg" } });
  r.onerror = rej; r.readAsDataURL(b);
});
function parseJson(t) {
  const s = String(t || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), z = s.lastIndexOf("}");
  if (a >= 0 && z > a) return JSON.parse(s.slice(a, z + 1));
  throw Object.assign(new Error("not json"), { code: "invalid_json" });
}
function mapAiErr(e) {
  const m = String(e?.message || e || "");
  const code = /429|quota|exhausted|rate/i.test(m) ? "rate_limited" : /403|PERMISSION|not been used|disabled|API key/i.test(m) ? "sampling_disabled" : "upstream_error";
  return Object.assign(new Error(m), { code, cause: e });
}
const sample = Object.assign(async () => { throw Object.assign(new Error("text only"), { code: "invalid_request" }); }, {
  photosOnly: true, // 재고 질문(이름이 담긴 기록을 보내는 기능)은 이 버전에서 쓰지 않는다
  limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 6, maxInputBytes: 20000000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } }),
  async json(input, opts = {}) {
    const text = typeof input === "string" ? input : (input || []).map((m) => m.content).join("\n\n");
    const imgs = opts.images ? (opts.images instanceof Blob ? [opts.images] : [...opts.images]) : [];
    const parts = [text, ...(await Promise.all(imgs.map(blobToPart)))];
    let last = null;
    for (const model of getModels()) {
      if (opts.signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
      try { const r = await model.generateContent(parts); return parseJson(r.response.text()); }
      catch (e) { last = e; if (e?.code === "invalid_json") break; }
    }
    throw last?.code === "invalid_json" ? last : mapAiErr(last);
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
  el.innerHTML = `<div class="gg-card"><h2 id="ggGateTitle">GGOOLCHA STORAGE</h2>${html}</div>`;
  return el;
}
const closeOverlay = () => document.getElementById("ggGate")?.remove();
function askCode(msg = "") {
  return new Promise((resolve) => {
    const el = overlay(`
      <p>꿀차 동아리원만 쓸 수 있습니다. 운영진에게 받은 <b>입장 코드</b>를 입력하세요.<br>창을 새로 열 때마다 다시 묻습니다.</p>
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
  fbApp = app;
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
  uid = u.uid;

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
