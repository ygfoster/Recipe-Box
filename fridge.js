'use strict';

/* =========================================================
   食材から探す(app.js・plan.js の関数を使う)
   冷蔵庫にある食材を入れると、登録済みのレシピを
   「すぐ作れる → 足りないものが少ない」順に並べる
   ========================================================= */

const fridge = {
  items: Array.isArray(prefs.get('fridge', [])) ? prefs.get('fridge', []).map(String).slice(0, 60) : [],
  seasonOk: prefs.get('fridgeSeasonOk', true), // 調味料は家にあるものとして探す
};

function saveFridge() {
  prefs.set('fridge', fridge.items);
  prefs.set('fridgeSeasonOk', fridge.seasonOk);
}

// 「玉ねぎ」で「新玉ねぎ」も、「卵」で「卵黄」も見つかるようにする
function keyMatches(recipeKey, haveKey) {
  if (recipeKey === haveKey) return true;
  const inside = (a, b) => (b.length >= 2 ? a.includes(b) : a.startsWith(b));
  return inside(recipeKey, haveKey) || inside(haveKey, recipeKey);
}

// レシピごとの材料(見出し・水は除く)
function recipeNeeds(r) {
  const out = [];
  const seen = new Set();
  let header = '';
  lines(r.ingredients).forEach((line) => {
    const p = parseIngredient(line);
    if (p.header) { header = p.name; return; }
    const key = ingKey(p.name);
    if (!key || SKIP_ITEMS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: stripNote(p.name), amount: p.amount || '', season: isSeasoning(p.name, header) });
  });
  return out;
}

// 登録済みレシピに出てくる食材(入力候補とよく使う食材に使う)
function knownIngredients() {
  const map = new Map();
  state.recipes.forEach((r) => recipeNeeds(r).forEach((n) => {
    const it = map.get(n.key) || { key: n.key, name: n.name, season: n.season, count: 0 };
    it.count++;
    map.set(n.key, it);
  }));
  return [...map.values()];
}

// よく使う食材:設定で決めていればそれを、なければ登録レシピによく出てくるものを使う
function autoStaples() {
  return knownIngredients()
    .filter((it) => !it.season)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
    .slice(0, 14)
    .map((it) => it.name);
}
function effectiveStaples() {
  return Array.isArray(state.settings.staples) ? state.settings.staples : autoStaples();
}

function searchByFridge() {
  const have = fridge.items.map((x) => ingKey(x));
  if (!have.length) return [];
  return state.recipes
    .map((r) => {
      const needs = recipeNeeds(r).filter((n) => !(fridge.seasonOk && n.season));
      if (!needs.length) return null;
      const used = needs.filter((n) => have.some((h) => keyMatches(n.key, h)));
      if (!used.length) return null;
      const missing = needs.filter((n) => !used.includes(n));
      return { r, used, missing };
    })
    .filter(Boolean)
    .sort((a, b) => a.missing.length - b.missing.length || b.used.length - a.used.length
      || b.r.favorite - a.r.favorite || a.r.name.localeCompare(b.r.name, 'ja'));
}

/* ---------------- 画面 ---------------- */
function openFridge(origin) {
  $('#fridgeInput').value = '';
  $('#fridgeSeason').checked = fridge.seasonOk;
  renderFridge(true);
  openOverlay($('#fridgeOv'), origin);
}

function renderFridge(animate) {
  // 入れた食材
  const chips = $('#fridgeChips');
  chips.innerHTML = '';
  fridge.items.forEach((name) => {
    const li = el('li');
    li.append(el('span', null, name));
    const del = el('button');
    del.type = 'button';
    del.innerHTML = ICON.close;
    del.setAttribute('aria-label', `「${name}」を外す`);
    del.onclick = () => {
      fridge.items = fridge.items.filter((x) => x !== name);
      saveFridge();
      renderFridge();
    };
    li.append(del);
    chips.append(li);
  });
  chips.hidden = !fridge.items.length;
  $('#fridgeClear').hidden = !fridge.items.length;

  // よく使う食材(ワンタップで追加)
  const haveKeys = fridge.items.map((x) => ingKey(x));
  const quick = effectiveStaples().filter((name) => !haveKeys.includes(ingKey(name)));
  const qbox = $('#fridgeQuick');
  qbox.innerHTML = '';
  quick.forEach((name) => qbox.append(addChip(name)));
  // 全部入れ終わっても「編集」から変えられるよう、見出しは出したままにする
  $('#fridgeQuickWrap').hidden = !effectiveStaples().length && !Array.isArray(state.settings.staples);
  $('#fridgeQuickNone').hidden = !!quick.length;

  renderFridgeSuggest();
  renderFridgeResults(animate);
}

function addChip(name) {
  const b = el('button', 'chip add-chip');
  b.type = 'button';
  b.innerHTML = PLUS;
  b.append(name);
  b.onclick = () => addFridgeItem(name);
  return b;
}

function addFridgeItem(raw) {
  const name = stripNote(String(raw).normalize('NFKC').trim()).slice(0, 20);
  if (!name) return;
  const key = ingKey(name);
  if (fridge.items.some((x) => ingKey(x) === key)) {
    toast(`「${name}」はもう入っています`);
    return;
  }
  fridge.items = [...fridge.items, name].slice(-60);
  saveFridge();
  $('#fridgeInput').value = '';
  renderFridge();
}

// 入力中の候補(登録済みレシピに出てくる食材から)
function renderFridgeSuggest() {
  const box = $('#fridgeSuggest');
  box.innerHTML = '';
  const q = norm($('#fridgeInput').value.trim());
  if (!q) { box.hidden = true; return; }
  const haveKeys = fridge.items.map((x) => ingKey(x));
  const list = knownIngredients()
    .filter((it) => !haveKeys.includes(it.key) && (norm(it.name).includes(q) || it.key.includes(q)))
    .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || b.count - a.count)
    .slice(0, 8);
  list.forEach((it) => box.append(addChip(it.name)));
  box.hidden = !list.length;
}

function renderFridgeResults(animate) {
  const ul = $('#fridgeResults');
  ul.innerHTML = '';
  ul.classList.toggle('animate', !!animate);
  const results = searchByFridge();
  const ready = results.filter((x) => !x.missing.length).length;
  $('#fridgeCount').textContent = !fridge.items.length ? '' : results.length
    ? (ready ? `すぐ作れる ${ready}品 · 候補 ${results.length}品` : `候補 ${results.length}品`)
    : '';

  results.slice(0, 60).forEach((x, i) => {
    const li = el('li', 'fr-item' + (x.missing.length ? '' : ' ready'));
    li.style.setProperty('--i', Math.min(i, 12));
    const open = el('button', 'fr-main');
    open.type = 'button';
    const thumb = el('span', 'pick-thumb');
    const img = heroImage(x.r);
    if (img) thumb.append(img); else thumb.textContent = '🍽';
    const text = el('span', 'fr-text');
    text.append(el('b', null, x.r.name));
    // 主役は「足りないもの」。使う食材は補足として小さく
    if (x.missing.length) {
      const miss = el('span', 'fr-missing');
      miss.append(el('em', null, `あと${x.missing.length}つ`), x.missing.map((n) => n.name).join('・'));
      text.append(miss);
    } else {
      text.append(el('span', 'fr-ready', '材料がそろっています'));
    }
    text.append(el('span', 'fr-used', `使う食材:${x.used.map((n) => n.name).join('・')}`));
    open.append(thumb, text);
    open.onclick = () => {
      closeOverlay($('#fridgeOv'));
      setTimeout(() => openDetail(x.r.id), 180);
    };
    li.append(open);
    if (x.missing.length) {
      const add = el('button', 'link small fr-add', '足りないものを買い物リストへ');
      add.type = 'button';
      add.onclick = () => addMissingToShop(x);
      li.append(add);
    }
    ul.append(li);
  });

  const empty = $('#fridgeEmpty');
  empty.hidden = !!results.length;
  empty.textContent = !state.recipes.length
    ? 'まだレシピがありません。レシピを登録すると、ここから探せます。'
    : !fridge.items.length
      ? '冷蔵庫にある食材を入れてください。'
      : '入れた食材を使うレシピは見つかりませんでした。';
}

async function addMissingToShop(x) {
  const ops = [];
  let skipped = 0;
  const now = Date.now();
  x.missing.forEach((n, i) => {
    // まだ買っていない同じものがあれば二重に入れない
    if (state.shop.some((s) => !s.checked && s.key === n.key)) { skipped++; return; }
    ops.push({
      type: 'put',
      d: normalizeShopItem({
        id: uid(), key: n.key, name: n.name, amount: n.amount, recipes: [x.r.name],
        group: n.season ? 'season' : 'food', source: 'manual', checked: false, createdAt: now + i,
      }),
    });
  });
  if (ops.length) await writeDocs('shopping', ops);
  renderShopCount();
  toast(ops.length
    ? `${ops.length}点を買い物リストに入れました${skipped ? `(${skipped}点はすでにリストにあります)` : ''}`
    : 'すべてすでに買い物リストにあります');
}

$('#fridgeBtn').addEventListener('click', (e) => openFridge(e.currentTarget));
$('#fridgeEditStaples').addEventListener('click', (e) => openSettings(e.currentTarget));
$('#fridgeAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#fridgeInput').value;
  if (!v.trim()) return $('#fridgeInput').focus();
  // スペース区切りでまとめて入れられる(例:「卵 玉ねぎ ピーマン」)
  v.split(/[\s　、,]+/).filter(Boolean).forEach(addFridgeItem);
});
$('#fridgeInput').addEventListener('input', renderFridgeSuggest);
$('#fridgeSeason').addEventListener('change', (e) => {
  fridge.seasonOk = e.target.checked;
  saveFridge();
  renderFridgeResults();
});
$('#fridgeClear').addEventListener('click', () => {
  fridge.items = [];
  saveFridge();
  renderFridge();
});
