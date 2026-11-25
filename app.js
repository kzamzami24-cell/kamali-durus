/* مجالس الكملي — واجهة متابعة الدروس (بدون أي مكتبات) */
(() => {
'use strict';

const KEY = 'kamali.v1';
const DONE_AT = 0.92;              // نسبة المشاهدة التي يُعدّ بعدها الدرس مكتملًا
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

let CAT = null;                    // الفهرس
let BY_ID = {};                    // السلاسل بالمعرّف
let SERIES_OF = {};                // المقطع -> السلسلة
let S = load();                    // حالة المستخدم

/* ---------------- التخزين ---------------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.p) return Object.assign({ p: {}, seen: {}, last: null, theme: null, rate: 1 }, s);
  } catch (e) {}
  return { p: {}, seen: {}, last: null, theme: null, rate: 1, fresh: true };
}
let saveT = 0;
function save(now) {
  clearTimeout(saveT);
  const w = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  now ? w() : (saveT = setTimeout(w, 300));
  if (typeof cloudPush === 'function') cloudPush();
}

/* ---------------- أدوات ---------------- */
const nf = new Intl.NumberFormat('ar-EG');
const n = x => nf.format(x);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thumb = (v, q = 'mqdefault') => `https://i.ytimg.com/vi/${v}/${q}.jpg`;
function fmtDur(s) {
  s = Math.round(s || 0); if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function fmtHours(s) {
  const h = s / 3600;
  if (h >= 1) return `${n(Math.round(h * 10) / 10)} ساعة`;
  return `${n(Math.max(1, Math.round(s / 60)))} دقيقة`;
}
function normAr(t) {
  return String(t || '').replace(/[ؐ-ًؚ-ٰٟـ]/g, '')
    .replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
}
function cleanTitle(t) {
  return String(t || '').replace(/[-ـ|/:]*\s*(?:لفضيلة|للشيخ|الشيخ|العلامة)?\s*(?:الدكتور\s*|د\.?\s*)?سعيد\s*(?:بن محمد\s*)?الكملي\s*/g, ' ')
    .replace(/[ـ]{2,}/g, 'ـ').replace(/\s{2,}/g, ' ').replace(/^[\s\-ـ|/]+|[\s\-ـ|/]+$/g, '') || t;
}
function dur(v) { return (S.p[v] && S.p[v].d) || (CAT.videos[v] && CAT.videos[v].d) || 0; }
function frac(v) {
  const p = S.p[v]; if (!p) return 0;
  if (p.done) return 1;
  const d = p.d || dur(v);
  return d ? Math.min(1, (p.t || 0) / d) : 0;
}
function seriesStats(s) {
  let sum = 0, done = 0, started = 0, total = 0, watched = 0;
  for (const v of s.videos) {
    const f = frac(v); sum += f; if (f >= 1) done++; if (f > 0) started++;
    const d = dur(v); total += d; watched += d * f;
  }
  return { pct: s.videos.length ? sum / s.videos.length : 0, done, started, total, watched, count: s.videos.length };
}
function ring(pct, size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>` +
    `<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
}
const pctTxt = p => `${n(Math.floor(p * 100))}٪`;
function toast(msg, actLabel, act) {
  const t = $('#toast'); t.textContent = msg;
  if (actLabel) {
    const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = actLabel;
    b.onclick = () => { t.classList.remove('show'); act(); }; t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), actLabel ? 6000 : 2600);
}
const catTitle = id => (CAT.categories.find(c => c.id === id) || {}).title || '';
function isNew(v) { const f = S.seen[v]; return f && f > 1 && Date.now() - f < 21 * 864e5 && !S.p[v]; }


/* ---------------- المزامنة عبر حساب Google (Firebase) ---------------- */
const CLOUD = { ready: false, user: null, db: null, ref: null, pushT: 0, applying: false, lastPushed: '' };
const FB_V = '10.12.2';
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function mergeProgress(a, b) {
  // لكل درس: الأحدث تعديلًا هو الذي يُعتمد
  const out = Object.assign({}, a);
  for (const [v, x] of Object.entries(b || {})) {
    const y = out[v];
    if (!y || (x.at || 0) > (y.at || 0)) out[v] = x;
  }
  return out;
}
async function cloudInit() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) { renderCloudBox(); return; }
  try {
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-app-compat.js`);
    await Promise.all([
      loadScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-auth-compat.js`),
      loadScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-firestore-compat.js`),
    ]);
    firebase.initializeApp(cfg);
    CLOUD.db = firebase.firestore();
    CLOUD.ready = true;
    firebase.auth().getRedirectResult().catch(e => toast('تعذّر تسجيل الدخول: ' + (e.code || '')));
    firebase.auth().onAuthStateChanged(onAuth);
  } catch (e) { console.warn('cloud init failed', e); }
  renderCloudBox();
}
let unsub = null;
async function onAuth(user) {
  CLOUD.user = user; if (unsub) { unsub(); unsub = null; }
  renderProfile();
  if (!user) return;
  CLOUD.ref = CLOUD.db.collection('users').doc(user.uid);
  let first = true;
  unsub = CLOUD.ref.onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    const before = cur && S.p[cur.v] ? S.p[cur.v].at || 0 : 0;
    const merged = mergeProgress(S.p, d.p || {});
    const changed = JSON.stringify(merged) !== JSON.stringify(S.p);
    S.p = merged;
    if (d.name && (!S.name || (d.nameAt || 0) > (S.nameAt || 0))) { S.name = d.name; S.nameAt = d.nameAt || 0; }
    if (!S.name && user.displayName) { S.name = user.displayName; S.nameAt = Date.now(); }
    if (d.last && (!S.last || (d.lastAt || 0) > (S.lastAt || 0))) { S.last = d.last; S.lastAt = d.lastAt; }
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    renderProfile();
    if (changed && CAT) refresh();
    resumeFromCloud(before);
    // ارفع ما عندي مما ليس في السحابة (أول دخول بعد تقدّم محلي)
    const remoteStr = JSON.stringify(d.p || {});
    if (first && JSON.stringify(merged) !== remoteStr) cloudPush(true);
    if (first) toast(`تمت المزامنة مع حسابك${user.displayName ? ' يا ' + user.displayName.split(' ')[0] : ''}`);
    first = false;
  }, e => console.warn('snapshot', e));
}
function cloudPush(now) {
  if (!CLOUD.ref) return;
  // خنق لا تأجيل: أثناء التشغيل يُحفظ كل ثوانٍ، فلو أُعيد ضبط المؤقّت مع كل حفظ لما وصل الموضع إلى السحابة أبدًا
  if (now) { clearTimeout(CLOUD.pushT); CLOUD.pushT = 0; return cloudWrite(); }
  if (CLOUD.pushT) return;
  CLOUD.pushT = setTimeout(() => { CLOUD.pushT = 0; cloudWrite(); }, 8000);
}
function cloudWrite() {
  {
    const payload = { p: S.p, name: S.name || '', nameAt: S.nameAt || 0, last: S.last || null, lastAt: S.lastAt || 0, updated: Date.now() };
    const str = JSON.stringify(payload.p) + payload.name + JSON.stringify(payload.last);
    if (str === CLOUD.lastPushed) return;
    CLOUD.lastPushed = str;
    CLOUD.ref.set(payload).catch(e => { CLOUD.lastPushed = ''; console.warn('push', e); });
  }
}
function resumeFromCloud(before) {
  // بدأتَ الدرس هنا من أوله ثم وصل من جهازك الآخر موضعٌ أحدث: ننتقل إليه
  if (!cur || !YTP || typeof YTP.getCurrentTime !== 'function') return;
  const p = S.p[cur.v];
  if (!p || p.done || (p.at || 0) <= before || Date.now() - cur.started > 60000) return;
  const t = YTP.getCurrentTime();
  if (p.t > t + 15) { YTP.seekTo(Math.floor(p.t - 3), true); toast(`نكمل من ${fmtDur(p.t - 3)} (من جهازك الآخر)`); }
}
function googleSignIn() {
  if (!CLOUD.ready) { toast('المزامنة غير مفعّلة بعد'); return; }
  const prov = new firebase.auth.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  // النافذة المنبثقة أوثق من إعادة التوجيه في المتصفحات التي تحجب تخزين الطرف الثالث (Safari وغيره)
  firebase.auth().signInWithPopup(prov)
    .catch(e => {
      if (e && e.code === 'auth/popup-blocked') return firebase.auth().signInWithRedirect(prov);
      if (e && e.code !== 'auth/popup-closed-by-user') toast('تعذّر تسجيل الدخول: ' + (e.code || ''));
    });
}
function googleSignOut() {
  if (!CLOUD.ready) return;
  cloudPush(true);
  setTimeout(() => firebase.auth().signOut().then(() => { CLOUD.ref = null; toast('خرجت من حسابك. يبقى تقدّمك محفوظًا في هذا الجهاز وفي حسابك.'); renderProfile(); }), 300);
}
function renderCloudBox() {
  const box = document.getElementById('cloudBox'); if (!box) return;
  if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) { box.innerHTML = ''; return; }
  if (CLOUD.user) {
    box.innerHTML = `<div class="cloud-on">✓ متصل بحساب Google: <b>${esc(CLOUD.user.email || CLOUD.user.displayName || '')}</b><br><small>تقدّمك واسمك يتزامنان تلقائيًا بين كل أجهزتك.</small></div>
      <button type="button" class="btn ghost" id="gOut">تسجيل الخروج</button>`;
    box.querySelector('#gOut').onclick = googleSignOut;
  } else {
    box.innerHTML = `<button type="button" class="btn gbtn" id="gIn"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> الدخول بحساب Google</button>
      <small class="muted">لمزامنة تقدّمك واسمك بين الجوال والكمبيوتر.</small>`;
    box.querySelector('#gIn').onclick = googleSignIn;
  }
}

/* ---------------- الملف الشخصي ---------------- */
function renderProfile() {
  const nm = (S.name || '').trim();
  const av = $('#avatar');
  if (CLOUD.user && CLOUD.user.photoURL) av.innerHTML = `<img src="${esc(CLOUD.user.photoURL)}" alt="" referrerpolicy="no-referrer">`;
  else av.textContent = nm ? [...nm][0] : '؟';
  renderCloudBox();
  $('#pname').textContent = nm || 'أضف اسمك';
  $('#profileBtn').classList.toggle('empty', !nm);
}
$('#profileBtn').onclick = () => { $('#nameInput').value = S.name || ''; $('#nameDlg').showModal(); $('#nameInput').focus(); };
$('#nameForm').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  S.name = $('#nameInput').value.trim().slice(0, 40); S.nameAt = Date.now(); save(true); renderProfile();
  if (!location.hash || location.hash === '#/' || location.hash === '#browse') route();
  toast(S.name ? `حيّاك الله يا ${S.name}` : 'حُذف الاسم');
});
renderProfile();

/* ---------------- السمة ---------------- */
function applyTheme() {
  if (S.theme) document.documentElement.dataset.theme = S.theme; else delete document.documentElement.dataset.theme;
}
$('#themeBtn').onclick = () => {
  const dark = S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  S.theme = dark ? 'light' : 'dark'; applyTheme(); save();
};
applyTheme();

/* ---------------- الصفحة الرئيسية ---------------- */
let filterCat = 'all', sortBy = 'default';
function home() {
  const all = CAT.series;
  let lessons = 0, secs = 0, doneL = 0, inProg = [], wsec = 0;
  for (const s of all) {
    const st = seriesStats(s); s._st = st;
    lessons += st.count; secs += st.total; doneL += st.done; wsec += st.watched;
    if (st.started && st.pct < 1) inProg.push(s);
  }
  const startedSeries = all.filter(s => s._st.started);
  const startedPct = startedSeries.length ? startedSeries.reduce((a, s) => a + s._st.pct * s._st.count, 0) / startedSeries.reduce((a, s) => a + s._st.count, 0) : 0;
  let last = S.last && CAT.videos[S.last.v] ? S.last : null;
  if (last && frac(last.v) >= 1) {         // أتممتَ آخر درس: اقترح التالي في سلسلته
    const sl = BY_ID[last.s], i = sl ? sl.videos.indexOf(last.v) : -1;
    const nx = sl && sl.videos.slice(i + 1).find(v => frac(v) < 1);
    last = nx ? { v: nx, s: last.s, next: true } : null;
  }
  const lastP = last && S.p[last.v];
  const lastAt = lastP && !lastP.done && lastP.t > 5 ? lastP.t : 0;
  const lastS = last && BY_ID[last.s];
  inProg.sort((a, b) => (lastActivity(b) - lastActivity(a)));


  let html = `
  <section class="hero">
    <div>
      <div class="eyebrow">${S.name ? `أهلًا بك يا ${esc(S.name)}، حيّاك الله` : 'تراث الشيخ سعيد الكملي في مكان واحد'}</div>
      <h1>مجالسُ العلم، درسًا درسًا</h1>
      <p>كل قوائم دروس الشيخ على يوتيوب من قناته وقنوات أخرى، مجموعةً بلا تكرار، يُحفظ فيها موضع توقّفك في كل درس، ويتقدّم مؤشر كل سلسلة مع كل دقيقة تسمعها.</p>
      <div class="hero-stats">
        <div class="stat"><b>${n(all.length)}</b><small>سلسلة</small></div>
        <div class="stat"><b>${n(lessons)}</b><small>درس ومقطع</small></div>
        <div class="stat"><b>${n(Math.round(secs / 3600))}</b><small>ساعة علم</small></div>
        <div class="stat"><b>${n(doneL)}</b><small>درسًا أتممتَه</small></div>
      </div>
      ${last ? `<button class="continue" data-play="${last.v}" data-s="${last.s}">
          <img src="${thumb(last.v)}" alt="" loading="lazy">
          <span><small>${last.next ? 'الدرس التالي' : lastAt ? `أكمل من حيث توقّفت · عند ${fmtDur(lastAt)}${dur(last.v) ? ' من ' + fmtDur(dur(last.v)) : ''}` : 'تابع من حيث توقّفت'}${lastS ? ' · ' + esc(lastS.title) : ''}</small>
          <b>${esc(cleanTitle(CAT.videos[last.v].t))}</b>
          <div class="mini-bar"><i style="width:${frac(last.v) * 100}%"></i></div></span>
        </button>` : `<a class="btn" href="#browse">ابدأ رحلتك مع الدروس</a>`}
    </div>
    <div class="arch">
      <div class="arch-frame"><img src="assets/sheikh.jpg" alt="الشيخ سعيد الكملي"></div>
      <div class="ring-badge" title="نسبة إنجازك في السلاسل التي بدأتها">${ring(startedPct, 106, 9)}
        <div class="val"><b>${pctTxt(startedPct)}</b><small>${startedSeries.length ? `في ${n(startedSeries.length)} سلسلة` : 'لم تبدأ بعد'}</small></div></div>
    </div>
  </section>`;

  if (inProg.length) {
    html += `<div class="section-head"><h2>سلاسلك الجارية</h2><span class="muted">${fmtHours(wsec)} من الاستماع حتى الآن</span></div>
      <div class="grid">${inProg.slice(0, 6).map(card).join('')}</div>`;
  }
  const recent = recentList();
  if (recent.length) {
    const nNew = recent.filter(isNew).length;
    html += `<div class="section-head" id="recent"><h2>أُضيف حديثًا</h2><a class="muted see-all" href="#/new">${nNew ? `${n(nNew)} جديد منذ زيارتك · ` : ''}عرض الكل (${n(recent.length)}) ←</a></div>
      <ol class="lessons">${recent.slice(0, 6).map(v => lessonRow(v, SERIES_OF[v], null)).join('')}</ol>`;
  }
  const counts = {}; all.forEach(s => counts[s.cat] = (counts[s.cat] || 0) + 1);
  html += `<div class="section-head" id="browse"><h2>كل السلاسل</h2><span class="muted">آخر تحديث للفهرس: ${updatedTxt()}</span></div>
    <div class="toolbar">
      <div class="chips" role="group" aria-label="التصنيفات">
        <button class="chip" data-cat="all" aria-pressed="${filterCat === 'all'}">الكل<span class="n">${n(all.length)}</span></button>
        ${CAT.categories.filter(c => counts[c.id]).map(c => `<button class="chip" data-cat="${c.id}" aria-pressed="${filterCat === c.id}">${esc(c.title)}<span class="n">${n(counts[c.id])}</span></button>`).join('')}
      </div>
      <select id="sortSel" aria-label="ترتيب السلاسل">
        <option value="default">الترتيب المقترح</option>
        <option value="progress">الأكثر تقدّمًا</option>
        <option value="near">الأقرب إلى الإتمام</option>
        <option value="size">الأكثر دروسًا</option>
        <option value="short">الأقصر</option>
        <option value="title">أبجديًا</option>
      </select>
    </div>
    <div class="grid" id="grid"></div>`;
  app.innerHTML = html;
  $('#sortSel').value = sortBy;
  renderGrid();
  app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    filterCat = b.dataset.cat;
    app.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderGrid();
  });
  $('#sortSel').onchange = e => { sortBy = e.target.value; renderGrid(); };
}
function fmtHoursNum(s) { return fmtHours(s); }
function lastActivity(s) { let m = 0; for (const v of s.videos) { const p = S.p[v]; if (p && p.at > m) m = p.at; } return m; }
function updatedTxt() {
  if (!CAT.updated) return '—';
  try { return new Date(CAT.updated).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return CAT.updated; }
}
function renderGrid() {
  let list = CAT.series.filter(s => filterCat === 'all' || s.cat === filterCat);
  list.forEach(s => s._st = seriesStats(s));
  const by = {
    progress: (a, b) => b._st.pct - a._st.pct,
    near: (a, b) => ((b._st.pct < 1 && b._st.pct > 0) - (a._st.pct < 1 && a._st.pct > 0)) || (b._st.pct - a._st.pct),
    size: (a, b) => b.videos.length - a.videos.length,
    short: (a, b) => a._st.total - b._st.total,
    title: (a, b) => a.title.localeCompare(b.title, 'ar'),
  }[sortBy];
  if (by) list = list.slice().sort(by);
  $('#grid').innerHTML = list.map(card).join('') || `<div class="empty">لا توجد سلاسل هنا.</div>`;
}
function card(s) {
  const st = seriesStats(s);
  const newC = s.videos.filter(isNew).length;
  return `<a class="card" href="#/s/${encodeURIComponent(s.id)}">
    <div class="card-cover"><img src="${thumb(s.videos[0])}" alt="" loading="lazy">
      <span class="card-cat">${esc(catTitle(s.cat))}</span>
      <span class="card-count">${n(st.count)} ${st.count > 10 ? 'درسًا' : 'دروس'}${st.total ? ' · ' + fmtHours(st.total) : ''}</span>
      <span class="card-ring">${ring(st.pct, 48, 5)}<b>${pctTxt(st.pct)}</b></span>
    </div>
    <div class="card-body">
      <h3>${esc(s.title)}</h3>
      <button class="card-done ${st.pct >= 1 ? 'on' : ''}" data-complete="${esc(s.id)}" title="${st.pct >= 1 ? 'إلغاء إتمام السلسلة' : 'تعليم السلسلة كاملة كمكتملة'}">${st.pct >= 1 ? '✓ مكتملة' : '✓ أتممتها'}</button>
      <div class="prog"><i style="width:${st.pct * 100}%"></i></div>
      <div class="card-meta">
        <span>أتممت ${n(st.done)} من ${n(st.count)}</span>
        ${newC ? `<span class="badge-new">${n(newC)} جديد</span>` : ''}
        ${!s.official ? `<span>من قنوات أخرى</span>` : ''}
      </div>
    </div></a>`;
}

/* ---------------- صفحة السلسلة ---------------- */
let shown = 80;
function seriesPage(id) {
  const s = BY_ID[id];
  if (!s) { app.innerHTML = `<div class="empty">لم أجد هذه السلسلة. <a href="#/">العودة للرئيسية</a></div>`; return; }
  const st = seriesStats(s);
  const nextV = s.videos.find(v => frac(v) < 1) || s.videos[0];
  const resumeTxt = st.started ? (st.pct >= 1 ? 'أعد الاستماع من البداية' : 'تابع السلسلة') : 'ابدأ السلسلة';
  const segN = Math.min(s.videos.length, 120);
  let seg = '';
  if (s.videos.length <= 120) seg = s.videos.map(v => `<i title="${esc(cleanTitle(CAT.videos[v].t))}"><s style="width:${frac(v) * 100}%"></s></i>`).join('');
  app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> · ${esc(catTitle(s.cat))}</div>
    <section class="s-head">
      <div>
        <h1>${esc(s.title)}</h1>
        <div class="meta">
          <span>${n(st.count)} درسًا</span>
          ${st.total ? `<span>${fmtHours(st.total)}</span>` : ''}
          <span>أتممت ${n(st.done)} وبدأت ${n(st.started - st.done)}</span>
          ${st.watched ? `<span>استمعت ${fmtHours(st.watched)}</span>` : ''}
        </div>
        <div class="s-actions">
          <button class="btn" data-play="${nextV}" data-s="${s.id}">▶ ${resumeTxt}</button>
          <button class="btn ghost" data-complete="${esc(s.id)}">${st.pct >= 1 ? 'إلغاء إتمام السلسلة' : '✓ أتممت السلسلة كاملة'}</button>
          <a class="btn ghost" href="https://www.youtube.com/playlist?list=${encodeURIComponent(s.sources[0]?.id || '')}" target="_blank" rel="noopener">القائمة على يوتيوب</a>
        </div>
        ${seg ? `<div class="segbar" aria-label="تقدّم كل درس">${seg}</div>` : `<div class="prog" style="margin-top:12px"><i style="width:${st.pct * 100}%"></i></div>`}
      </div>
      <div class="big-ring">${ring(st.pct, 132, 11)}<div class="val"><b>${pctTxt(st.pct)}</b><small>من السلسلة</small></div></div>
    </section>
    <ol class="lessons" id="lessons"></ol>
    <div id="more"></div>
    <p class="src">المصدر: ${s.sources.map(x => `<a href="https://www.youtube.com/playlist?list=${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${x.channel ? '@' + esc(decodeURIComponent(x.channel)) : 'قائمة تشغيل'}</a>`).join('، ')}</p>`;
  shown = Math.max(80, s.videos.indexOf(nextV) + 20);
  renderLessons(s);
}
function renderLessons(s) {
  const ol = $('#lessons');
  ol.innerHTML = s.videos.slice(0, shown).map((v, i) => lessonRow(v, s, i + 1)).join('');
  $('#more').innerHTML = s.videos.length > shown ? `<div style="text-align:center;margin-top:14px"><button class="btn ghost" id="moreBtn" style="color:var(--ink)">عرض المزيد (${n(s.videos.length - shown)} متبقٍ)</button></div>` : '';
  const mb = $('#moreBtn'); if (mb) mb.onclick = () => { shown += 120; renderLessons(s); };
  markPlaying();
}
function lessonRow(v, s, idx) {
  const x = CAT.videos[v] || { t: v, d: 0 }, f = frac(v), p = S.p[v];
  const d = dur(v);
  let sub = [];
  if (idx == null && s) sub.push(`<a class="in-series" href="#/s/${encodeURIComponent(s.id)}" title="افتح السلسلة">${esc(s.title)}</a>`);
  if (d) sub.push(fmtDur(d));
  if (p && !p.done && p.t > 5) sub.push(`توقّفت عند ${fmtDur(p.t)}`);
  if (f >= 1) sub.push('مكتمل');
  if (isNew(v)) sub.push('<span class="badge-new">جديد</span>');
  return `<li class="lesson ${f >= 1 ? 'done' : ''}" data-play="${v}" data-s="${s ? s.id : ''}">
    <span class="num">${f >= 1 ? '✓' : idx != null ? n(idx) : '▶'}</span>
    <span class="thumb"><img src="${thumb(v)}" alt="" loading="lazy">${d ? `<span class="dur">${fmtDur(d)}</span>` : ''}<span class="p"><i style="width:${f * 100}%"></i></span></span>
    <span class="t"><b>${esc(cleanTitle(x.t))}</b><small>${sub.join(' · ')}</small></span>
    <button class="tick" data-tick="${v}" title="${f >= 1 ? 'إلغاء الإتمام' : 'تعليم كمكتمل'}" aria-label="${f >= 1 ? 'إلغاء الإتمام' : 'تعليم كمكتمل'}"><svg viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.4z"/></svg></button>
  </li>`;
}

/* ---------------- أُضيف حديثًا ---------------- */
// أحدث ما رُفع على القناة (الأحدث أولًا) ثم ما ظهر جديدًا منذ زيارتك. عرضٌ فقط: كل درس يبقى في سلسلته الأصلية.
function recentList() {
  const out = [], seen = new Set();
  for (const v of CAT.latest || []) if (CAT.videos[v] && SERIES_OF[v] && !seen.has(v)) { seen.add(v); out.push(v); }
  const extra = Object.keys(CAT.videos).filter(v => isNew(v) && !seen.has(v) && SERIES_OF[v]).sort((a, b) => S.seen[b] - S.seen[a]);
  return out.concat(extra);
}
function newPage() {
  const list = recentList();
  app.innerHTML = `<div class="section-head" style="margin-top:6px"><h2>أُضيف حديثًا</h2><span class="muted">${n(list.length)} درسًا · آخر تحديث: ${updatedTxt()}</span></div>
    <p class="muted new-note">أحدث ما رُفع من دروس الشيخ، الأحدث أولًا. كل درس هنا باقٍ في سلسلته الأصلية، واسمها مكتوب تحته، وتقدّمك فيه واحد في الموضعين.</p>
    ${list.length ? `<ol class="lessons">${list.map(v => lessonRow(v, SERIES_OF[v], null)).join('')}</ol>` : `<div class="empty">لا جديد الآن.</div>`}`;
  markPlaying();
}
function updateNewBadge() {
  const b = $('#newCount'); if (!b || !CAT) return;
  const k = recentList().filter(isNew).length;
  b.textContent = k ? n(k) : ''; b.hidden = !k;
}

/* ---------------- البحث ---------------- */
function searchPage(q) {
  const k = normAr(q.trim()); if (!k) { location.hash = '#/'; return; }
  const words = k.split(/\s+/);
  const match = t => { const nt = normAr(t); return words.every(w => nt.includes(w)); };
  const ss = CAT.series.filter(s => match(s.title));
  const ls = [];
  for (const [v, x] of Object.entries(CAT.videos)) { if (match(x.t)) { ls.push(v); if (ls.length >= 150) break; } }
  app.innerHTML = `<div class="section-head" style="margin-top:6px"><h2>نتائج «${esc(q)}»</h2><span class="muted">${n(ss.length)} سلسلة · ${n(ls.length)}${ls.length >= 150 ? '+' : ''} درس</span></div>
    ${ss.length ? `<div class="grid">${ss.map(card).join('')}</div>` : ''}
    ${ls.length ? `<div class="section-head"><h2>الدروس</h2></div><ol class="lessons">${ls.map(v => lessonRow(v, SERIES_OF[v], null)).join('')}</ol>` : ''}
    ${!ss.length && !ls.length ? `<div class="empty">لا نتائج. جرّب كلمة أخرى.</div>` : ''}`;
  markPlaying();
}
let qT = 0;
$('#q').addEventListener('input', e => {
  clearTimeout(qT); const v = e.target.value;
  qT = setTimeout(() => { location.hash = v.trim() ? '#/q/' + encodeURIComponent(v) : '#/'; }, 250);
});

/* ---------------- التوجيه ---------------- */
function route() {
  if (!CAT) return;
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('/s/')) seriesPage(h.slice(3));
  else if (h.startsWith('/q/')) { const q = h.slice(3); if ($('#q').value !== q) $('#q').value = q; searchPage(q); }
  else if (h === '/new') newPage();
  else if (h === 'browse') { home(); $('#browse')?.scrollIntoView(); return; }
  else { home(); }
  if (!h.startsWith('/q/')) $('#q').value = '';
  document.querySelectorAll('.nav-new').forEach(a => a.classList.toggle('on', h === '/new'));
  updateNewBadge();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------- النقرات ---------------- */
app.addEventListener('click', e => {
  if (e.target.closest('a.in-series')) return;
  const comp = e.target.closest('[data-complete]');
  if (comp) {
    e.preventDefault(); e.stopPropagation();
    const s = BY_ID[comp.dataset.complete]; if (!s) return;
    const allDone = seriesStats(s).pct >= 1;
    if (allDone && !confirm(`إلغاء إتمام «${s.title}» وإرجاع كل دروسها غير مكتملة؟`)) return;
    const before = {}; s.videos.forEach(v => before[v] = S.p[v] ? Object.assign({}, S.p[v]) : null);
    const now = Date.now();
    s.videos.forEach(v => {
      const p = S.p[v] || (S.p[v] = { t: 0 });
      p.done = !allDone; if (allDone) p.t = 0; p.at = now;
    });
    save(); CAT.series.forEach(x => delete x._st); refresh();
    toast(allDone ? 'أُلغي إتمام السلسلة' : `أتممت «${s.title}» كاملة`, 'تراجع', () => {
      for (const [v, p] of Object.entries(before)) { if (p) S.p[v] = p; else delete S.p[v]; }
      save(); CAT.series.forEach(x => delete x._st); refresh();
    });
    return;
  }
  const tick = e.target.closest('[data-tick]');
  if (tick) {
    e.preventDefault(); e.stopPropagation();
    const v = tick.dataset.tick, p = S.p[v] || (S.p[v] = { t: 0 });
    p.done = !p.done; if (!p.done) p.t = 0; p.at = Date.now(); save();
    refresh(); toast(p.done ? 'أُضيف الدرس إلى ما أتممته' : 'أُلغي تعليم الدرس');
    return;
  }
  const pl = e.target.closest('[data-play]');
  if (pl) { e.preventDefault(); play(pl.dataset.play, pl.dataset.s || (SERIES_OF[pl.dataset.play] || {}).id); }
});
function refresh() {
  const y = window.scrollY;
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('/s/')) {
    const keep = shown; seriesPage(h.slice(3)); shown = keep; renderLessons(BY_ID[h.slice(3)]);
  } else route();
  window.scrollTo(0, y);
}

/* ---------------- المشغّل ---------------- */
let YTP = null, ytReady = null, cur = null, tick = 0;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise(res => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytReady;
}
async function play(v, sid) {
  const s = BY_ID[sid] || SERIES_OF[v];
  cur = { v, s: s ? s.id : null, started: Date.now() };
  const dock = $('#playerDock'); dock.hidden = false; dock.classList.remove('min');
  $('#pTitle').textContent = cleanTitle(CAT.videos[v]?.t || '');
  $('#pSeries').textContent = s ? s.title : '';
  const p = S.p[v];
  const start = p && !p.done && p.t > 5 ? Math.floor(p.t - 3) : 0;
  S.last = { v, s: cur.s }; S.lastAt = Date.now(); save();
  markPlaying(); updateDoneBtn();
  await loadYT();
  if (!YTP) {
    YTP = new YT.Player('ytPlayer', {
      videoId: v, host: 'https://www.youtube.com',  // youtube.com (لا nocookie) ليصل حساب المشاهد فيعمل اشتراك Premium بلا إعلانات
      playerVars: { start, autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, hl: 'ar' },
      events: {
        onReady: e => { try { e.target.setPlaybackRate(S.rate || 1); } catch (x) {} e.target.playVideo(); },
        onStateChange: onState,
        onPlaybackRateChange: e => { S.rate = e.data; save(); },
      },
    });
  } else {
    YTP.loadVideoById({ videoId: v, startSeconds: start });
  }
  if (start) toast(`نكمل من ${fmtDur(start)}`);
  clearInterval(tick); tick = setInterval(track, 4000);
}
function track(force) {
  if (!YTP || !cur || typeof YTP.getCurrentTime !== 'function') return;
  const st = YTP.getPlayerState();
  if (!(st === 1 || (force && (st === 2 || st === 3)))) return;
  const t = YTP.getCurrentTime(), d = YTP.getDuration();
  if (!(t > 0)) return;
  const p = S.p[cur.v] || (S.p[cur.v] = { t: 0 });
  p.t = t; if (d) p.d = Math.round(d); p.at = Date.now();
  if (d && t / d >= DONE_AT && !p.done) { p.done = true; toast('أحسنت! أتممت هذا الدرس'); refreshSoft(); }
  $('#pBar').style.width = d ? (t / d * 100) + '%' : 0;
  save();
  liveUpdate();
}
function onState(e) {
  if (e.data === 0 && cur) {      // انتهى
    const p = S.p[cur.v] || (S.p[cur.v] = {}); p.done = true; p.at = Date.now(); save(true);
    refreshSoft();
    const nx = neighbor(1);
    if (nx) { toast('ننتقل إلى الدرس التالي…'); setTimeout(() => play(nx, cur.s), 2500); }
  }
  if (e.data === 2) { track(true); save(true); }
}
function neighbor(dir) {
  if (!cur) return null; const s = BY_ID[cur.s]; if (!s) return null;
  const i = s.videos.indexOf(cur.v); return s.videos[i + dir] || null;
}
function liveUpdate() {
  // تحديث شريط الدرس الحالي دون إعادة رسم الصفحة
  if (!cur) return;
  document.querySelectorAll(`.lesson[data-play="${cur.v}"] .p i`).forEach(i => i.style.width = frac(cur.v) * 100 + '%');
}
function refreshSoft() { updateDoneBtn(); refresh(); }
function markPlaying() {
  document.querySelectorAll('.lesson.playing').forEach(x => x.classList.remove('playing'));
  if (cur) document.querySelectorAll(`.lesson[data-play="${cur.v}"]`).forEach(x => x.classList.add('playing'));
}
function updateDoneBtn() {
  if (!cur) return;
  $('#pDone').textContent = frac(cur.v) >= 1 ? 'مكتمل ✓' : 'أتممته ✓';
  $('#pPrev').disabled = !neighbor(-1); $('#pNext').disabled = !neighbor(1);
}
$('#pDone').onclick = () => {
  if (!cur) return; const p = S.p[cur.v] || (S.p[cur.v] = { t: 0 });
  p.done = !p.done; p.at = Date.now(); save(); refreshSoft();
};
$('#pNext').onclick = () => { const v = neighbor(1); if (v) play(v, cur.s); };
$('#pPrev').onclick = () => { const v = neighbor(-1); if (v) play(v, cur.s); };
$('#pMin').onclick = () => $('#playerDock').classList.toggle('min');
$('#pClose').onclick = () => { track(true); save(true); try { YTP && YTP.pauseVideo(); } catch (e) {} $('#playerDock').hidden = true; clearInterval(tick); };
$('#pTitle').onclick = () => { if (cur && cur.s) location.hash = '#/s/' + encodeURIComponent(cur.s); };
// عند إغلاق الموقع أو الانتقال عنه: احفظ الموضع فورًا محليًا وفي السحابة
const flush = () => { track(true); save(true); cloudPush(true); };
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ---------------- التصدير والاستيراد ---------------- */
const dlg = $('#dataDlg');
$('#menuBtn').onclick = () => { $('#updatedAt').textContent = 'آخر تحديث لفهرس الدروس: ' + updatedTxt(); dlg.showModal(); };
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'kamali', version: 1, exported: new Date().toISOString(), name: S.name || '', progress: S.p }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${S.name ? S.name + '-' : ''}تقدمي-دروس-الكملي-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); const p = j.progress || j.p;
    if (!p || typeof p !== 'object') throw 0;
    let c = 0;
    for (const [v, x] of Object.entries(p)) {
      const mine = S.p[v];
      if (!mine || (x.done && !mine.done) || ((x.t || 0) > (mine.t || 0) && !mine.done)) { S.p[v] = x; c++; }
    }
    if (j.name && !S.name) { S.name = String(j.name).slice(0, 40); renderProfile(); }
    save(true); dlg.close(); refresh(); toast(`استُورد التقدّم (${n(c)} درسًا)`);
  } catch (err) { toast('تعذّرت قراءة الملف'); }
  e.target.value = '';
};
$('#resetBtn').onclick = () => {
  if (!confirm('سيُمسح كل تقدّمك في هذا المتصفّح. هل أنت متأكد؟')) return;
  const now = Date.now();
  for (const v in S.p) S.p[v] = { t: 0, done: false, at: now };
  S.last = null; S.lastAt = now; save(true); dlg.close(); refresh();
};
dlg.querySelector('.close').onclick = () => dlg.close();

/* ---------------- التشغيل ---------------- */
const APP_V = '11';
async function checkVersion() {
  try {
    const v = (await (await fetch('version.txt', { cache: 'no-store' })).text()).trim();
    if (v && v !== APP_V && sessionStorage.getItem('kamali.reloaded') !== v) {
      sessionStorage.setItem('kamali.reloaded', v); location.reload();
    }
  } catch (e) {}
}
async function init() {
  checkVersion();
  cloudInit();
  app.innerHTML = `<div class="empty">جارٍ تحميل الدروس…</div>`;
  try {
    const r = await fetch('catalog.json', { cache: 'no-cache' });
    CAT = await r.json();
  } catch (e) {
    app.innerHTML = `<div class="empty">تعذّر تحميل فهرس الدروس. حدّث الصفحة.</div>`; return;
  }
  for (const s of CAT.series) { BY_ID[s.id] = s; for (const v of s.videos) if (!SERIES_OF[v]) SERIES_OF[v] = s; }
  // تسجيل الدروس الجديدة منذ الزيارة السابقة
  const first = S.fresh || !Object.keys(S.seen).length;
  const now = Date.now();
  for (const v in CAT.videos) if (!S.seen[v]) S.seen[v] = first ? 1 : now;
  delete S.fresh; save();
  route();
}
init();
})();
