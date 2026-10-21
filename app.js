'use strict';

/* =========================================================
   Recipe Box — データはこのブラウザの IndexedDB に保存
   ========================================================= */

const DEFAULT_SETTINGS = {
  genres: ['和食', '洋食', '中華'],
  courses: ['メイン', 'サイド', 'スープ'],
};
// 以前の種類名を新しい呼び方に置き換える
const COURSE_MAP = { 主菜: 'メイン', 副菜: 'サイド', 汁物: 'スープ', 主食: 'ライス' };
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
  loaded: false,
  user: null,
  settings: null,
};
const HAS_CLOUD = !!window.RB_FIREBASE_CONFIG;

function normalizeSettings(s) {
  const list = (v, d) => (Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30)
    : d.slice());
  return {
    genres: list(s && s.genres, DEFAULT_SETTINGS.genres),
    courses: list(s && s.courses, DEFAULT_SETTINGS.courses).map((c) => COURSE_MAP[c] || c),
  };
}
state.settings = normalizeSettings(prefs.get('settings', null));

const ICON = {
  // 三角形の重心((左辺x×2 + 先端x) / 3)が中心の 12 に来る形
  play: '<svg viewBox="0 0 24 24"><path d="M7.75 5.4v13.2a1 1 0 0 0 1.52.85l10.73-6.6a1 1 0 0 0 0-1.7L9.27 4.55a1 1 0 0 0-1.52.85z" fill="currentColor"/></svg>',
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

/* ---------------- 保存先(この端末 or クラウド) ---------------- */
const MAX_DOC = 950000; // Firestore の1件あたりの上限(1MB)に余裕をもたせる
const repo = {
  mode: 'local',
  cloud: null,
  async put(r) {
    if (this.mode !== 'cloud') return db.put(r);
    if (JSON.stringify(r).length > MAX_DOC) throw new Error('too-large');
    this.cloud.put(r);
    evalSync(true);
  },
  async del(id) {
    if (this.mode !== 'cloud') return db.del(id);
    this.cloud.del(id);
    evalSync(true);
  },
};

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

// 同期の上限に収まるよう、大きすぎる写真は画質と大きさを段階的に下げる
async function compressImage(file, max = 1400, quality = 0.84, limit = 450000) {
  let out = await drawImage(file, max, quality);
  for (const [m, q] of [[max, 0.72], [1000, 0.7], [800, 0.65]]) {
    if (out.length <= limit) break;
    out = await drawImage(file, m, q);
  }
  return out;
}

async function drawImage(file, max, quality) {
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
    genre: s(r.genre || r.category).trim(),
    course: COURSE_MAP[s(r.course)] || s(r.course).trim(),
    time: +r.time > 0 ? Math.round(+r.time) : null,
    servings: +r.servings > 0 ? Math.round(+r.servings) : 2,
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map(s).map((t) => t.trim().replace(/^[#＃]+/, '')).filter(Boolean))].slice(0, 20) : [],
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

function saveErrorText(e) {
  return e && e.message === 'too-large'
    ? '写真が大きすぎて保存できません。写真を減らすか、別の写真にしてください'
    : '保存できませんでした(容量不足の可能性があります)';
}

async function saveRecipe(r) {
  try {
    await repo.put(r);
  } catch (e) {
    toast(saveErrorText(e));
    return false;
  }
  state.recipes = state.recipes.map((x) => (x.id === r.id ? r : x));
  refreshCard(r.id);
  return true;
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
  meta.append(el('span', 'meta-text', [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ')));
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
  const total = state.loaded ? state.recipes.length : 0;
  $('#count').textContent = total ? (n === total ? `${total} 件のレシピ` : `${n} / ${total} 件`) : '';
  $('#toolbar').hidden = !total;
}

function renderEmpty(n) {
  const empty = $('#empty');
  // 読み込みが終わるまでは「0件」と見せない
  if (n || !state.loaded) { empty.hidden = true; return; }
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
// 絞り込みに出すのは、設定の選択肢 + 実際にレシピで使われているもの
function allGenres() {
  return [...new Set([...state.settings.genres, ...state.recipes.map((r) => r.genre).filter(Boolean)])];
}
function allCourses() {
  return [...new Set([...state.settings.courses, ...state.recipes.map((r) => r.course).filter(Boolean)])];
}

// ジャンル行は「すべて」で解除。種類行はもう一度押すと解除(「すべて」を2つ並べない)
function renderChipRow(box, key, values, withAll) {
  box.innerHTML = '';
  const counts = {};
  state.recipes.forEach((r) => { if (r[key]) counts[r[key]] = (counts[r[key]] || 0) + 1; });
  const cats = values.filter((c) => counts[c]);
  if (state[key] !== 'all' && !counts[state[key]]) state[key] = 'all';
  box.hidden = !cats.length;

  const sync = () => box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.v === state[key]));
  const add = (val, label, n) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.dataset.v = val;
    b.title = label;
    b.append(el('span', 'n', String(n)));
    b.onclick = () => {
      if (state[key] === val && withAll) return;
      state[key] = state[key] === val ? 'all' : val;
      sync();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      renderGrid();
    };
    box.append(b);
  };
  if (withAll) add('all', 'すべて', state.recipes.length);
  cats.forEach((c) => add(c, c, counts[c]));
  sync();
}

function renderChips() {
  renderChipRow($('#genreChips'), 'genre', allGenres(), true);
  renderChipRow($('#courseChips'), 'course', allCourses(), false);
}

/* ---------------- 独自のプルダウン ---------------- */
const TIME_OPTS = [
  { value: 0, label: '指定なし', button: '調理時間' },
  { value: 15, label: '15分以内' },
  { value: 30, label: '30分以内' },
  { value: 60, label: '60分以内' },
];
const SORT_OPTS = [
  { value: 'new', label: '新しい順' },
  { value: 'rating', label: '評価が高い順' },
  { value: 'cooked', label: 'よく作る順' },
  { value: 'stale', label: '最近作ってない順' },
  { value: 'time', label: '早くできる順' },
  { value: 'name', label: '名前順' },
];
const menuPop = $('#menuPop');
let openMenuBtn = null;

function showMenu(btn, opts, current, pick) {
  closeMenu(true);
  openMenuBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  menuPop.innerHTML = '';
  opts.forEach((o) => {
    const li = el('li', 'menu-item' + (o.value === current ? ' selected' : ''));
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(o.value === current));
    li.tabIndex = -1;
    const check = el('span', 'mi-check');
    check.innerHTML = ICON.check;
    li.append(check, o.label);
    li.onclick = () => { closeMenu(); if (o.value !== current) pick(o.value); };
    menuPop.append(li);
  });
  menuPop.hidden = false;
  // ボタンの真下に。画面からはみ出す場合は左右・上下を調整
  const r = btn.getBoundingClientRect();
  const w = menuPop.offsetWidth, h = menuPop.offsetHeight;
  const alignRight = r.right - w >= 8;
  const left = alignRight ? r.right - w : Math.min(r.left, window.innerWidth - w - 8);
  const below = r.bottom + 8 + h <= window.innerHeight - 8;
  menuPop.style.left = `${Math.max(8, left)}px`;
  menuPop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
  menuPop.style.transformOrigin = `${alignRight ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;
  requestAnimationFrame(() => menuPop.classList.add('open'));
  (menuPop.querySelector('.selected') || menuPop.firstChild).focus({ preventScroll: true });
}

function closeMenu(instant) {
  if (!openMenuBtn) return;
  openMenuBtn.setAttribute('aria-expanded', 'false');
  const btn = openMenuBtn;
  openMenuBtn = null;
  menuPop.classList.remove('open');
  if (instant) menuPop.hidden = true;
  else setTimeout(() => { if (!openMenuBtn) menuPop.hidden = true; }, 200);
  if (!instant && menuPop.contains(document.activeElement)) btn.focus({ preventScroll: true });
}

function setupMenu(btn, opts, get, set) {
  const paint = () => {
    const o = opts.find((x) => x.value === get()) || opts[0];
    btn.querySelector('.menu-label').textContent = o.button || o.label;
    return o;
  };
  btn.addEventListener('click', () => {
    if (openMenuBtn === btn) return closeMenu();
    showMenu(btn, opts, get(), (v) => { set(v); paint(); syncTools(); });
  });
  return paint;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenuBtn && !menuPop.contains(e.target) && !openMenuBtn.contains(e.target)) closeMenu();
});
window.addEventListener('scroll', () => closeMenu(true), { passive: true });
window.addEventListener('resize', () => closeMenu(true));
menuPop.addEventListener('keydown', (e) => {
  const items = [...menuPop.children];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (items[i]) items[i].click(); }
  else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); closeMenu(); }
});

const paintTime = setupMenu($('#timeMenu'), TIME_OPTS, () => state.time, (v) => {
  state.time = v;
  prefs.set('time', v);
  renderGrid();
});
const paintSort = setupMenu($('#sortMenu'), SORT_OPTS, () => state.sort, (v) => {
  state.sort = v;
  prefs.set('sort', v);
  renderGrid();
});

function syncTools() {
  $('#favFilter').setAttribute('aria-pressed', String(state.fav));
  paintTime();
  paintSort();
  $('#timeMenu').classList.toggle('on', !!state.time);
}

$('#favFilter').addEventListener('click', (e) => {
  state.fav = !state.fav;
  prefs.set('fav', state.fav);
  syncTools();
  replay(e.currentTarget, 'pop');
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
    if (ov.classList.contains('gate')) return; // ログイン画面は外側を押しても閉じない
    if (e.target === ov || e.target.closest('[data-close]')) closeOverlay(ov);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.overlay[aria-hidden="false"]')].pop();
  if (open && !open.classList.contains('gate')) closeOverlay(open);
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
  const playable = !!(v && v.type === 'youtube');
  hero.classList.toggle('playable', playable);
  hero.onclick = null;
  if (playable) {
    // 写真を隠さないよう、再生ボタンは左下に小さく。写真のどこを押しても再生できる
    const play = iconBtn('hero-play', 'play', '再生');
    play.setAttribute('aria-label', '動画を再生');
    hero.append(play);
    hero.onclick = () => openPip(r, v.start, play);
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
  const note = $('#scaleNote');
  note.hidden = k === 1;
  note.textContent = `${r.servings}人分のレシピから換算しています`;
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

/* 共有:受け取る人はアプリを持っていないので、そのまま読めるテキストで送る */
function recipeText(r) {
  const k = state.servings / r.servings;
  const out = [r.name];
  const meta = [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ');
  if (meta) out.push(meta);
  const ing = ingredientRows(r, k);
  if (ing.length) {
    out.push('', `【材料】${state.servings}人分`);
    ing.forEach((x) => out.push(x.header ? `■ ${x.name}` : `・${x.name}${x.scaled ? ' ' + x.scaled : ''}`));
  }
  const steps = lines(r.steps).map(parseStep);
  if (steps.length) {
    out.push('', '【作り方】');
    steps.forEach((s, i) => out.push(`${i + 1}. ${s.text}`));
  }
  if (r.videoUrl) out.push('', `【動画】${r.videoUrl}`);
  if (r.memo && r.memo.trim()) out.push('', '【メモ】', r.memo.trim());
  return out.join('\n');
}

async function shareRecipe(r) {
  const text = recipeText(r);
  if (navigator.share) {
    try {
      await navigator.share({ title: r.name, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 共有シートを閉じただけ
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('レシピをコピーしました。LINE などに貼り付けて送れます');
  } catch {
    toast('共有できませんでした');
  }
}

$('#dShare').addEventListener('click', () => {
  const r = getRecipe(state.detailId);
  if (r) shareRecipe(r);
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
    logPhoto = await compressImage(f, 900, 0.8, 150000);
    $('#logPhotoBtn').classList.add('has');
    $('#logPhotoLabel').textContent = '📷 追加済み';
  } catch { toast('この画像は読み込めませんでした'); }
});
logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = getRecipe(state.detailId);
  if (!r) return;
  const entry = { id: uid(), date: $('#logDate').value || todayStr(), note: $('#logNote').value.trim(), photo: logPhoto };
  r.cooked.push(entry);
  if (!(await saveRecipe(r))) {
    r.cooked = r.cooked.filter((c) => c !== entry);
    return;
  }
  closeLogForm();
  renderLog(r);
  replay($('#cookedBtn'), 'pop');
  toast(r.cooked.length === 1 ? '初めての記録です 🎉' : `${r.cooked.length}回目の記録です 🎉`);
  if (state.sort === 'cooked' || state.sort === 'stale') renderGrid();
});

let delTimer;
const delBtn = $('#delBtn');
// ゴミ箱を押すと「本当に削除する」に広がり、もう一度押すと削除。3秒で元に戻る
function resetDelete() {
  clearTimeout(delTimer);
  delBtn.classList.remove('confirm');
  delBtn.setAttribute('aria-label', '削除');
}
delBtn.addEventListener('click', async () => {
  if (!delBtn.classList.contains('confirm')) {
    delBtn.classList.add('confirm');
    delBtn.setAttribute('aria-label', '本当に削除する');
    delTimer = setTimeout(resetDelete, 3000);
    return;
  }
  const id = state.detailId;
  closeOverlay($('#detailOv'));
  if (pip.recipeId === id) closePip();
  const node = cardNodes.get(id);
  await repo.del(id);
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
// 小さいとき:動画のどこを持っても動かせる。離した場所にそのまま止まる(画面の外には出ない)
// 大きいとき:YouTube の操作がそのまま使える。上のバーを持って動かす
const pip = {
  el: $('#pip'),
  inner: $('#pipInner'),
  frame: null,
  vid: null,
  recipeId: null,
  big: false,
  playing: true,
  pos: prefs.get('pipPos', null), // 画面に対する割合で覚える(回転・リサイズしても位置がずれない)
  x: 0,
  y: 0,
};
const PIP_BAR = 40;
const PIP_M = 10;
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13L19 12z" fill="currentColor"/></svg>';

function pipDims() {
  const vw = window.innerWidth;
  const w = Math.round(pip.big ? Math.min(vw - 2 * PIP_M, 720) : Math.max(200, Math.min(vw * 0.56, 360)));
  return { w, h: Math.round(w * 9 / 16) + (pip.big ? PIP_BAR : 0) };
}

function pipBounds() {
  const { w, h } = pipDims();
  return { minX: PIP_M, maxX: Math.max(PIP_M, window.innerWidth - w - PIP_M), minY: PIP_M, maxY: Math.max(PIP_M, window.innerHeight - h - PIP_M) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// 画面の端より外へ引っぱったときは、ゴムのように少しだけついてくる
const rubber = (v, lo, hi) => (v < lo ? lo - (lo - v) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v);

function pipPlace(x, y, animate) {
  pip.x = x;
  pip.y = y;
  pip.el.style.transition = animate ? '' : 'none';
  pip.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (!animate) { void pip.el.offsetWidth; pip.el.style.transition = ''; }
}

function pipSavePos() {
  const b = pipBounds();
  pip.pos = {
    rx: b.maxX > b.minX ? (pip.x - b.minX) / (b.maxX - b.minX) : 1,
    ry: b.maxY > b.minY ? (pip.y - b.minY) / (b.maxY - b.minY) : 0,
  };
  prefs.set('pipPos', pip.pos);
}

// 覚えている位置(なければ右上)に置く
function pipRestore(animate) {
  if (pip.el.hidden) return;
  pip.el.classList.toggle('big', pip.big);
  pip.el.style.width = pipDims().w + 'px';
  const b = pipBounds();
  const p = pip.pos || { rx: 1, ry: 0.08 };
  pipPlace(b.minX + clamp(p.rx, 0, 1) * (b.maxX - b.minX), b.minY + clamp(p.ry, 0, 1) * (b.maxY - b.minY), animate);
}

function pipCommand(func, args = []) {
  if (pip.frame && pip.frame.contentWindow) {
    pip.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }
}

function paintPlay() {
  const b = pip.inner.querySelector('[data-pip="toggle"]');
  b.innerHTML = pip.playing ? ICON_PAUSE : ICON_PLAY;
  b.setAttribute('aria-label', pip.playing ? '一時停止' : '再生');
}

let ctrlTimer;
function showCtrls(ms = 2600) {
  pip.el.classList.add('ctrls');
  clearTimeout(ctrlTimer);
  ctrlTimer = setTimeout(() => pip.el.classList.remove('ctrls'), ms);
}
function hideCtrls() {
  clearTimeout(ctrlTimer);
  pip.el.classList.remove('ctrls');
}

// YouTube から再生状態を受け取る(1=再生中, 3=読み込み中)
window.addEventListener('message', (e) => {
  if (!pip.frame || e.source !== pip.frame.contentWindow) return;
  let d;
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!d) return;
  const st = d.event === 'onStateChange' ? d.info : d.info && d.info.playerState;
  if (typeof st === 'number' && st !== -1) {
    pip.playing = st === 1 || st === 3;
    paintPlay();
  }
});

function openPip(r, t = 0, origin) {
  const v = videoInfo(r.videoUrl);
  if (!v || v.type !== 'youtube') return;
  if (pip.vid === v.id && !pip.el.hidden) {
    pipCommand('seekTo', [t, true]);
    pipCommand('playVideo');
    pip.playing = true;
    paintPlay();
    replay(pip.el, 'flash');
    return;
  }
  pip.vid = v.id;
  pip.recipeId = r.id;
  pip.playing = true;
  paintPlay();
  $('#pipTitle').textContent = r.name;
  const f = document.createElement('iframe');
  f.title = r.name;
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`
    + `&origin=${encodeURIComponent(location.origin)}&start=${Math.floor(t)}`;
  f.addEventListener('load', () => {
    f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  });
  $('#pipFrame').replaceChildren(f);
  pip.frame = f;

  const wasHidden = pip.el.hidden;
  pip.el.hidden = false;
  pipRestore(false);
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
    // 最初だけ操作ボタンを見せて、触れることを伝える
    if (!pip.big) setTimeout(() => showCtrls(1800), 450);
  }
}

function closePip() {
  if (pip.el.hidden) return;
  hideCtrls();
  pip.inner.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }],
    { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }
  ).onfinish = () => {
    pip.el.hidden = true;
    $('#pipFrame').replaceChildren();
    pip.frame = null;
    pip.vid = null;
    pip.recipeId = null;
  };
}

function setPipBig(big) {
  pip.big = big;
  hideCtrls();
  pipRestore(true);
}

pip.inner.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pip]');
  if (!b) return;
  const act = b.dataset.pip;
  if (act === 'close') closePip();
  else if (act === 'big') setPipBig(true);
  else if (act === 'small') setPipBig(false);
  else if (act === 'toggle') {
    pip.playing = !pip.playing;
    pipCommand(pip.playing ? 'playVideo' : 'pauseVideo');
    paintPlay();
    showCtrls();
  }
});

// 指(またはマウス)で動かす。ほとんど動かさずに離したら「タップ」として操作ボタンを出す
pip.inner.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || e.target.closest('button')) return;
  if (!e.target.closest('.pip-shield, .pip-bar')) return;
  e.preventDefault();
  const target = e.target.closest('.pip-shield, .pip-bar');
  target.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY, ox = pip.x, oy = pip.y;
  const trail = [{ x: sx, y: sy, t: performance.now() }];
  const b = pipBounds();
  let dragging = false;

  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 6) return;
      dragging = true;
      hideCtrls();
      pip.el.classList.add('dragging');
      pip.el.style.transition = 'none';
    }
    pip.x = rubber(ox + dx, b.minX, b.maxX);
    pip.y = rubber(oy + dy, b.minY, b.maxY);
    pip.el.style.transform = `translate3d(${pip.x}px, ${pip.y}px, 0)`;
    trail.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (trail.length > 6) trail.shift();
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (!dragging) {
      if (!pip.big) {
        if (pip.el.classList.contains('ctrls')) hideCtrls(); else showCtrls();
      }
      return;
    }
    pip.el.classList.remove('dragging');
    pip.el.style.transition = '';
    // 指を離したときの勢いの分だけ滑らせてから止める
    const a = trail[0], z = trail[trail.length - 1];
    const dt = Math.max(16, z.t - a.t);
    const vx = (z.x - a.x) / dt, vy = (z.y - a.y) / dt;
    pipPlace(clamp(pip.x + vx * 140, b.minX, b.maxX), clamp(pip.y + vy * 140, b.minY, b.maxY), true);
    pipSavePos();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
});

let resizeRaf;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => pipRestore(false));
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
  setTimeout(() => t.node.remove(), 300);
  if (!timers.length) { clearInterval(timerTick); timerTick = null; }
}

/* ---------------- Form ---------------- */
const form = $('#form');
const fName = $('#fName');

// ジャンル・種類のボタン選択(もう一度押すと選択を外せる)。選択肢は設定画面で編集する
function setupPicker(box, listKey, key) {
  const sync = () => box.querySelectorAll('.cat-pick').forEach((x) => {
    x.classList.toggle('active', x.dataset.v === state[key]);
    x.setAttribute('aria-pressed', String(x.dataset.v === state[key]));
  });
  return () => {
    box.innerHTML = '';
    const opts = [...state.settings[listKey]];
    // 選択肢から外した値のレシピを編集するときも、今の値は選べるように残す
    if (state[key] && !opts.includes(state[key])) opts.push(state[key]);
    opts.forEach((c) => {
      const b = el('button', 'cat-pick', c);
      b.type = 'button';
      b.dataset.v = c;
      b.onclick = () => { state[key] = state[key] === c ? '' : c; sync(); };
      box.append(b);
    });
    sync();
  };
}
const renderGenrePicks = setupPicker($('#genrePicks'), 'genres', 'formGenre');
const renderCoursePicks = setupPicker($('#coursePicks'), 'courses', 'formCourse');
document.querySelectorAll('[data-edit-cats]').forEach((b) => b.addEventListener('click', () => openSettings(b)));

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
  state.formGenre = r ? r.genre : (state.genre !== 'all' ? state.genre : '');
  state.formCourse = r ? r.course : (state.course !== 'all' ? state.course : '');
  $('#fTime').value = r && r.time ? r.time : '';
  $('#fServ').value = r ? r.servings : 2;
  $('#fTags').value = r ? r.tags.join(' ') : '';
  $('#fIng').value = r ? r.ingredients : '';
  $('#fSteps').value = r ? r.steps : '';
  $('#fMemo').value = r ? r.memo : preset.memo || '';
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
    genre: state.formGenre,
    course: state.formCourse,
    time: $('#fTime').value,
    servings: $('#fServ').value || 2,
    tags: $('#fTags').value.split(/[\s　]+/),
    photo: state.photo,
    videoUrl: fVideo.value.trim(),
    ingredients: $('#fIng').value.trim(),
    steps: $('#fSteps').value.trim(),
    memo: $('#fMemo').value.trim(),
    createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: Date.now(),
  });
  try {
    await repo.put(recipe);
  } catch (err) {
    return toast(saveErrorText(err));
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
    let ok = 0;
    for (const raw of list) {
      const r = normalizeRecipe(raw);
      try { await repo.put(r); } catch { continue; } // 大きすぎる1件があっても残りは読み込む
      ok++;
      removeCardNode(r.id);
      state.recipes = state.recipes.filter((x) => x.id !== r.id).concat(r);
    }
    renderChips();
    renderGrid();
    toast(ok === list.length ? `${ok} 件を読み込みました` : `${ok} 件を読み込みました(${list.length - ok} 件は大きすぎて読み込めませんでした)`);
  } catch {
    toast('読み込めないファイルです');
  }
});

/* ---------------- Nav on scroll ---------------- */
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 60);
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------------- 同期の状態 ---------------- */
const SYNC_TEXT = {
  local: ['この端末だけに保存しています', HAS_CLOUD ? 'ログインすると Mac と Pixel で同期できます' : 'ほかの端末へはバックアップで移せます'],
  syncing: ['同期しています…', '変更をクラウドに送っています'],
  synced: ['同期済み', 'ほかの端末でも同じ内容が見られます'],
  offline: ['オフライン', '変更はこの端末に保存され、つながったときに同期します'],
  error: ['同期できませんでした', ''],
};
const sync = { state: HAS_CLOUD ? 'syncing' : 'local', error: '', fromCache: true, pending: false };

function setSync(s, error = '') {
  sync.state = s;
  sync.error = error;
  $('#syncBadge').dataset.state = s;
  $('#accDot').dataset.state = s;
  $('#accStatus').dataset.state = s;
  $('#accStatusTitle').textContent = SYNC_TEXT[s][0];
  $('#accStatusSub').textContent = error || SYNC_TEXT[s][1];
  $('#menuBtn').setAttribute('aria-label', s === 'offline' || s === 'error' ? `設定(${SYNC_TEXT[s][0]})` : '設定');
}

// Firestore の状態とネットワークから、いまの同期状態を決める
function evalSync(justWrote) {
  if (repo.mode !== 'cloud') return setSync('local');
  if (sync.state === 'error' && !justWrote) return;
  if (justWrote) sync.pending = true;
  if (!navigator.onLine) return setSync('offline');
  setSync(sync.pending || sync.fromCache ? 'syncing' : 'synced');
}
window.addEventListener('online', () => evalSync());
window.addEventListener('offline', () => evalSync());

/* ---------------- アカウント ---------------- */
const PERSON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4 20c1.2-4 4.4-6 8-6s6.8 2 8 6z" fill="currentColor"/></svg>';

function paintAvatar(node, user) {
  node.innerHTML = '';
  if (user && user.photo) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { node.textContent = (user.name || user.email || '?').trim().charAt(0).toUpperCase(); };
    img.src = user.photo;
    node.append(img);
  } else if (user) {
    node.textContent = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
  } else {
    node.innerHTML = PERSON;
  }
}

function renderAccount() {
  const u = state.user;
  paintAvatar($('#accAvatar'), u);
  $('#accUser').hidden = !u;
  $('#accName').textContent = u ? u.name || 'Google アカウント' : '';
  $('#accEmail').textContent = u ? u.email : '';
  $('#accSignIn').hidden = !!u || !HAS_CLOUD;
  $('#signOutBtn').hidden = !u;
  // すでにアプリとして開いているときは「ホーム画面に追加」を出さない
  $('#accInstallRow').hidden = isStandalone();
  $('#installSub').textContent = deferredInstall
    ? 'アプリのように全画面で使えます'
    : 'Chrome のメニュー(⋮)→「ホーム画面に追加」からも追加できます';
}

/* ---------------- 設定(ジャンル・種類の選択肢) ---------------- */
function saveSettings() {
  prefs.set('settings', state.settings);
  if (repo.mode === 'cloud' && repo.cloud) repo.cloud.putSettings(state.settings);
  settingsChanged();
}

// 選択肢が変わったら、開いている画面に反映する
function settingsChanged() {
  renderCatEditors();
  renderChips();
  if ($('#formOv').getAttribute('aria-hidden') === 'false') { renderGenrePicks(); renderCoursePicks(); }
}

function renderCatEditor(ul, kind, noun) {
  ul.innerHTML = '';
  const list = state.settings[kind];
  if (!list.length) ul.append(el('li', 'empty-note', `${noun}はまだありません`));
  list.forEach((name) => {
    const li = el('li');
    li.append(el('span', null, name));
    const del = el('button');
    del.type = 'button';
    del.innerHTML = ICON.close;
    del.setAttribute('aria-label', `「${name}」を選択肢から外す`);
    del.onclick = () => {
      state.settings[kind] = state.settings[kind].filter((x) => x !== name);
      saveSettings();
      toast(`「${name}」を選択肢から外しました`);
    };
    li.append(del);
    ul.append(li);
  });
}

function renderCatEditors() {
  renderCatEditor($('#genreEdit'), 'genres', 'ジャンル');
  renderCatEditor($('#courseEdit'), 'courses', '種類');
}

document.querySelectorAll('.add-row').forEach((f) => f.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = f.querySelector('input');
  const kind = f.dataset.kind;
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return input.focus();
  if (state.settings[kind].includes(name)) {
    toast(`「${name}」はすでにあります`);
    return input.select();
  }
  if (state.settings[kind].length >= 30) return toast('これ以上は追加できません(30個まで)');
  state.settings[kind] = [...state.settings[kind], name];
  input.value = '';
  saveSettings();
}));

function openSettings(origin) {
  renderAccount();
  renderCatEditors();
  openOverlay($('#settingsOv'), origin);
}
$('#menuBtn').addEventListener('click', (e) => openSettings(e.currentTarget));

function cloudReady() {
  return new Promise((resolve, reject) => {
    if (repo.cloud) return resolve(repo.cloud);
    const start = Date.now();
    const iv = setInterval(() => {
      if (repo.cloud) { clearInterval(iv); resolve(repo.cloud); }
      else if (Date.now() - start > 10000) { clearInterval(iv); reject(new Error('load-failed')); }
    }, 100);
  });
}

function signInErrorText(e) {
  const code = (e && (e.code || e.message)) || '';
  if (code === 'load-failed' || code === 'auth/network-request-failed') return 'インターネットにつながっていないようです。接続を確認してください。';
  if (code === 'auth/unauthorized-domain') return 'このURLが Firebase の「承認済みドメイン」に登録されていません。';
  if (code === 'auth/operation-not-allowed') return 'Firebase で Google ログインが有効になっていません。';
  return `ログインできませんでした(${code})`;
}

async function signIn(btn, errorEl) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'ログインしています…';
  if (errorEl) errorEl.hidden = true;
  try {
    const cloud = await cloudReady();
    await cloud.signIn();
  } catch (e) {
    const msg = signInErrorText(e);
    if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; } else toast(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('#gateSignIn').addEventListener('click', (e) => signIn(e.currentTarget, $('#gateError')));
$('#accSignIn').addEventListener('click', (e) => signIn(e.currentTarget));
$('#gateLocal').addEventListener('click', () => {
  prefs.set('localOnly', true);
  closeOverlay($('#gateOv'));
  loadLocal();
});
$('#signOutBtn').addEventListener('click', async () => {
  closeOverlay($('#settingsOv'));
  try { await repo.cloud.signOut(); } catch { toast('ログアウトできませんでした'); }
});

function clearRecipes() {
  cardNodes.forEach((n) => n.remove());
  cardNodes.clear();
  state.recipes = [];
  state.loaded = false;
  renderChips();
  renderGrid();
}

/* ---------------- クラウドとの接続(cloud.js から呼ばれる) ---------------- */
window.RB = {
  attachCloud(api) { repo.cloud = api; },

  onAuth(user) {
    state.user = user;
    renderAccount();
    clearRecipes();
    if (user) {
      repo.mode = 'cloud';
      prefs.set('localOnly', false);
      closeOverlay($('#gateOv'));
      sync.fromCache = true;
      sync.pending = false;
      setSync('syncing');
      migrateLocal(user);
    } else {
      repo.mode = 'local';
      if (prefs.get('localOnly', false)) loadLocal();
      else openOverlay($('#gateOv'));
    }
  },

  onSnapshot({ changes, fromCache, pending }) {
    let changed = !state.loaded;
    for (const c of changes) {
      const old = getRecipe(c.id);
      if (c.type === 'removed') {
        if (!old) continue;
        state.recipes = state.recipes.filter((x) => x.id !== c.id);
        removeCardNode(c.id);
        if (state.detailId === c.id) closeOverlay($('#detailOv'));
        changed = true;
        continue;
      }
      const r = normalizeRecipe(c.data);
      if (needsMigration(c.data) && !pending) repo.put(r).catch(() => {});
      if (!old) {
        state.recipes.push(r);
        changed = true;
      } else if (JSON.stringify(old) !== JSON.stringify(r)) {
        // ほかの端末での変更を反映
        state.recipes = state.recipes.map((x) => (x.id === r.id ? r : x));
        refreshCard(r.id);
        refreshOpenDetail(r);
        changed = true;
      }
    }
    if (!state.loaded) {
      state.loaded = true;
      handlePendingShare();
    }
    if (changed) { renderChips(); renderGrid(); }
    sync.fromCache = fromCache;
    sync.pending = pending;
    if (sync.state === 'error' && !fromCache) sync.state = 'syncing';
    evalSync();
  },

  // ほかの端末で選択肢を変えたとき。まだクラウドに無ければ、この端末の設定を送る
  onSettings(data) {
    if (!data) {
      if (JSON.stringify(state.settings) !== JSON.stringify(DEFAULT_SETTINGS)) repo.cloud.putSettings(state.settings);
      return;
    }
    const next = normalizeSettings(data);
    if (JSON.stringify(next) === JSON.stringify(state.settings)) return;
    state.settings = next;
    prefs.set('settings', next);
    settingsChanged();
  },

  onSyncError(err) {
    const code = (err && err.code) || '';
    setSync('error', code === 'permission-denied'
      ? '保存先への権限がありません(セキュリティルールを確認してください)'
      : `しばらくしてからもう一度試してください(${code || 'unknown'})`);
  },
};

function refreshOpenDetail(r) {
  if ($('#detailOv').getAttribute('aria-hidden') !== 'false' || state.detailId !== r.id) return;
  renderHero(r);
  renderPills(r);
  $('#dTitle').textContent = r.name;
  renderFav(r);
  renderStars(r);
  renderActions(r);
  $('#dIngBlock').classList.add('no-anim');
  renderIngredients(r);
  renderSteps(r);
  renderTags(r);
  renderMemo(r);
  renderLog(r);
}

// この端末にだけ保存されていたレシピを、初回ログイン時にクラウドへ移す
async function migrateLocal(user) {
  const key = 'migrated:' + user.uid;
  if (prefs.get(key, false)) return;
  let local = [];
  try { local = (await db.all()).map(normalizeRecipe); } catch { /* 端末側に保存がない */ }
  prefs.set(key, true);
  if (!local.length) return;
  let ok = 0;
  for (const r of local) {
    try { await repo.put(r); ok++; } catch { /* 大きすぎる1件は飛ばす */ }
  }
  toast(`この端末のレシピ ${ok} 件をクラウドに移しました`);
}

// 旧形式(category や「主菜」などの旧い種類名)のデータは新形式で保存し直す
const needsMigration = (raw) => !('genre' in raw) || !!COURSE_MAP[raw.course];

async function loadLocal() {
  repo.mode = 'local';
  try {
    const raw = await db.all();
    state.recipes = raw.map(normalizeRecipe);
    // 旧形式(category)のデータを新形式で保存し直す
    for (const r of raw) if (needsMigration(r)) await db.put(getRecipe(r.id));
  } catch {
    toast('このブラウザでは保存機能が使えません');
  }
  state.loaded = true;
  renderChips();
  renderGrid();
  setSync('local');
  handlePendingShare();
}

/* ---------------- 共有メニューから開かれたとき ---------------- */
let pendingShare = null;
(function readShare() {
  const p = new URLSearchParams(location.search);
  if (!['share_url', 'share_text', 'share_title'].some((k) => p.has(k))) return;
  const all = ['share_url', 'share_text', 'share_title'].map((k) => p.get(k) || '').join(' ').trim();
  const url = (all.match(/https?:\/\/[^\s]+/) || [])[0] || '';
  const title = (p.get('share_title') || '').trim();
  pendingShare = {
    videoUrl: url,
    name: /^https?:\/\//.test(title) ? '' : title.slice(0, 80),
    memo: url ? '' : all,
  };
  history.replaceState(null, '', location.pathname);
})();

function handlePendingShare() {
  if (!pendingShare) return;
  const preset = pendingShare;
  pendingShare = null;
  openForm(null, preset);
}

/* ---------------- アプリ化(PWA) ---------------- */
let deferredInstall = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  renderAccount();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  renderAccount();
  toast('ホーム画面に追加しました');
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredInstall) {
    toast('Chrome のメニュー(⋮)→「ホーム画面に追加」から追加してください');
    return;
  }
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  renderAccount();
  if (choice.outcome === 'accepted') closeOverlay($('#settingsOv'));
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
}

/* ---------------- Init ---------------- */
(function init() {
  syncTools();
  renderAccount();
  onScroll();
  if (!HAS_CLOUD) {
    loadLocal();
    return;
  }
  setSync('syncing');
  const s = document.createElement('script');
  s.type = 'module';
  s.src = 'cloud.js';
  document.head.append(s);
  // 同期の仕組みを読み込めないとき(初回オフラインなど)は、ログイン画面で理由を伝える
  setTimeout(() => {
    if (repo.cloud) return;
    setSync('error', '同期の仕組みを読み込めませんでした');
    $('#gateError').textContent = 'インターネットにつながっていないようです。接続してから開き直すか、この端末だけで使ってください。';
    $('#gateError').hidden = false;
    openOverlay($('#gateOv'));
  }, 10000);
})();
