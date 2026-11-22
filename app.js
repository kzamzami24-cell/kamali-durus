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
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const catTitle = id => (CAT.categories.find(c => c.id === id) || {}).title || '';
function isNew(v) { const f = S.seen[v]; return f && f > 1 && Date.now() - f < 21 * 864e5 && !S.p[v]; }

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
  const last = S.last && CAT.videos[S.last.v] ? S.last : null;
  const lastS = last && BY_ID[last.s];
  inProg.sort((a, b) => (lastActivity(b) - lastActivity(a)));

  const newOnes = Object.keys(CAT.videos).filter(isNew);

  let html = `
  <section class="hero">
    <div>
      <div class="eyebrow">تراث الشيخ سعيد الكملي في مكان واحد</div>
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
          <span><small>تابع من حيث توقّفت${lastS ? ' · ' + esc(lastS.title) : ''}</small>
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
    html += `<div class="section-head"><h2>سلاسلك الجارية</h2><span class="muted">${n(fmtHoursNum(wsec))} من الاستماع حتى الآن</span></div>
      <div class="grid">${inProg.slice(0, 6).map(card).join('')}</div>`;
  }
  if (newOnes.length) {
    html += `<div class="section-head"><h2>أُضيف حديثًا</h2><span class="muted">دروس جديدة منذ زيارتك السابقة</span></div>
      <div class="results">${newOnes.slice(0, 12).map(v => lessonRow(v, SERIES_OF[v], null)).join('')}</div>`;
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
  list.forEach(s => s._st = s._st || seriesStats(s));
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
  const st = s._st || seriesStats(s);
  const newC = s.videos.filter(isNew).length;
  return `<a class="card" href="#/s/${encodeURIComponent(s.id)}">
    <div class="card-cover"><img src="${thumb(s.videos[0])}" alt="" loading="lazy">
      <span class="card-cat">${esc(catTitle(s.cat))}</span>
      <span class="card-count">${n(st.count)} ${st.count > 10 ? 'درسًا' : 'دروس'}${st.total ? ' · ' + fmtHours(st.total) : ''}</span>
      <span class="card-ring">${ring(st.pct, 48, 5)}<b>${pctTxt(st.pct)}</b></span>
    </div>
    <div class="card-body">
      <h3>${esc(s.title)}</h3>
      <div class="prog"><i style="width:${st.pct * 100}%"></i></div>
      <div class="card-meta">
        <span>أتممت ${n(st.done)} من ${n(st.count)}</span>
        ${newC ? `<span class="badge-new">${n(newC)} جديد</span>` : ''}
        ${st.pct >= 1 ? `<span class="badge-done">مكتملة</span>` : ''}
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
  if (idx == null && s) sub.push(esc(s.title));
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
  else if (h === 'browse') { home(); $('#browse')?.scrollIntoView(); return; }
  else { home(); }
  if (!h.startsWith('/q/')) $('#q').value = '';
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------- النقرات ---------------- */
app.addEventListener('click', e => {
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
  cur = { v, s: s ? s.id : null };
  const dock = $('#playerDock'); dock.hidden = false; dock.classList.remove('min');
  $('#pTitle').textContent = cleanTitle(CAT.videos[v]?.t || '');
  $('#pSeries').textContent = s ? s.title : '';
  const p = S.p[v];
  const start = p && !p.done && p.t > 5 ? Math.floor(p.t - 3) : 0;
  S.last = { v, s: cur.s }; save();
  markPlaying(); updateDoneBtn();
  await loadYT();
  if (!YTP) {
    YTP = new YT.Player('ytPlayer', {
      videoId: v, host: 'https://www.youtube-nocookie.com',
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
function track() {
  if (!YTP || !cur || typeof YTP.getCurrentTime !== 'function') return;
  if (YTP.getPlayerState() !== 1) return;
  const t = YTP.getCurrentTime(), d = YTP.getDuration();
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
  if (e.data === 2) { track(); save(true); }
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
$('#pClose').onclick = () => { track(); save(true); try { YTP && YTP.pauseVideo(); } catch (e) {} $('#playerDock').hidden = true; clearInterval(tick); };
$('#pTitle').onclick = () => { if (cur && cur.s) location.hash = '#/s/' + encodeURIComponent(cur.s); };
window.addEventListener('pagehide', () => { track(); save(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { track(); save(true); } });

/* ---------------- التصدير والاستيراد ---------------- */
const dlg = $('#dataDlg');
$('#menuBtn').onclick = () => { $('#updatedAt').textContent = 'آخر تحديث لفهرس الدروس: ' + updatedTxt(); dlg.showModal(); };
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'kamali', version: 1, exported: new Date().toISOString(), progress: S.p }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `تقدمي-دروس-الكملي-${new Date().toISOString().slice(0, 10)}.json`; a.click();
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
    save(true); dlg.close(); refresh(); toast(`استُورد التقدّم (${n(c)} درسًا)`);
  } catch (err) { toast('تعذّرت قراءة الملف'); }
  e.target.value = '';
};
$('#resetBtn').onclick = () => {
  if (!confirm('سيُمسح كل تقدّمك في هذا المتصفّح. هل أنت متأكد؟')) return;
  S.p = {}; S.last = null; save(true); dlg.close(); refresh();
};
dlg.querySelector('.close').onclick = () => dlg.close();

/* ---------------- التشغيل ---------------- */
async function init() {
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
