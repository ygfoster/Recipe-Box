'use strict';

/* =========================================================
   Recipe Box — データはこのブラウザの IndexedDB に保存
   ========================================================= */

const GENRES = ['和食', '洋食', '中華', '韓国', 'エスニック', 'その他'];
const COURSES = ['主菜', '副菜', '汁物', '主食', 'デザート', 'おつまみ'];
const $ = (s) => document.querySelector(s);

// 並び順・絞り込みなど、この端末だけの表示設定
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('rb:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rb:' + k, JSON.stringify(v)); } catch { /* 保存できなくても動作は続ける */ } },
};

const state = {
  recipes: [],
  query: '',
  genre: 'all',
  course: 'all',
  fav: prefs.get('fav', false),
  time: prefs.get('time', 0),
  sort: prefs.get('sort', 'new'),
  editingId: null,
  photo: null,
  formGenre: '',
  formCourse: '',
  detailId: null,
  servings: 2,
  sugIndex: -1,
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.8 1.3-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.4 2.85 1-6L3.3 9.6l6-.9z"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9.5v4l2.5 1.8M10 2.5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chef: '<svg viewBox="0 0 24 24"><path d="M7 14.5a4 4 0 01-.9-7.9A5 5 0 0112 3a5 5 0 015.9 3.6 4 4 0 01-.9 7.9V20H7z M7 17h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  resume: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
};

/* ---------------- IndexedDB ---------------- */
const db = (() => {
  let conn;
  const open = () => conn || (conn = new Promise((res, rej) => {
    const req = indexedDB.open('recipe-box', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recipes', { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('recipes', mode);
      const out = fn(t.objectStore('recipes'));
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    put: (r) => tx('readwrite', (s) => s.put(r)),
    del: (id) => tx('readwrite', (s) => s.delete(id)),
  };
})();

/* ---------------- Utils ---------------- */
// 全角/半角・大文字/小文字・カタカナ/ひらがなの違いを吸収
const norm = (s) => (s || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lines = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const getRecipe = (id) => state.recipes.find((r) => r.id === id);
const todayStr = () => new Date().toLocaleDateString('sv-SE');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function iconBtn(cls, icon, label) {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = ICON[icon];
  if (label) b.append(label);
  return b;
}

// アニメーション用クラスを付け直して再生
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function compressImage(file, max = 1400, quality = 0.84) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

function makeImg(src, cls) {
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  if (cls) img.className = cls;
  img.onload = () => img.classList.add('loaded');
  img.src = src;
  return img;
}

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  const now = new Date();
  return (y === now.getFullYear() ? '' : `${y}年`) + `${m}月${day}日`;
}

function daysAgo(d) {
  const diff = Math.round((new Date(todayStr()) - new Date(d)) / 864e5);
  return diff <= 0 ? '今日' : diff === 1 ? '昨日' : `${diff}日前`;
}

/* ---------------- データ整形 ---------------- */
function normalizeRecipe(r) {
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const img = (v) => (typeof v === 'string' && v.startsWith('data:image/') ? v : null);
  return {
    id: s(r.id) || uid(),
    name: s(r.name).trim() || '無題のレシピ',
    genre: s(r.genre || r.category) || 'その他',
    course: s(r.course),
    time: +r.time > 0 ? Math.round(+r.time) : null,
    servings: +r.servings > 0 ? Math.round(+r.servings) : 2,
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map(s).map((t) => t.trim()).filter(Boolean))].slice(0, 20) : [],
    photo: img(r.photo),
    videoUrl: s(r.videoUrl).trim(),
    ingredients: s(r.ingredients),
    steps: s(r.steps),
    memo: s(r.memo),
    favorite: !!r.favorite,
    rating: Math.max(0, Math.min(5, Math.round(+r.rating || 0))),
    cooked: Array.isArray(r.cooked)
      ? r.cooked.filter((c) => c && /^\d{4}-\d{2}-\d{2}/.test(s(c.date)))
        .map((c) => ({ id: s(c.id) || uid(), date: s(c.date).slice(0, 10), note: s(c.note), photo: img(c.photo) }))
      : [],
    createdAt: +r.createdAt || Date.now(),
    updatedAt: +r.updatedAt || Date.now(),
  };
}

async function saveRecipe(r) {
  await db.put(r);
  state.recipes = state.recipes.map((x) => (x.id === r.id ? r : x));
  refreshCard(r.id);
}

/* ---------------- 動画 ---------------- */
function parseT(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function videoInfo(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com')) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)/) || [])[1];
  }
  if (id && /^[\w-]{6,}$/.test(id)) {
    return { type: 'youtube', id, url: u.href, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, start: parseT(u.searchParams.get('t')) };
  }
  const label = /instagram/.test(host) ? 'Instagram' : /tiktok/.test(host) ? 'TikTok'
    : /(^|\.)x\.com$|twitter/.test(host) ? 'X' : /youtube/.test(host) ? 'YouTube' : host;
  return { type: 'link', url: u.href, label };
}

async function fetchVideoTitle(url) {
  const eps = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
  ];
  for (const ep of eps) {
    try {
      const res = await fetch(ep);
      if (!res.ok) continue;
      const j = await res.json();
      if (j.title) return j.title;
    } catch { /* 次の取得先を試す */ }
  }
  return null;
}

/* ---------------- 材料・手順の解析 ---------------- */
const AMOUNT_WORDS = '少々|適量|適宜|ひとつまみ|お好みで|少量|たっぷり|ひとかけ';
const ING_RE = new RegExp(`^(.+?)[\\s:・…]*((?:大さじ|小さじ|カップ|約)?\\s*\\d[\\d.\\/]*.*|${AMOUNT_WORDS})$`);
const NUM_RE = /(\d+)と(\d+)\/(\d+)|(\d+(?:\.\d+)?)(?:\/(\d+))?/g;

function parseIngredient(line) {
  const s = line.normalize('NFKC').replace(/⁄/g, '/').trim();
  if (/^[【[<＜■◆●◇]/.test(s)) return { header: true, name: s.replace(/^[【[<＜■◆●◇]\s*|\s*[】\]>＞]$/g, '') };
  const m = s.match(ING_RE);
  return { name: (m ? m[1] : s).trim(), amount: m ? m[2].trim() : '' };
}

function fmtNum(x) {
  if (x >= 10) return String(Math.round(x));
  const w = Math.floor(x + 1e-9);
  const f = x - w;
  const fr = [[0, ''], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '']];
  for (const [v, str] of fr) {
    if (Math.abs(f - v) < 0.04) {
      const W = v === 1 ? w + 1 : w;
      if (!str) return String(W);
      return W ? `${W}と${str}` : str;
    }
  }
  return String(Math.round(x * 10) / 10);
}

// 量の中の数字をすべて k 倍する(「1枚(300g)」→「2枚(600g)」)
function scaleAmount(amount, k) {
  if (k === 1) return amount;
  return amount.replace(NUM_RE, (all, a, b, c, n, d) => {
    const v = a ? +a + +b / +c : +n / (d ? +d : 1);
    return fmtNum(v * k);
  });
}

const toSec = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);
const fmtClock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(s).padStart(2, '0');
};

function parseStep(line) {
  const s = line.normalize('NFKC');
  const m = s.match(/^[[(【]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[\])】]?\s*[-–—:]?\s*(.*)$/);
  if (m && m[2]) return { t: toSec(m[1]), text: m[2] };
  return { t: null, text: s };
}

// 「10分煮る」「1時間30分」などからタイマー候補を拾う
function findDurations(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*時間(?:\s*(\d+)\s*分)?|(\d+(?:\.\d+)?)\s*分(?:\s*(\d+)\s*秒)?|(\d+)\s*秒/g;
  let m;
  while ((m = re.exec(text))) {
    const sec = m[1] ? m[1] * 3600 + (+m[2] || 0) * 60 : m[3] ? m[3] * 60 + (+m[4] || 0) : +m[5];
    if (sec >= 5 && sec <= 6 * 3600) out.push({ sec, label: m[0].replace(/\s/g, '') });
  }
  return out;
}

/* ---------------- Search ---------------- */
function haystack(r) {
  return norm([r.name, r.genre, r.course, r.tags.map((t) => '#' + t).join(' '), r.ingredients, r.memo].join(' '));
}

function matches(r) {
  if (state.genre !== 'all' && r.genre !== state.genre) return false;
  if (state.course !== 'all' && r.course !== state.course) return false;
  if (state.fav && !r.favorite) return false;
  if (state.time && !(r.time && r.time <= state.time)) return false;
  const tokens = norm(state.query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const h = haystack(r);
  return tokens.every((t) => h.includes(t));
}

function allTags() {
  const count = new Map();
  state.recipes.forEach((r) => r.tags.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  return [...count].sort((a, b) => b[1] - a[1]);
}

function suggestions(q) {
  const raw = q.trim();
  if (raw.startsWith('#') || raw.startsWith('＃')) {
    const nq = norm(raw.slice(1));
    return allTags().filter(([t]) => norm(t).includes(nq)).slice(0, 6).map(([tag, n]) => ({ tag, n }));
  }
  const nq = norm(raw);
  if (!nq) return [];
  return state.recipes
    .map((r) => {
      const i = norm(r.name).indexOf(nq);
      let score;
      if (i === 0) score = 0;
      else if (i > 0) score = 1;
      else if (haystack(r).includes(nq)) score = 2;
      else return null;
      return { r, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length)
    .slice(0, 6);
}

/* ---------------- Grid (FLIP アニメーション付き) ---------------- */
const cardNodes = new Map();

function heroImage(r, cls) {
  if (r.photo) return makeImg(r.photo, cls);
  const v = videoInfo(r.videoUrl);
  if (v && v.thumb) {
    const img = makeImg(v.thumb, ((cls || '') + ' yt').trim());
    img.referrerPolicy = 'no-referrer';
    return img;
  }
  return null;
}

function makeCard(r) {
  const card = el('article', 'card');
  card.tabIndex = 0;
  card.dataset.id = r.id;
  const imgWrap = el('div', 'card-img');
  const img = heroImage(r);
  if (img) imgWrap.append(img); else imgWrap.append('🍽');
  if (videoInfo(r.videoUrl)) {
    const b = el('span', 'badge-play');
    b.innerHTML = ICON.play;
    b.append('動画');
    imgWrap.append(b);
  }
  const fav = iconBtn('fav' + (r.favorite ? ' on' : ''), 'heart');
  fav.setAttribute('aria-label', 'お気に入り');
  fav.setAttribute('aria-pressed', String(r.favorite));
  imgWrap.append(fav);

  const body = el('div', 'card-body');
  const meta = el('p');
  meta.append([r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · '));
  if (r.rating) meta.append(el('span', 'mini-star', `★${r.rating}`));
  body.append(el('h3', null, r.name), meta);
  card.append(imgWrap, body);
  return card;
}

// 中身が変わったカードを、その場で差し替える
function refreshCard(id) {
  const old = cardNodes.get(id);
  const r = getRecipe(id);
  if (!old || !r) return;
  const n = makeCard(r);
  n.hidden = old.hidden;
  n.querySelectorAll('img').forEach((i) => i.classList.add('loaded'));
  old.replaceWith(n);
  cardNodes.set(id, n);
}

function removeCardNode(id) {
  const n = cardNodes.get(id);
  if (n) n.remove();
  cardNodes.delete(id);
}

const lastCooked = (r) => r.cooked.reduce((m, c) => (c.date > m ? c.date : m), '');
const SORTS = {
  new: (a, b) => b.createdAt - a.createdAt,
  rating: (a, b) => b.rating - a.rating || b.favorite - a.favorite || b.createdAt - a.createdAt,
  cooked: (a, b) => b.cooked.length - a.cooked.length || b.createdAt - a.createdAt,
  stale: (a, b) => lastCooked(a).localeCompare(lastCooked(b)) || b.createdAt - a.createdAt,
  time: (a, b) => (a.time || 1e9) - (b.time || 1e9) || b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, 'ja'),
};

function renderGrid() {
  const grid = $('#grid');
  const before = new Map();
  cardNodes.forEach((node, id) => {
    if (!node.hidden && node.isConnected) before.set(id, node.getBoundingClientRect());
  });

  const list = [...state.recipes].sort(SORTS[state.sort] || SORTS.new);
  const visible = [];
  list.forEach((r) => {
    let node = cardNodes.get(r.id);
    if (!node) { node = makeCard(r); cardNodes.set(r.id, node); }
    node.hidden = !matches(r);
    grid.append(node); // 並び順を反映
    if (!node.hidden) visible.push(node);
  });

  // FLIP: 残ったカードは新しい位置へ滑らかに移動、新しく現れたカードはふわっと登場
  let newIdx = 0;
  visible.forEach((node) => {
    const prev = before.get(node.dataset.id);
    const now = node.getBoundingClientRect();
    if (prev) {
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (dx || dy) {
        node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      }
    } else {
      node.animate(
        [
          { opacity: 0, transform: 'translateY(24px) scale(.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 650, delay: Math.min(newIdx++, 12) * 45, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
      );
    }
  });

  renderCount(visible.length);
  renderEmpty(visible.length);
}

function renderCount(n) {
  const total = state.recipes.length;
  $('#count').textContent = total ? (n === total ? `${total} 件のレシピ` : `${n} / ${total} 件`) : '';
  $('#toolbar').hidden = !total;
}

function renderEmpty(n) {
  const empty = $('#empty');
  if (n) { empty.hidden = true; return; }
  empty.hidden = false;
  const none = !state.recipes.length;
  $('#emptyTitle').textContent = none ? 'まだレシピがありません' : '見つかりませんでした';
  $('#emptyText').textContent = none
    ? '写真や動画のURLと料理名を登録して、自分だけのレシピ帳をつくりましょう。'
    : state.query ? `「${state.query}」に一致するレシピはありません。` : 'この条件に合うレシピはまだありません。';
  $('#emptyAdd').hidden = !none;
  replay(empty, 'empty');
}

/* ---------------- 絞り込み(ジャンル・種類・ツールバー) ---------------- */
function allGenres() {
  return [...new Set([...GENRES, ...state.recipes.map((r) => r.genre).filter(Boolean)])];
}
function allCourses() {
  return [...new Set([...COURSES, ...state.recipes.map((r) => r.course).filter(Boolean)])];
}

function renderChipRow(box, key, values) {
  box.innerHTML = '';
  const counts = {};
  state.recipes.forEach((r) => { if (r[key]) counts[r[key]] = (counts[r[key]] || 0) + 1; });
  const cats = values.filter((c) => counts[c]);
  if (state[key] !== 'all' && !counts[state[key]]) state[key] = 'all';
  box.hidden = !cats.length;

  const add = (val, label, n) => {
    const b = el('button', 'chip' + (state[key] === val ? ' active' : ''), label);
    b.type = 'button';
    b.append(el('span', 'n', String(n)));
    b.onclick = () => {
      if (state[key] === val) return;
      state[key] = val;
      box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      renderGrid();
    };
    box.append(b);
  };
  add('all', 'すべて', state.recipes.filter((r) => key === 'genre' || r[key]).length);
  cats.forEach((c) => add(c, c, counts[c]));
}

function renderChips() {
  renderChipRow($('#genreChips'), 'genre', allGenres());
  renderChipRow($('#courseChips'), 'course', allCourses());
}

function syncTools() {
  $('#favFilter').setAttribute('aria-pressed', String(state.fav));
  $('#timeFilter').value = String(state.time);
  $('#timeFilter').parentElement.classList.toggle('on', !!state.time);
  $('#sortSel').value = state.sort;
}

$('#favFilter').addEventListener('click', (e) => {
  state.fav = !state.fav;
  prefs.set('fav', state.fav);
  syncTools();
  replay(e.currentTarget, 'pop');
  renderGrid();
});
$('#timeFilter').addEventListener('change', (e) => {
  state.time = +e.target.value;
  prefs.set('time', state.time);
  syncTools();
  renderGrid();
});
$('#sortSel').addEventListener('change', (e) => {
  state.sort = e.target.value;
  prefs.set('sort', state.sort);
  renderGrid();
});

/* ---------------- Suggest (予測変換) ---------------- */
const qInput = $('#q');
const sugBox = $('#suggest');
const searchBox = $('#search');

function highlight(name, q) {
  const frag = document.createDocumentFragment();
  const nn = norm(name);
  const nq = norm(q.trim());
  const i = nn.indexOf(nq);
  // 正規化で長さが変わらない場合のみハイライト位置を元の文字列に対応させる
  if (i < 0 || nn.length !== name.length) { frag.append(name); return frag; }
  frag.append(name.slice(0, i), el('mark', null, name.slice(i, i + nq.length)), name.slice(i + nq.length));
  return frag;
}

function setQuery(v) {
  qInput.value = v;
  state.query = v;
  searchBox.classList.toggle('has-text', !!v);
  renderGrid();
}

function renderSuggest() {
  const items = suggestions(qInput.value);
  sugBox.innerHTML = '';
  state.sugIndex = -1;
  items.forEach((item, i) => {
    const li = el('li');
    li.setAttribute('role', 'option');
    li.style.setProperty('--i', i);
    const thumb = el('span', 'thumb');
    if (item.tag) {
      thumb.textContent = '#';
      li.append(thumb, el('span', 's-name', item.tag), el('span', 's-cat', `${item.n}件`));
      li._pick = () => { closeSuggest(); qInput.blur(); setQuery('#' + item.tag); };
    } else {
      const r = item.r;
      const img = heroImage(r);
      if (img) thumb.append(img); else thumb.textContent = '🍽';
      const name = el('span', 's-name');
      name.append(highlight(r.name, qInput.value));
      li.append(thumb, name, el('span', 's-cat', r.genre || ''));
      li._pick = () => { closeSuggest(); qInput.blur(); openDetail(r.id, li); };
    }
    li.addEventListener('mousedown', (e) => { e.preventDefault(); li._pick(); });
    sugBox.append(li);
  });
  const open = items.length > 0 && document.activeElement === qInput;
  sugBox.classList.toggle('open', open);
  qInput.setAttribute('aria-expanded', String(open));
}

function closeSuggest() {
  sugBox.classList.remove('open');
  qInput.setAttribute('aria-expanded', 'false');
  state.sugIndex = -1;
}

function moveSug(d) {
  const lis = [...sugBox.children];
  if (!lis.length) return;
  state.sugIndex = (state.sugIndex + d + lis.length) % lis.length;
  lis.forEach((li, i) => li.classList.toggle('active', i === state.sugIndex));
  lis[state.sugIndex].scrollIntoView({ block: 'nearest' });
}

let searchRaf;
qInput.addEventListener('input', () => {
  state.query = qInput.value;
  searchBox.classList.toggle('has-text', !!qInput.value);
  renderSuggest();
  cancelAnimationFrame(searchRaf);
  searchRaf = requestAnimationFrame(renderGrid);
});
qInput.addEventListener('focus', () => { searchBox.classList.add('focus'); renderSuggest(); });
qInput.addEventListener('blur', () => { searchBox.classList.remove('focus'); closeSuggest(); });
qInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); }
  else if (e.key === 'Enter') {
    if (e.isComposing) return; // 日本語変換中の Enter は無視
    e.preventDefault();
    const li = sugBox.children[state.sugIndex];
    if (li) li._pick();
    else { closeSuggest(); qInput.blur(); }
  } else if (e.key === 'Escape') {
    if (sugBox.classList.contains('open')) closeSuggest(); else qInput.blur();
  }
});
$('#clearQ').addEventListener('click', () => {
  qInput.value = '';
  qInput.dispatchEvent(new Event('input'));
  qInput.focus();
});

/* ---------------- Overlay ---------------- */
const focusStack = [];
function openOverlay(ov, origin) {
  focusStack.push(document.activeElement);
  const sheet = ov.querySelector('.sheet');
  if (origin) {
    // タップした場所からシートが広がるように
    const r = origin.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    sheet.style.transformOrigin = `${cx - sheet.offsetLeft}px ${cy - sheet.offsetTop + ov.scrollTop}px`;
  } else {
    sheet.style.transformOrigin = '';
  }
  ov.scrollTop = 0;
  ov.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  ov._raf = requestAnimationFrame(() => ov.classList.add('open'));
}

function closeOverlay(ov) {
  if (ov.getAttribute('aria-hidden') === 'true') return;
  cancelAnimationFrame(ov._raf);
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.overlay[aria-hidden="false"]')) document.body.classList.remove('locked');
  if (ov._onClose) ov._onClose();
  const f = focusStack.pop();
  if (f && f.focus) f.focus({ preventScroll: true });
}

document.querySelectorAll('.overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) closeOverlay(ov);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.overlay[aria-hidden="false"]')].pop();
  if (open) closeOverlay(open);
});

/* ---------------- Detail ---------------- */
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s]+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    const a = el('a', null, m[0]);
    a.href = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function renderHero(r) {
  const hero = $('#dHero');
  hero.innerHTML = '';
  const img = heroImage(r);
  if (img) hero.append(img); else hero.append('🍽');
  const v = videoInfo(r.videoUrl);
  if (v && v.type === 'youtube') {
    const play = iconBtn('hero-play', 'play');
    play.setAttribute('aria-label', '動画を再生');
    play.onclick = () => openPip(r, v.start, play);
    hero.append(play);
  }
}

function renderPills(r) {
  const box = $('#dPills');
  box.innerHTML = '';
  if (r.genre) box.append(el('span', 'pill', r.genre));
  if (r.course) box.append(el('span', 'pill', r.course));
  if (r.time) {
    const p = el('span', 'pill gray');
    p.innerHTML = ICON.timer.replace('<svg', '<svg width="13" height="13"');
    p.append(`${r.time}分`);
    box.append(p);
  }
}

function renderFav(r) {
  const b = $('#dFav');
  b.innerHTML = ICON.heart;
  b.classList.toggle('on', r.favorite);
  b.setAttribute('aria-pressed', String(r.favorite));
}

function renderStars(r, animate) {
  const box = $('#dStars');
  if (!box.children.length) {
    for (let i = 1; i <= 5; i++) {
      const b = iconBtn('', 'star');
      b.dataset.v = i;
      b.style.setProperty('--i', i - 1);
      b.setAttribute('aria-label', `${i}つ星`);
      box.append(b);
    }
  }
  [...box.children].forEach((b, i) => {
    b.classList.toggle('on', i < r.rating);
    if (animate && i < r.rating) replay(b, 'pop');
  });
}

function renderActions(r) {
  const box = $('#dActions');
  box.innerHTML = '';
  const v = videoInfo(r.videoUrl);
  if (v && v.type === 'youtube') {
    const b = iconBtn('btn', 'play', '動画で見る');
    b.onclick = () => openPip(r, v.start, b);
    box.append(b);
  } else if (v) {
    const a = el('a', 'btn');
    a.href = v.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = ICON.link;
    a.append(`${v.label}で開く`);
    box.append(a);
  }
  const cook = iconBtn('btn primary', 'chef', '調理モード');
  cook.onclick = () => openCook(r.id);
  box.append(cook);
}

function ingredientRows(r, k) {
  return lines(r.ingredients).map((l) => {
    const p = parseIngredient(l);
    if (p.header) return p;
    const scaled = scaleAmount(p.amount, k);
    return { ...p, scaled, changed: scaled !== p.amount };
  });
}

function renderIngredients(r, bump) {
  const block = $('#dIngBlock');
  const ul = $('#dIng');
  const k = state.servings / r.servings;
  const rows = ingredientRows(r, k);
  block.hidden = !rows.length;
  ul.innerHTML = '';
  rows.forEach((row, i) => {
    const li = el('li', row.header ? 'i-head' : null);
    li.style.setProperty('--i', i);
    if (row.header) li.textContent = row.name;
    else {
      const amt = el('span', 'i-amt' + (row.changed ? ' scaled' : ''), row.scaled);
      if (bump && row.amount) amt.classList.add('bump');
      li.append(el('span', 'i-name', row.name), amt);
    }
    ul.append(li);
  });
  $('#servingsVal').textContent = `${state.servings}人分`;
  $('#servings [data-d="-1"]').disabled = state.servings <= 1;
  $('#servings [data-d="1"]').disabled = state.servings >= 20;
}

function stepChips(r, step, inCook) {
  const wrap = el('div', 'step-chips');
  const v = videoInfo(r.videoUrl);
  if (step.t != null && v && v.type === 'youtube') {
    const b = iconBtn('chip-btn ts', 'play', fmtClock(step.t));
    b.setAttribute('aria-label', `動画の${fmtClock(step.t)}から再生`);
    b.onclick = (e) => { e.stopPropagation(); openPip(r, step.t, b); };
    wrap.append(b);
  }
  findDurations(step.text).forEach((d) => {
    const b = iconBtn('chip-btn tm', 'timer', d.label);
    b.setAttribute('aria-label', `${d.label}のタイマーを開始`);
    b.onclick = (e) => { e.stopPropagation(); startTimer(d.sec, `${r.name} · ${d.label}`); };
    wrap.append(b);
  });
  if (inCook) return wrap;
  return wrap.children.length ? wrap : null;
}

function renderSteps(r) {
  const ol = $('#dSteps');
  const steps = lines(r.steps).map(parseStep);
  $('#dStepsBlock').hidden = !steps.length;
  ol.innerHTML = '';
  steps.forEach((s, i) => {
    const li = el('li');
    li.style.setProperty('--i', i);
    li.append(linkify(s.text));
    const chips = stepChips(r, s);
    if (chips) li.append(chips);
    ol.append(li);
  });
}

function renderTags(r) {
  const box = $('#dTags');
  box.innerHTML = '';
  r.tags.forEach((t) => {
    const b = el('button', 'tag', '#' + t);
    b.type = 'button';
    b.onclick = () => {
      closeOverlay($('#detailOv'));
      setQuery('#' + t);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    box.append(b);
  });
  box.hidden = !r.tags.length;
}

function renderMemo(r) {
  const memo = $('#dMemo');
  memo.innerHTML = '';
  const text = (r.memo || '').trim();
  $('#dMemoBlock').hidden = !text;
  if (text) memo.append(linkify(text));
}

function renderLog(r) {
  const sum = $('#logSum');
  const n = r.cooked.length;
  if (n) {
    const last = lastCooked(r);
    sum.textContent = `${n}回作りました · 最後は${fmtDate(last)}(${daysAgo(last)})`;
  } else {
    sum.textContent = 'まだ記録がありません。作ったら「作った！」を押しましょう。';
  }
  const ul = $('#logList');
  ul.innerHTML = '';
  [...r.cooked].sort((a, b) => b.date.localeCompare(a.date)).forEach((c, i) => {
    const li = el('li');
    li.style.setProperty('--i', i);
    li.append(el('span', 'l-date', fmtDate(c.date)), el('span', 'l-note', c.note || ''));
    if (c.photo) li.append(makeImg(c.photo));
    const del = el('button', 'l-del');
    del.type = 'button';
    del.innerHTML = ICON.close;
    del.setAttribute('aria-label', 'この記録を消す');
    del.onclick = async () => {
      r.cooked = r.cooked.filter((x) => x.id !== c.id);
      await saveRecipe(r);
      li.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(20px)' }], { duration: 250, fill: 'forwards' })
        .onfinish = () => renderLog(r);
    };
    li.append(del);
    ul.append(li);
  });
}

function openDetail(id, origin) {
  const r = getRecipe(id);
  if (!r) return;
  state.detailId = id;
  state.servings = r.servings;
  renderHero(r);
  renderPills(r);
  $('#dTitle').textContent = r.name;
  renderFav(r);
  renderStars(r);
  renderActions(r);
  $('#dIngBlock').classList.remove('no-anim');
  renderIngredients(r);
  renderSteps(r);
  renderTags(r);
  renderMemo(r);
  closeLogForm(true);
  renderLog(r);
  resetDelete();
  openOverlay($('#detailOv'), origin);
}

$('#dFav').addEventListener('click', () => {
  const r = getRecipe(state.detailId);
  if (!r) return;
  toggleFav(r);
  renderFav(r);
  replay($('#dFav'), 'pop');
});

$('#dStars').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  const r = getRecipe(state.detailId);
  if (!b || !r) return;
  const v = +b.dataset.v;
  r.rating = r.rating === v ? 0 : v;
  renderStars(r, true);
  await saveRecipe(r);
  if (state.sort === 'rating') renderGrid();
});

$('#servings').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const r = getRecipe(state.detailId);
  if (!b || !r) return;
  state.servings = Math.max(1, Math.min(20, state.servings + +b.dataset.d));
  $('#dIngBlock').classList.add('no-anim');
  renderIngredients(r, true);
});

async function toggleFav(r) {
  r.favorite = !r.favorite;
  await saveRecipe(r);
  if (state.fav) renderGrid();
}

/* 作った記録 */
const logForm = $('#logForm');
let logPhoto = null;
function openLogForm() {
  $('#logDate').value = todayStr();
  $('#logNote').value = '';
  logPhoto = null;
  $('#logPhotoBtn').classList.remove('has');
  $('#logPhotoLabel').textContent = '📷 写真';
  logForm.classList.add('open');
  setTimeout(() => $('#logNote').focus({ preventScroll: true }), 300);
}
function closeLogForm(instant) {
  logForm.classList.remove('open');
  if (instant) logForm.style.transition = 'none', void logForm.offsetWidth, logForm.style.transition = '';
}
$('#cookedBtn').addEventListener('click', () => {
  if (logForm.classList.contains('open')) closeLogForm(); else openLogForm();
});
$('#logCancel').addEventListener('click', () => closeLogForm());
$('#logPhoto').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    logPhoto = await compressImage(f, 900, 0.8);
    $('#logPhotoBtn').classList.add('has');
    $('#logPhotoLabel').textContent = '📷 追加済み';
  } catch { toast('この画像は読み込めませんでした'); }
});
logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = getRecipe(state.detailId);
  if (!r) return;
  r.cooked.push({ id: uid(), date: $('#logDate').value || todayStr(), note: $('#logNote').value.trim(), photo: logPhoto });
  await saveRecipe(r);
  closeLogForm();
  renderLog(r);
  replay($('#cookedBtn'), 'pop');
  toast(r.cooked.length === 1 ? '初めての記録です 🎉' : `${r.cooked.length}回目の記録です 🎉`);
  if (state.sort === 'cooked' || state.sort === 'stale') renderGrid();
});

let delTimer;
const delBtn = $('#delBtn');
function resetDelete() {
  clearTimeout(delTimer);
  delBtn.classList.remove('confirm');
  delBtn.textContent = '削除';
}
delBtn.addEventListener('click', async () => {
  if (!delBtn.classList.contains('confirm')) {
    delBtn.classList.add('confirm');
    delBtn.textContent = '本当に削除する';
    delTimer = setTimeout(resetDelete, 3000);
    return;
  }
  const id = state.detailId;
  closeOverlay($('#detailOv'));
  if (pip.recipeId === id) closePip();
  const node = cardNodes.get(id);
  await db.del(id);
  state.recipes = state.recipes.filter((r) => r.id !== id);
  const finish = () => { removeCardNode(id); renderChips(); renderGrid(); };
  if (node && !node.hidden) {
    node.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.85)' }],
      { duration: 320, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }
    ).onfinish = finish;
  } else finish();
  toast('削除しました');
});

$('#editBtn').addEventListener('click', () => {
  const id = state.detailId;
  closeOverlay($('#detailOv'));
  setTimeout(() => openForm(id), 180);
});

/* ---------------- 調理モード ---------------- */
const cookChecks = new Map(); // レシピごとのチェック状態(この画面を開いている間だけ保持)
let wakeLock = null;

async function requestWake() {
  try {
    if (!('wakeLock' in navigator)) return;
    wakeLock = await navigator.wakeLock.request('screen');
    $('#wake').classList.add('on');
    wakeLock.addEventListener('release', () => $('#wake').classList.remove('on'));
  } catch { /* 省電力モードなどで取得できないことがある */ }
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#cookOv').getAttribute('aria-hidden') === 'false') requestWake();
});
$('#cookOv')._onClose = releaseWake;

function openCook(id) {
  const r = getRecipe(id);
  if (!r) return;
  if (!cookChecks.has(id)) cookChecks.set(id, { ing: new Set(), steps: new Set() });
  const chk = cookChecks.get(id);
  $('#cTitle').textContent = r.name;
  $('#cServ').textContent = `${state.servings}人分`;

  const ul = $('#cIng');
  ul.innerHTML = '';
  const rows = ingredientRows(r, state.servings / r.servings);
  const total = rows.filter((x) => !x.header).length;
  const updateProg = (celebrate) => {
    const n = chk.ing.size;
    $('#cProg').textContent = total ? `${n} / ${total}` : '';
    $('#cBar').style.width = total ? `${(n / total) * 100}%` : '0';
    $('#cBar').parentElement.classList.toggle('done', total > 0 && n === total);
    if (celebrate && total && n === total) toast('材料がそろいました 👍');
  };
  rows.forEach((row, i) => {
    const li = el('li', row.header ? 'i-head' : null);
    if (row.header) { li.textContent = row.name; ul.append(li); return; }
    const key = `${i}:${row.name}`;
    const check = el('span', 'check');
    check.innerHTML = ICON.check;
    li.append(check, el('span', 'c-name', row.name), el('span', 'c-amt', row.scaled));
    li.classList.toggle('done', chk.ing.has(key));
    li.onclick = () => {
      if (chk.ing.has(key)) chk.ing.delete(key); else chk.ing.add(key);
      li.classList.toggle('done', chk.ing.has(key));
      updateProg(chk.ing.has(key));
    };
    ul.append(li);
  });
  $('.cook-ing').hidden = !total;
  updateProg(false);

  const ol = $('#cSteps');
  ol.innerHTML = '';
  lines(r.steps).map(parseStep).forEach((s, i) => {
    const li = el('li');
    li.style.setProperty('--i', i);
    li.append(el('span', 'num', String(i + 1)), linkify(s.text));
    const chips = stepChips(r, s, true);
    if (chips.children.length) li.append(chips);
    li.classList.toggle('done', chk.steps.has(i));
    li.onclick = (e) => {
      if (e.target.closest('a')) return;
      if (chk.steps.has(i)) chk.steps.delete(i); else chk.steps.add(i);
      li.classList.toggle('done', chk.steps.has(i));
      li.querySelector('.num').innerHTML = chk.steps.has(i) ? ICON.check.replace('<svg', '<svg width="16" height="16"') : String(i + 1);
    };
    if (chk.steps.has(i)) li.querySelector('.num').innerHTML = ICON.check.replace('<svg', '<svg width="16" height="16"');
    ol.append(li);
  });

  openOverlay($('#cookOv'));
  requestWake();
}

/* ---------------- フローティング動画プレーヤー ---------------- */
const pip = {
  el: $('#pip'),
  inner: $('#pipInner'),
  frame: null,
  vid: null,
  recipeId: null,
  corner: prefs.get('pipCorner', 'br'),
  big: false,
  x: 0,
  y: 0,
};
const PIP_BAR = 36;

function pipDims() {
  const vw = window.innerWidth;
  const w = pip.big ? Math.min(vw - 24, 720) : Math.max(220, Math.min(vw * 0.62, 380));
  return { w: Math.round(w), h: Math.round(w * 9 / 16) + PIP_BAR };
}

function timersHeight() {
  const t = $('#timers');
  return t.children.length ? t.getBoundingClientRect().height + 12 : 0;
}

function pipCornerXY(c) {
  const { w, h } = pipDims();
  const M = 12;
  const top = 64;
  const bottom = window.innerHeight - h - M - timersHeight();
  return {
    x: c[1] === 'l' ? M : window.innerWidth - w - M,
    y: c[0] === 't' ? top : Math.max(top, bottom),
  };
}

function pipPlace(x, y, animate) {
  pip.x = x;
  pip.y = y;
  pip.el.style.transition = animate ? '' : 'none';
  pip.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (!animate) { void pip.el.offsetWidth; pip.el.style.transition = ''; }
}

function pipSnap(animate = true) {
  if (pip.el.hidden) return;
  pip.el.style.width = pipDims().w + 'px';
  const p = pipCornerXY(pip.corner);
  pipPlace(p.x, p.y, animate);
}

function pipCommand(func, args = []) {
  if (pip.frame && pip.frame.contentWindow) {
    pip.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }
}

function openPip(r, t = 0, origin) {
  const v = videoInfo(r.videoUrl);
  if (!v || v.type !== 'youtube') return;
  if (pip.vid === v.id && !pip.el.hidden) {
    pipCommand('seekTo', [t, true]);
    pipCommand('playVideo');
    replay(pip.el, 'flash');
    return;
  }
  pip.vid = v.id;
  pip.recipeId = r.id;
  $('#pipTitle').textContent = r.name;
  const f = document.createElement('iframe');
  f.title = r.name;
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&start=${Math.floor(t)}`;
  $('#pipVideo').replaceChildren(f);
  pip.frame = f;

  const wasHidden = pip.el.hidden;
  pip.el.hidden = false;
  pipSnap(false);
  if (wasHidden) {
    // 押したボタンの位置から小窓が飛び出すように
    const { w, h } = pipDims();
    let from = 'translateY(30px) scale(.7)';
    if (origin) {
      const o = origin.getBoundingClientRect();
      const dx = o.left + o.width / 2 - (pip.x + w / 2);
      const dy = o.top + o.height / 2 - (pip.y + h / 2);
      from = `translate(${dx}px, ${dy}px) scale(.2)`;
    }
    pip.inner.animate(
      [{ transform: from, opacity: 0, borderRadius: '40px' }, { transform: 'none', opacity: 1, borderRadius: '16px' }],
      { duration: 600, easing: 'cubic-bezier(.2,1.1,.3,1)' }
    );
  }
}

function closePip() {
  if (pip.el.hidden) return;
  pip.inner.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }],
    { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }
  ).onfinish = () => {
    pip.el.hidden = true;
    $('#pipVideo').replaceChildren();
    pip.frame = null;
    pip.vid = null;
    pip.recipeId = null;
  };
}

$('#pipClose').addEventListener('click', closePip);
$('#pipSize').addEventListener('click', () => {
  pip.big = !pip.big;
  pipSnap(true);
});

// ドラッグで好きな位置へ。離すと勢いの方向にある角へ吸い付く
$('#pipBar').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.button > 0) return;
  e.preventDefault();
  const bar = e.currentTarget;
  bar.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY, ox = pip.x, oy = pip.y;
  const trail = [{ x: sx, y: sy, t: performance.now() }];
  pip.el.classList.add('dragging');
  pip.el.style.transition = 'none';

  const move = (ev) => {
    pip.x = ox + ev.clientX - sx;
    pip.y = oy + ev.clientY - sy;
    pip.el.style.transform = `translate3d(${pip.x}px, ${pip.y}px, 0)`;
    trail.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (trail.length > 6) trail.shift();
  };
  const up = () => {
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', up);
    bar.removeEventListener('pointercancel', up);
    pip.el.classList.remove('dragging');
    pip.el.style.transition = '';
    const a = trail[0], b = trail[trail.length - 1];
    const dt = Math.max(16, b.t - a.t);
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    const { w, h } = pipDims();
    const px = pip.x + w / 2 + vx * 200;
    const py = pip.y + h / 2 + vy * 200;
    pip.corner = (py < window.innerHeight / 2 ? 't' : 'b') + (px < window.innerWidth / 2 ? 'l' : 'r');
    prefs.set('pipCorner', pip.corner);
    pipSnap(true);
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
});

let resizeRaf;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => pipSnap(false));
});

/* ---------------- タイマー ---------------- */
const timers = [];
let timerTick = null;
let actx = null;

function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* 音が出せない環境では振動と表示だけで知らせる */ }
}

function beep() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [0, 0.22, 0.44].forEach((d) => {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
    o.connect(g).connect(actx.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.2);
  });
}

function startTimer(sec, label) {
  unlockAudio();
  const t = { id: uid(), label, total: sec * 1000, end: Date.now() + sec * 1000, remain: sec * 1000, paused: false, done: false, beeps: 0, lastBeep: 0 };
  timers.push(t);
  renderTimer(t);
  toast(`⏱ ${label} のタイマーを開始`);
  if (!timerTick) timerTick = setInterval(tickTimers, 250);
  requestAnimationFrame(() => pipSnap(true));
}

function renderTimer(t) {
  const node = el('div', 'timer');
  node.dataset.id = t.id;
  const prog = el('span', 't-prog');
  const time = el('span', 't-time');
  const label = el('span', 't-label', t.label);
  const pause = el('button');
  pause.type = 'button';
  pause.setAttribute('aria-label', '一時停止');
  pause.innerHTML = ICON.pause;
  const close = el('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'タイマーを消す');
  close.innerHTML = ICON.close;
  node.append(prog, time, label, pause, close);
  t.node = node;
  pause.onclick = () => {
    if (t.done) return removeTimer(t);
    t.paused = !t.paused;
    if (t.paused) t.remain = t.end - Date.now();
    else t.end = Date.now() + t.remain;
    node.classList.toggle('paused', t.paused);
    pause.innerHTML = t.paused ? ICON.resume : ICON.pause;
    pause.setAttribute('aria-label', t.paused ? '再開' : '一時停止');
  };
  close.onclick = () => removeTimer(t);
  node.addEventListener('click', (e) => { if (t.done && !e.target.closest('button')) removeTimer(t); });
  $('#timers').append(node);
  updateTimer(t);
}

function updateTimer(t) {
  t.node.querySelector('.t-time').textContent = t.done ? '終了！' : fmtClock(Math.ceil(t.remain / 1000));
  t.node.querySelector('.t-prog').style.width = `${(1 - t.remain / t.total) * 100}%`;
}

function tickTimers() {
  const now = Date.now();
  timers.forEach((t) => {
    if (t.done) {
      // 止めるまで数秒おきに鳴らす(最大1分)
      if (t.beeps < 20 && now - t.lastBeep > 3000) { beep(); t.beeps++; t.lastBeep = now; }
      return;
    }
    if (t.paused) return;
    t.remain = Math.max(0, t.end - now);
    if (t.remain === 0) {
      t.done = true;
      t.node.classList.add('done');
      t.node.querySelector('button').innerHTML = ICON.check;
      t.node.querySelector('button').setAttribute('aria-label', '止める');
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]);
      beep();
      t.lastBeep = now;
      toast(`⏰ ${t.label} が終わりました`);
    }
    updateTimer(t);
  });
}

function removeTimer(t) {
  const i = timers.indexOf(t);
  if (i >= 0) timers.splice(i, 1);
  t.node.classList.add('out');
  setTimeout(() => {
    t.node.remove();
    pipSnap(true);
  }, 300);
  if (!timers.length) { clearInterval(timerTick); timerTick = null; }
}

/* ---------------- Form ---------------- */
const form = $('#form');
const fName = $('#fName');

// ジャンル・種類のボタン選択
function setupPicker(box, input, options, key, deselect) {
  const sync = () => {
    const v = input.value.trim();
    box.querySelectorAll('.cat-pick').forEach((x) => x.classList.toggle('active', !v && x.textContent === state[key]));
  };
  input.addEventListener('input', sync);
  return () => {
    box.innerHTML = '';
    options().forEach((c) => {
      const b = el('button', 'cat-pick', c);
      b.type = 'button';
      b.onclick = () => {
        state[key] = deselect && state[key] === c ? '' : c;
        input.value = '';
        sync();
      };
      box.append(b);
    });
    sync();
  };
}
const renderGenrePicks = setupPicker($('#genrePicks'), $('#fNewGenre'), allGenres, 'formGenre', false);
const renderCoursePicks = setupPicker($('#coursePicks'), $('#fNewCourse'), allCourses, 'formCourse', true);

function setPhoto(dataUrl) {
  state.photo = dataUrl;
  const prev = $('#photoPrev');
  if (dataUrl) {
    prev.src = dataUrl;
    prev.hidden = false;
    prev.style.animation = 'none'; void prev.offsetWidth; prev.style.animation = '';
  } else {
    prev.removeAttribute('src');
    prev.hidden = true;
  }
  $('#photoHint').hidden = !!dataUrl;
  $('#photoRemove').hidden = !dataUrl;
  $('#photoDrop').classList.toggle('filled', !!dataUrl);
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}
form.querySelectorAll('textarea').forEach((t) => t.addEventListener('input', () => autoGrow(t)));

/* 動画URL の入力 → プレビューと料理名の自動入力 */
const fVideo = $('#fVideo');
let videoTimer, videoSeq = 0;
function renderVideoPreview(autofill) {
  const box = $('#fVideoPrev');
  const val = fVideo.value.trim();
  const v = videoInfo(val);
  box.className = 'video-prev';
  box.innerHTML = '';
  if (!val) { box.hidden = true; return; }
  box.hidden = false;
  if (!v) {
    box.classList.add('bad');
    box.textContent = 'URL の形式を確認してください(https:// から始まるURL)';
    return;
  }
  const thumb = el('span', 'vp-thumb');
  if (v.thumb) {
    const img = makeImg(v.thumb);
    img.referrerPolicy = 'no-referrer';
    thumb.append(img);
  } else thumb.textContent = '🔗';
  const text = el('span', 'vp-text');
  const title = el('b', null, v.type === 'youtube' ? '動画を確認しています…' : `${v.label} のリンク`);
  text.append(title, el('span', null, v.type === 'youtube'
    ? 'アプリ内の小窓で再生できます'
    : 'アプリ内では再生できないため、ボタンから元のアプリで開きます'));
  box.append(thumb, text);
  if (v.type !== 'youtube') return;

  const seq = ++videoSeq;
  fetchVideoTitle(v.url).then((t) => {
    if (seq !== videoSeq) return;
    title.textContent = t || 'YouTube の動画';
    if (t && autofill && !fName.value.trim()) {
      fName.value = t.slice(0, 80);
      replay(fName, 'filled-flash');
      toast('動画のタイトルを料理名に入れました');
    }
  });
}
fVideo.addEventListener('input', () => {
  clearTimeout(videoTimer);
  videoTimer = setTimeout(() => renderVideoPreview(true), 350);
});

function openForm(id = null, preset = {}) {
  const r = id ? getRecipe(id) : null;
  state.editingId = r ? r.id : null;
  $('#formTitle').textContent = r ? 'レシピを編集' : '新しいレシピ';
  fName.value = r ? r.name : preset.name || '';
  fVideo.value = r ? r.videoUrl : preset.videoUrl || '';
  $('#fNewGenre').value = '';
  $('#fNewCourse').value = '';
  state.formGenre = r ? r.genre : (state.genre !== 'all' ? state.genre : GENRES[0]);
  state.formCourse = r ? r.course : (state.course !== 'all' ? state.course : '');
  $('#fTime').value = r && r.time ? r.time : '';
  $('#fServ').value = r ? r.servings : 2;
  $('#fTags').value = r ? r.tags.join(', ') : '';
  $('#fIng').value = r ? r.ingredients : '';
  $('#fSteps').value = r ? r.steps : '';
  $('#fMemo').value = r ? r.memo : '';
  setPhoto(r ? r.photo : null);
  renderGenrePicks();
  renderCoursePicks();
  renderVideoPreview(!r);
  fName.parentElement.classList.remove('shake');
  openOverlay($('#formOv'));
  requestAnimationFrame(() => form.querySelectorAll('textarea').forEach(autoGrow));
}

$('#addBtn').addEventListener('click', () => openForm());
$('#emptyAdd').addEventListener('click', () => openForm());

const photoInput = $('#photoInput');
const photoDrop = $('#photoDrop');
async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('画像ファイルを選んでください');
  try {
    setPhoto(await compressImage(file));
  } catch {
    toast('この画像は読み込めませんでした');
  }
}
photoInput.addEventListener('change', () => { handleFile(photoInput.files[0]); photoInput.value = ''; });
['dragenter', 'dragover'].forEach((ev) => photoDrop.addEventListener(ev, (e) => { e.preventDefault(); photoDrop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => photoDrop.addEventListener(ev, (e) => { e.preventDefault(); photoDrop.classList.remove('drag'); }));
photoDrop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
$('#photoRemove').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPhoto(null); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = fName.value.trim();
  if (!name) {
    const f = fName.parentElement;
    f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
    fName.focus();
    return;
  }
  const prev = state.editingId ? getRecipe(state.editingId) : null;
  const recipe = normalizeRecipe({
    ...(prev || {}),
    id: prev ? prev.id : uid(),
    name,
    genre: $('#fNewGenre').value.trim() || state.formGenre || 'その他',
    course: $('#fNewCourse').value.trim() || state.formCourse,
    time: $('#fTime').value,
    servings: $('#fServ').value || 2,
    tags: $('#fTags').value.split(/[,、，\s#＃]+/),
    photo: state.photo,
    videoUrl: fVideo.value.trim(),
    ingredients: $('#fIng').value.trim(),
    steps: $('#fSteps').value.trim(),
    memo: $('#fMemo').value.trim(),
    createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: Date.now(),
  });
  try {
    await db.put(recipe);
  } catch {
    return toast('保存できませんでした(容量不足の可能性があります)');
  }
  if (prev) {
    state.recipes = state.recipes.map((x) => (x.id === prev.id ? recipe : x));
    refreshCard(recipe.id);
  } else {
    state.recipes.push(recipe);
  }
  closeOverlay($('#formOv'));
  renderChips();
  renderGrid();
  toast(prev ? '更新しました' : '保存しました');
  if (!prev) window.scrollTo({ top: $('#genreChips').offsetTop - 80, behavior: 'smooth' });
});

/* ---------------- Card click ---------------- */
$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const favBtn = e.target.closest('.fav');
  if (favBtn) {
    const r = getRecipe(card.dataset.id);
    if (!r) return;
    favBtn.classList.toggle('on', !r.favorite);
    replay(favBtn, 'pop');
    // カードの差し替えはアニメーションの後で
    setTimeout(() => toggleFav(r), 380);
    return;
  }
  openDetail(card.dataset.id, card);
});
$('#grid').addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(card.dataset.id, card); }
});

/* ---------------- Backup ---------------- */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'recipe-box', version: 2, recipes: state.recipes })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recipes-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('書き出しました');
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = (Array.isArray(data) ? data : data.recipes || []).filter((r) => r && r.id && r.name);
    for (const raw of list) {
      const r = normalizeRecipe(raw);
      await db.put(r);
      removeCardNode(r.id);
    }
    state.recipes = (await db.all()).map(normalizeRecipe);
    renderChips();
    renderGrid();
    toast(`${list.length} 件を読み込みました`);
  } catch {
    toast('読み込めないファイルです');
  }
});

/* ---------------- Nav on scroll ---------------- */
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 60);
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------------- Init ---------------- */
(async function init() {
  syncTools();
  try {
    const raw = await db.all();
    state.recipes = raw.map(normalizeRecipe);
    // 旧形式(category)のデータを新形式で保存し直す
    for (const r of raw) if (!('genre' in r)) await db.put(getRecipe(r.id));
  } catch {
    toast('このブラウザでは保存機能が使えません');
  }
  renderChips();
  renderGrid();
  onScroll();
})();
