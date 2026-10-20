'use strict';

/* =========================================================
   Recipe Box — データはこのブラウザの IndexedDB に保存
   ========================================================= */

const DEFAULT_CATS = ['和食', '洋食', '中華', 'エスニック', 'デザート', 'その他'];
const $ = (s) => document.querySelector(s);

const state = {
  recipes: [],
  query: '',
  cat: 'all',
  editingId: null,
  photo: null,       // dataURL（フォーム編集中）
  formCat: '',
  detailId: null,
  sugIndex: -1,
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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

/* ---------------- Search ---------------- */
function haystack(r) {
  return norm([r.name, r.category, r.ingredients, r.memo].join(' '));
}

function matches(r) {
  if (state.cat !== 'all' && r.category !== state.cat) return false;
  const tokens = norm(state.query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const h = haystack(r);
  return tokens.every((t) => h.includes(t));
}

function suggestions(q) {
  const nq = norm(q.trim());
  if (!nq) return [];
  return state.recipes
    .map((r) => {
      const n = norm(r.name);
      const i = n.indexOf(nq);
      let score;
      if (i === 0) score = 0;
      else if (i > 0) score = 1;
      else if (haystack(r).includes(nq)) score = 2;
      else return null;
      return { r, score, i };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length)
    .slice(0, 6);
}

/* ---------------- Grid (FLIP アニメーション付き) ---------------- */
const cardNodes = new Map();

function makeCard(r) {
  const card = el('article', 'card');
  card.tabIndex = 0;
  card.dataset.id = r.id;
  const imgWrap = el('div', 'card-img');
  if (r.photo) imgWrap.append(makeImg(r.photo));
  else imgWrap.textContent = '🍽';
  const body = el('div', 'card-body');
  body.append(el('h3', null, r.name), el('p', null, r.category || 'その他'));
  card.append(imgWrap, body);
  return card;
}

function sorted() {
  return [...state.recipes].sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderGrid() {
  const grid = $('#grid');
  const before = new Map();
  cardNodes.forEach((node, id) => {
    if (!node.hidden && node.isConnected) before.set(id, node.getBoundingClientRect());
  });

  const list = sorted();
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
    const id = node.dataset.id;
    const prev = before.get(id);
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

function removeCardNode(id) {
  const n = cardNodes.get(id);
  if (n) n.remove();
  cardNodes.delete(id);
}

function renderCount(n) {
  const total = state.recipes.length;
  $('#count').textContent = total ? (n === total ? `${total} 件のレシピ` : `${n} / ${total} 件`) : '';
}

function renderEmpty(n) {
  const empty = $('#empty');
  if (n) { empty.hidden = true; return; }
  empty.hidden = false;
  const none = !state.recipes.length;
  $('#emptyTitle').textContent = none ? 'まだレシピがありません' : '見つかりませんでした';
  $('#emptyText').textContent = none
    ? '写真と料理名を登録して、自分だけのレシピ帳をつくりましょう。'
    : state.query ? `「${state.query}」に一致するレシピはありません。` : 'このカテゴリーにはまだレシピがありません。';
  $('#emptyAdd').hidden = !none;
  // 再表示のたびにアニメーションを再生
  empty.style.animation = 'none';
  void empty.offsetWidth;
  empty.style.animation = '';
}

/* ---------------- Categories ---------------- */
function allCategories() {
  const used = state.recipes.map((r) => r.category).filter(Boolean);
  return [...new Set([...DEFAULT_CATS, ...used])];
}

function renderChips() {
  const chips = $('#chips');
  chips.innerHTML = '';
  const counts = {};
  state.recipes.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  const cats = allCategories().filter((c) => counts[c]);
  if (state.cat !== 'all' && !counts[state.cat]) state.cat = 'all';

  const add = (key, label, n) => {
    const b = el('button', 'chip' + (state.cat === key ? ' active' : ''), label);
    b.type = 'button';
    b.append(el('span', 'n', String(n)));
    b.onclick = () => {
      if (state.cat === key) return;
      state.cat = key;
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      renderGrid();
    };
    chips.append(b);
  };
  chips.hidden = !state.recipes.length;
  add('all', 'すべて', state.recipes.length);
  cats.forEach((c) => add(c, c, counts[c]));
}

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

function renderSuggest() {
  const items = suggestions(qInput.value);
  sugBox.innerHTML = '';
  state.sugIndex = -1;
  items.forEach(({ r }, i) => {
    const li = el('li');
    li.setAttribute('role', 'option');
    li.style.setProperty('--i', i);
    li.dataset.id = r.id;
    const thumb = el('span', 'thumb');
    if (r.photo) thumb.append(makeImg(r.photo)); else thumb.textContent = '🍽';
    const name = el('span', 's-name');
    name.append(highlight(r.name, qInput.value));
    li.append(thumb, name, el('span', 's-cat', r.category || ''));
    li.addEventListener('mousedown', (e) => { e.preventDefault(); pickSuggestion(r.id, li); });
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

function pickSuggestion(id, fromEl) {
  closeSuggest();
  qInput.blur();
  openDetail(id, fromEl);
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
    if (li) pickSuggestion(li.dataset.id, li);
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
let lastFocus = null;
function openOverlay(ov, origin) {
  lastFocus = document.activeElement;
  const sheet = ov.querySelector('.sheet');
  if (origin) {
    // タップしたカードの位置からシートが広がるように
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
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
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

function block(container, title, listEl) {
  container.innerHTML = '';
  if (!listEl) return;
  container.append(el('h4', null, title), listEl);
}

function listOf(tag, cls, items) {
  if (!items.length) return null;
  const list = el(tag, cls);
  items.forEach((t, i) => {
    const li = el('li', null, t);
    li.style.setProperty('--i', i);
    list.append(li);
  });
  return list;
}

function openDetail(id, origin) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return;
  state.detailId = id;
  const img = $('#dImg');
  img.innerHTML = '';
  if (r.photo) img.append(makeImg(r.photo)); else img.textContent = '🍽';
  $('#dCat').textContent = r.category || 'その他';
  $('#dTitle').textContent = r.name;
  block($('#dIng'), '材料', listOf('ul', 'ing', lines(r.ingredients)));
  block($('#dSteps'), '作り方', listOf('ol', 'steps', lines(r.steps)));
  const memo = $('#dMemo');
  memo.innerHTML = '';
  if (r.memo && r.memo.trim()) {
    const p = el('div', 'memo');
    p.append(linkify(r.memo.trim()));
    memo.append(el('h4', null, 'メモ'), p);
  }
  resetDelete();
  openOverlay($('#detailOv'), origin);
}

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

/* ---------------- Form ---------------- */
const form = $('#form');
const fName = $('#fName');
const fNewCat = $('#fNewCat');

function renderCatPicks() {
  const box = $('#catPicks');
  box.innerHTML = '';
  allCategories().forEach((c) => {
    const b = el('button', 'cat-pick' + (state.formCat === c && !fNewCat.value.trim() ? ' active' : ''), c);
    b.type = 'button';
    b.onclick = () => {
      state.formCat = c;
      fNewCat.value = '';
      box.querySelectorAll('.cat-pick').forEach((x) => x.classList.toggle('active', x === b));
    };
    box.append(b);
  });
}
fNewCat.addEventListener('input', () => {
  const v = fNewCat.value.trim();
  document.querySelectorAll('.cat-pick').forEach((x) => x.classList.toggle('active', !v && x.textContent === state.formCat));
});

function setPhoto(dataUrl) {
  state.photo = dataUrl;
  const prev = $('#photoPrev');
  const drop = $('#photoDrop');
  if (dataUrl) {
    prev.src = dataUrl;
    prev.hidden = false;
    // 画像が変わるたびにアニメーションを再生
    prev.style.animation = 'none'; void prev.offsetWidth; prev.style.animation = '';
  } else {
    prev.removeAttribute('src');
    prev.hidden = true;
  }
  $('#photoHint').hidden = !!dataUrl;
  $('#photoRemove').hidden = !dataUrl;
  drop.classList.toggle('filled', !!dataUrl);
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}
form.querySelectorAll('textarea').forEach((t) => t.addEventListener('input', () => autoGrow(t)));

function openForm(id = null) {
  const r = id ? state.recipes.find((x) => x.id === id) : null;
  state.editingId = r ? r.id : null;
  $('#formTitle').textContent = r ? 'レシピを編集' : '新しいレシピ';
  fName.value = r ? r.name : '';
  fNewCat.value = '';
  state.formCat = r ? r.category : (state.cat !== 'all' ? state.cat : DEFAULT_CATS[0]);
  $('#fIng').value = r ? r.ingredients || '' : '';
  $('#fSteps').value = r ? r.steps || '' : '';
  $('#fMemo').value = r ? r.memo || '' : '';
  setPhoto(r ? r.photo : null);
  renderCatPicks();
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
  const now = Date.now();
  const prev = state.editingId ? state.recipes.find((x) => x.id === state.editingId) : null;
  const recipe = {
    id: prev ? prev.id : uid(),
    name,
    category: fNewCat.value.trim() || state.formCat || 'その他',
    photo: state.photo,
    ingredients: $('#fIng').value.trim(),
    steps: $('#fSteps').value.trim(),
    memo: $('#fMemo').value.trim(),
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
  };
  try {
    await db.put(recipe);
  } catch {
    return toast('保存できませんでした（容量不足の可能性があります）');
  }
  if (prev) {
    state.recipes = state.recipes.map((x) => (x.id === prev.id ? recipe : x));
    removeCardNode(prev.id);
  } else {
    state.recipes.push(recipe);
  }
  closeOverlay($('#formOv'));
  renderChips();
  renderGrid();
  toast(prev ? '更新しました' : '保存しました');
  window.scrollTo({ top: $('#chips').offsetTop - 80, behavior: 'smooth' });
});

/* ---------------- Card click ---------------- */
$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openDetail(card.dataset.id, card);
});
$('#grid').addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(card.dataset.id, card); }
});

/* ---------------- Backup ---------------- */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'recipe-box', version: 1, recipes: state.recipes })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recipes-${new Date().toISOString().slice(0, 10)}.json`;
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
    for (const r of list) {
      const clean = {
        id: String(r.id), name: String(r.name), category: String(r.category || 'その他'),
        photo: typeof r.photo === 'string' && r.photo.startsWith('data:image/') ? r.photo : null,
        ingredients: String(r.ingredients || ''), steps: String(r.steps || ''), memo: String(r.memo || ''),
        createdAt: +r.createdAt || Date.now(), updatedAt: +r.updatedAt || Date.now(),
      };
      await db.put(clean);
      removeCardNode(clean.id);
    }
    state.recipes = await db.all();
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
  try {
    state.recipes = await db.all();
  } catch {
    toast('このブラウザでは保存機能が使えません');
  }
  renderChips();
  renderGrid();
  onScroll();
})();
