'use strict';

/* =========================================================
   献立と買い物リスト(app.js の関数・状態を使う)
   ========================================================= */

const MEALS = [
  { id: 'breakfast', label: '朝', long: '朝ごはん' },
  { id: 'lunch', label: '昼', long: '昼ごはん' },
  { id: 'dinner', label: '晩', long: '晩ごはん' },
];
const PLAN_DAYS = [3, 7, 14];
const WEEKDAYS = '日月火水木金土';
const PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

Object.assign(state, {
  plan: [],
  shop: [],
  tab: prefs.get('tab', 'recipes'),
  planDays: PLAN_DAYS.includes(prefs.get('planDays', 7)) ? prefs.get('planDays', 7) : 7,
});
const justAdded = new Set(); // 追加した直後の1品だけ、ふわっと出す

/* ---------------- 日付 ---------------- */
function dayFromToday(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}
function fmtDay(date) {
  const d = new Date(date + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}
function relDay(date) {
  if (date === dayFromToday(0)) return '今日';
  if (date === dayFromToday(1)) return '明日';
  return '';
}
const mealOf = (id) => MEALS.find((m) => m.id === id) || MEALS[2];
const planRange = () => ({ from: dayFromToday(0), to: dayFromToday(state.planDays - 1) });
function planInRange() {
  const { from, to } = planRange();
  return state.plan.filter((e) => e.date >= from && e.date <= to);
}

/* ---------------- データ ---------------- */
function normalizeEntry(e) {
  return {
    id: String(e.id || uid()),
    date: String(e.date || '').slice(0, 10),
    meal: MEALS.some((m) => m.id === e.meal) ? e.meal : 'dinner',
    recipeId: String(e.recipeId || ''),
    servings: Math.max(1, Math.min(20, Math.round(+e.servings || 2))),
    createdAt: +e.createdAt || Date.now(),
  };
}

function normalizeShopItem(s) {
  return {
    id: String(s.id || uid()),
    key: String(s.key || ''),
    name: String(s.name || '').trim() || '(名前なし)',
    amount: String(s.amount || ''),
    recipes: Array.isArray(s.recipes) ? s.recipes.map(String).slice(0, 10) : [],
    group: ['food', 'season', 'manual'].includes(s.group) ? s.group : 'manual',
    source: s.source === 'plan' ? 'plan' : 'manual',
    checked: !!s.checked,
    createdAt: +s.createdAt || Date.now(),
  };
}

const STATE_KEY = { plan: 'plan', shopping: 'shop' };

// 画面にすぐ反映してから保存する(クラウドの場合はつながったときに同期)
async function writeDocs(store, ops) {
  const key = STATE_KEY[store];
  let arr = state[key];
  ops.forEach((op) => {
    arr = arr.filter((x) => x.id !== (op.type === 'del' ? op.id : op.d.id));
    if (op.type !== 'del') arr.push(op.d);
  });
  state[key] = arr;
  try {
    await repo.batch(store, ops);
  } catch {
    toast('保存できませんでした');
  }
}

async function loadPlanLocal() {
  try {
    state.plan = (await db.all('plan')).map(normalizeEntry);
    state.shop = (await db.all('shopping')).map(normalizeShopItem);
  } catch { /* 保存機能が使えないブラウザ */ }
  renderShopCount();
  renderActiveView();
}

function resetPlanData() {
  state.plan = [];
  state.shop = [];
  renderShopCount();
  renderActiveView();
}

// ほかの端末での変更(cloud.js から呼ばれる)
RB.onCollection = (store, changes) => {
  const key = STATE_KEY[store];
  if (!key) return;
  const normalize = store === 'plan' ? normalizeEntry : normalizeShopItem;
  let arr = state[key];
  let changed = false;
  changes.forEach((c) => {
    if (c.type === 'removed') {
      if (arr.some((x) => x.id === c.id)) { arr = arr.filter((x) => x.id !== c.id); changed = true; }
      return;
    }
    const d = normalize({ ...c.data, id: c.id });
    const old = arr.find((x) => x.id === d.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(d)) {
      arr = arr.filter((x) => x.id !== d.id).concat(d);
      changed = true;
    }
  });
  state[key] = arr;
  if (!changed) return;
  renderShopCount();
  if ((key === 'plan' && state.tab === 'plan') || (key === 'shop' && state.tab === 'shop')) renderActiveView();
};

// レシピが追加・編集・削除されたとき(app.js の renderChips から呼ばれる)
function recipesChanged() {
  if (state.tab === 'plan') renderPlan();
}

/* ---------------- 画面の切り替え ---------------- */
const VIEWS = { recipes: '#viewRecipes', plan: '#viewPlan', shop: '#viewShop' };

function switchTab(tab, instant) {
  if (!VIEWS[tab]) tab = 'recipes';
  const prev = state.tab;
  state.tab = tab;
  prefs.set('tab', tab);
  Object.entries(VIEWS).forEach(([k, sel]) => { $(sel).hidden = k !== tab; });
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  moveTabIndicator(instant);
  if (prev !== tab && !instant) {
    replay($(VIEWS[tab]), 'view-in');
    window.scrollTo({ top: 0 });
  }
  renderActiveView(prev !== tab);
}

function renderActiveView(animate) {
  if (state.tab === 'plan') renderPlan(animate);
  else if (state.tab === 'shop') renderShop(animate);
}

function moveTabIndicator(instant) {
  const active = document.querySelector('.tab.active');
  const ind = document.querySelector('.tab-ind');
  if (!active || !ind) return;
  ind.style.transition = instant ? 'none' : '';
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}

// タブの切り替えも「戻る」に対応させる(Android の標準どおり、献立・買い物から戻るとレシピへ)
function goTab(tab) {
  if (tab === state.tab) return;
  const st = history.state || {};
  if (tab === 'recipes') {
    if (st.tab && st.tab !== 'recipes' && !st.ov) { history.back(); return; } // popstate でレシピへ
    switchTab('recipes');
    history.replaceState({ tab: 'recipes' }, '');
  } else if (state.tab === 'recipes') {
    history.pushState({ tab }, '');
    switchTab(tab);
  } else {
    history.replaceState({ tab }, '');
    switchTab(tab);
  }
}

// 「戻る」で履歴が変わったとき(app.js の popstate から呼ばれる)
function onHistoryTab(tab) {
  if (tab !== state.tab) switchTab(tab);
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.goto)));
window.addEventListener('resize', () => moveTabIndicator(true));

/* ---------------- 献立 ---------------- */
function renderPlan(animate) {
  document.querySelectorAll('#planPeriod button').forEach((b) => {
    const on = +b.dataset.days === state.planDays;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const box = $('#planDays');
  box.innerHTML = '';
  box.classList.toggle('animate', !!animate);
  const entries = planInRange();

  for (let i = 0; i < state.planDays; i++) {
    const date = dayFromToday(i);
    const day = el('section', 'day');
    day.style.setProperty('--i', Math.min(i, 8));
    const head = el('header', 'day-head');
    head.append(el('span', 'day-date', fmtDay(date)));
    const rel = relDay(date);
    if (rel) head.append(el('span', 'day-rel', rel));
    day.append(head);

    MEALS.forEach((m) => {
      const row = el('div', 'meal-row');
      row.append(el('span', 'meal-label', m.label));
      const list = el('div', 'meal-dishes');
      entries
        .filter((e) => e.date === date && e.meal === m.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((e) => list.append(dishChip(e)));
      const add = el('button', 'meal-add');
      add.type = 'button';
      add.innerHTML = PLUS;
      add.setAttribute('aria-label', `${fmtDay(date)}の${m.long}にレシピを追加`);
      add.onclick = () => openPicker(date, m.id);
      list.append(add);
      row.append(list);
      day.append(row);
    });
    box.append(day);
  }
  justAdded.clear();
  renderPlanSummary(entries);
}

function dishChip(e) {
  const r = getRecipe(e.recipeId);
  const b = el('button', 'dish' + (r ? '' : ' missing') + (justAdded.has(e.id) ? ' pop' : ''));
  b.type = 'button';
  const thumb = el('span', 'dish-thumb');
  const img = r && heroImage(r);
  if (img) { img.classList.add('loaded'); thumb.append(img); } else thumb.textContent = r ? '🍽' : '?';
  b.append(thumb, el('span', 'dish-name', r ? r.name : '削除されたレシピ'), el('span', 'dish-serv', `${e.servings}人`));
  b.title = r ? r.name : '削除されたレシピ';
  b.onclick = () => openEntry(e.id, b);
  return b;
}

function renderPlanSummary(entries) {
  const valid = entries.filter((e) => getRecipe(e.recipeId));
  const items = buildShopping(valid);
  const { from, to } = planRange();
  $('#planCount').textContent = valid.length ? `${valid.length}品 · 材料 ${items.length}点` : '献立はまだ空です';
  $('#planRange').textContent = `${fmtDay(from)} 〜 ${fmtDay(to)}`;
  const btn = $('#makeList');
  btn.disabled = !valid.length;
  btn.textContent = state.shop.some((s) => s.source === 'plan') ? '買い物リストを更新' : '買い物リストを作る';
}

$('#planPeriod').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.planDays = +b.dataset.days;
  prefs.set('planDays', state.planDays);
  renderPlan(true);
});

/* レシピを選ぶ(その日の朝・昼・晩に入れる) */
const pick = { date: '', meal: '', course: 'all' };

function openPicker(date, meal) {
  pick.date = date;
  pick.meal = meal;
  pick.course = 'all';
  $('#pickQ').value = '';
  $('#pickTitle').textContent = `${fmtDay(date)} ${mealOf(meal).long}`;
  renderPicker();
  openOverlay($('#pickOv'));
}

function slotEntries(date, meal) {
  return state.plan.filter((e) => e.date === date && e.meal === meal);
}

function renderPicker() {
  const inSlot = slotEntries(pick.date, pick.meal);
  $('#pickSub').textContent = inSlot.length ? `${inSlot.length}品 選択中` : 'レシピを選んでください';

  // 種類で絞り込み(レシピで使われているものだけ)
  const chips = $('#pickChips');
  chips.innerHTML = '';
  const courses = allCourses().filter((c) => state.recipes.some((r) => r.course === c));
  chips.hidden = !courses.length;
  courses.forEach((c) => {
    const b = el('button', 'chip' + (pick.course === c ? ' active' : ''), c);
    b.type = 'button';
    b.onclick = () => { pick.course = pick.course === c ? 'all' : c; renderPicker(); };
    chips.append(b);
  });

  const q = norm($('#pickQ').value.trim());
  const list = state.recipes
    .filter((r) => pick.course === 'all' || r.course === pick.course)
    .filter((r) => !q || haystack(r).includes(q))
    // よく使うものを上に:お気に入り → よく作る → 評価 → 名前
    .sort((a, b) => b.favorite - a.favorite || b.cooked.length - a.cooked.length || b.rating - a.rating || a.name.localeCompare(b.name, 'ja'));

  const ul = $('#pickList');
  ul.innerHTML = '';
  list.forEach((r, i) => {
    const added = inSlot.some((e) => e.recipeId === r.id);
    const li = el('li');
    li.style.setProperty('--i', Math.min(i, 10));
    const b = el('button', 'pick-item' + (added ? ' added' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(added));
    const thumb = el('span', 'pick-thumb');
    const img = heroImage(r);
    if (img) thumb.append(img); else thumb.textContent = '🍽';
    const text = el('span', 'pick-text');
    text.append(el('b', null, r.name), el('span', null, [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ')));
    const check = el('span', 'pick-check');
    check.innerHTML = added ? ICON.check : PLUS;
    b.append(thumb, text, check);
    b.onclick = () => togglePick(r);
    li.append(b);
    ul.append(li);
  });

  const empty = $('#pickEmpty');
  empty.hidden = list.length > 0;
  empty.textContent = state.recipes.length ? '条件に合うレシピがありません' : 'まだレシピがありません。レシピ画面の右下のボタンから追加してください。';
}

async function togglePick(r) {
  const exist = slotEntries(pick.date, pick.meal).find((e) => e.recipeId === r.id);
  if (exist) {
    await writeDocs('plan', [{ type: 'del', id: exist.id }]);
  } else {
    const e = normalizeEntry({ id: uid(), date: pick.date, meal: pick.meal, recipeId: r.id, servings: r.servings, createdAt: Date.now() });
    justAdded.add(e.id);
    await writeDocs('plan', [{ type: 'put', d: e }]);
  }
  renderPicker();
  renderPlan();
}

$('#pickQ').addEventListener('input', renderPicker);

/* 献立の1品(人数の変更・外す・レシピを見る) */
let entryId = null;

function openEntry(id, origin) {
  const e = state.plan.find((x) => x.id === id);
  if (!e) return;
  entryId = id;
  const r = getRecipe(e.recipeId);
  $('#entryTitle').textContent = r ? r.name : '削除されたレシピ';
  $('#entrySub').textContent = `${fmtDay(e.date)} ${mealOf(e.meal).long}`;
  const thumb = $('#entryThumb');
  thumb.innerHTML = '';
  const img = r && heroImage(r);
  if (img) thumb.append(img); else thumb.textContent = r ? '🍽' : '?';
  $('#entryServRow').hidden = !r;
  $('#entryOpen').hidden = !r;
  paintEntryServ(e);
  openOverlay($('#entryOv'), origin);
}

function paintEntryServ(e) {
  $('#entryServVal').textContent = `${e.servings}人分`;
  $('#entryServ [data-d="-1"]').disabled = e.servings <= 1;
  $('#entryServ [data-d="1"]').disabled = e.servings >= 20;
}

$('#entryServ').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  const e = state.plan.find((x) => x.id === entryId);
  if (!b || !e) return;
  const next = { ...e, servings: Math.max(1, Math.min(20, e.servings + +b.dataset.d)) };
  paintEntryServ(next);
  await writeDocs('plan', [{ type: 'put', d: next }]);
  renderPlan();
});

$('#entryRemove').addEventListener('click', async () => {
  const e = state.plan.find((x) => x.id === entryId);
  closeOverlay($('#entryOv'));
  if (!e) return;
  await writeDocs('plan', [{ type: 'del', id: e.id }]);
  renderPlan();
  // 買い物リストを作ったあとに献立を変えたときは、作り直せることを伝える
  toast(state.shop.some((x) => x.source === 'plan' && !x.checked)
    ? '献立から外しました。買い物リストは「買い物リストを更新」で作り直せます'
    : '献立から外しました');
});

$('#entryOpen').addEventListener('click', () => {
  const e = state.plan.find((x) => x.id === entryId);
  closeOverlay($('#entryOv'));
  if (e) setTimeout(() => {
    openDetail(e.recipeId);
    // 献立の人数で材料を表示する
    const r = getRecipe(e.recipeId);
    if (r && e.servings !== r.servings) {
      state.servings = e.servings;
      $('#dIngBlock').classList.add('no-anim');
      renderIngredients(r);
    }
  }, 180);
});

/* レシピ画面から「献立に追加」 */
const slot = { recipeId: '', date: '', meal: 'dinner', servings: 2 };

function openSlotPicker(recipeId, origin) {
  const r = getRecipe(recipeId);
  if (!r) return;
  slot.recipeId = recipeId;
  slot.date = dayFromToday(0);
  slot.meal = prefs.get('lastMeal', 'dinner');
  slot.servings = state.servings || r.servings;
  $('#slotTitle').textContent = r.name;
  renderSlot();
  openOverlay($('#slotOv'), origin);
}

function renderSlot() {
  const days = $('#slotDays');
  days.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const date = dayFromToday(i);
    const b = el('button', 'slot-day' + (date === slot.date ? ' active' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(date === slot.date));
    const d = new Date(date + 'T12:00:00');
    b.append(el('span', 'sd-top', relDay(date) || WEEKDAYS[d.getDay()]), el('b', null, `${d.getMonth() + 1}/${d.getDate()}`));
    // その日にもう献立があれば小さな点で知らせる
    if (state.plan.some((e) => e.date === date)) b.append(el('span', 'sd-dot'));
    b.onclick = () => { slot.date = date; renderSlot(); };
    days.append(b);
  }
  document.querySelectorAll('#slotMeals button').forEach((b) => {
    const on = b.dataset.meal === slot.meal;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#slotServVal').textContent = `${slot.servings}人分`;
  $('#slotServ [data-d="-1"]').disabled = slot.servings <= 1;
  $('#slotServ [data-d="1"]').disabled = slot.servings >= 20;

  // 同じ枠にもう入っている料理を見せ、同じレシピの重複は防ぐ
  const inSlot = slotEntries(slot.date, slot.meal);
  const names = inSlot.map((e) => (getRecipe(e.recipeId) || {}).name).filter(Boolean);
  const dup = inSlot.some((e) => e.recipeId === slot.recipeId);
  $('#slotNote').textContent = dup
    ? 'この日のこの食事には、すでに入っています'
    : names.length ? `この枠の献立:${names.join('、')}` : '';
  $('#slotNote').classList.toggle('warn', dup);
  $('#slotAdd').disabled = dup;
}

$('#slotMeals').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  slot.meal = b.dataset.meal;
  prefs.set('lastMeal', slot.meal);
  renderSlot();
});
$('#slotServ').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  slot.servings = Math.max(1, Math.min(20, slot.servings + +b.dataset.d));
  renderSlot();
});
$('#slotAdd').addEventListener('click', async () => {
  const e = normalizeEntry({ id: uid(), date: slot.date, meal: slot.meal, recipeId: slot.recipeId, servings: slot.servings, createdAt: Date.now() });
  justAdded.add(e.id);
  await writeDocs('plan', [{ type: 'put', d: e }]);
  closeOverlay($('#slotOv'));
  toast(`${fmtDay(slot.date)} ${mealOf(slot.meal).long}に追加しました`);
  if (state.tab === 'plan') renderPlan();
});

/* ---------------- 献立 → 買い物リスト ---------------- */
// 家にあることが多いもの。「調味料・常備品」にまとめて、買う必要があるか確認しやすくする
const SEASONINGS = new Set([
  '塩', '砂糖', 'しょうゆ', '醤油', '酒', '料理酒', 'みりん', '酢', '味噌', 'みそ', 'こしょう', '胡椒', '塩こしょう', '塩胡椒',
  '油', 'サラダ油', 'ごま油', 'オリーブオイル', 'バター', '片栗粉', '小麦粉', '薄力粉', '強力粉', 'パン粉', '顆粒だし',
  '和風だし', 'だしの素', 'ほんだし', 'コンソメ', '鶏がらスープの素', 'ケチャップ', 'マヨネーズ', 'ソース', 'ウスターソース',
  '中濃ソース', 'オイスターソース', '豆板醤', '甜麺醤', 'コチュジャン', 'めんつゆ', '白だし', 'ポン酢', 'はちみつ', 'ナンプラー',
  'カレー粉', '一味', '七味', 'ラー油', 'チューブにんにく', 'チューブ生姜', 'にんにくチューブ', '生姜チューブ',
].map((x) => norm(x)));
const SKIP_ITEMS = new Set(['水', 'お湯', '湯', '熱湯', 'ぬるま湯', '氷'].map((x) => norm(x)));
const SEASON_HEADER = /調味料|タレ|たれ|ソース|合わせ|ドレッシング/;
const PREFIX_UNITS = ['大さじ', '小さじ', 'カップ'];
const UNIT_ALIAS = { グラム: 'g', cc: 'ml', mL: 'ml', ミリリットル: 'ml', こ: '個', コ: '個', ケ: '個', かけ: '片' };

// 「玉ねぎ(みじん切り)」「・玉ねぎ」なども同じ材料として扱う
const stripNote = (name) => name.replace(/[（(][^）)]*[）)]/g, '').replace(/^[・\-－●○◎※*＊]+/, '').trim();
// 漢字・ひらがなの書き分けが多い食材は、同じものとして扱う
const SYNONYMS = new Map(Object.entries({
  たまご: '卵', 玉子: '卵', 玉葱: '玉ねぎ', たまねぎ: '玉ねぎ', にんじん: '人参', 馬鈴薯: 'じゃがいも', 生姜: 'しょうが',
  挽肉: 'ひき肉', 挽き肉: 'ひき肉', 合挽き肉: '合いびき肉', 合い挽き肉: '合いびき肉', 葱: 'ねぎ', 長葱: '長ねぎ',
  胡瓜: 'きゅうり', 茄子: 'なす', 大蒜: 'にんにく', 椎茸: 'しいたけ', とり肉: '鶏肉', 鳥肉: '鶏肉', 南瓜: 'かぼちゃ',
  ぎゅうにゅう: '牛乳', ご飯: 'ごはん', 御飯: 'ごはん', はくさい: '白菜', だいこん: '大根', ほうれん草: 'ほうれんそう',
  しょう油: 'しょうゆ', 醤油: 'しょうゆ', 胡椒: 'こしょう', 味噌: 'みそ',
}).map(([k, v]) => [norm(k), norm(v)]));
const ingKey = (name) => {
  const k = norm(stripNote(name)).replace(/[\s・]/g, '');
  return SYNONYMS.get(k) || k;
};
const isSeasoning = (name, header) => {
  const k = ingKey(name);
  return SEASONINGS.has(k) || /(油|ソース|だし|の素|酢)$/.test(k) || SEASON_HEADER.test(header);
};

// 量を「数 + 単位」に分ける。「少々」などはそのまま文字で持つ
function parseAmount(amount, k) {
  const s = amount.normalize('NFKC').replace(/⁄/g, '/').replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/(\d+)と(\d+)\/(\d+)|(\d+(?:\.\d+)?)(?:\/(\d+))?/);
  if (!m) return { text: amount.trim() };
  let qty = m[1] ? +m[1] + m[2] / m[3] : +m[4] / (m[5] ? +m[5] : 1);
  const before = s.slice(0, m.index).replace(/約|およそ/g, '');
  let after = s.slice(m.index + m[0].length);
  // 「2〜3個」は多いほうで買う
  const range = after.match(/^[~〜～\-ー](\d+(?:\.\d+)?)/);
  if (range) { qty = +range[1]; after = after.slice(range[0].length); }
  after = after.replace(/[（(].*$/, '');
  if (PREFIX_UNITS.includes(before)) return { qty: qty * k, unit: before, prefix: true };
  let unit = (after || before).trim();
  unit = UNIT_ALIAS[unit] || unit;
  if (unit.length > 6) return { text: amount.trim() };
  return { qty: qty * k, unit, prefix: false };
}

function fmtAmount(units, texts) {
  const parts = [...units.values()].map((u) => (u.prefix ? `${u.unit}${fmtNum(u.qty)}` : `${fmtNum(u.qty)}${u.unit}`));
  if (!parts.length && texts.size) parts.push([...texts].join('・'));
  return parts.join(' + ');
}

// 献立の料理の材料を、人数分に換算して合算する
function buildShopping(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const r = getRecipe(e.recipeId);
    if (!r) return;
    const k = e.servings / r.servings;
    let header = '';
    lines(r.ingredients).forEach((line) => {
      const p = parseIngredient(line);
      if (p.header) { header = p.name; return; }
      const name = stripNote(p.name);
      const key = ingKey(p.name);
      if (!key || SKIP_ITEMS.has(key)) return;
      let it = map.get(key);
      if (!it) {
        it = { key, name, group: isSeasoning(p.name, header) ? 'season' : 'food', units: new Map(), texts: new Set(), recipes: new Set() };
        map.set(key, it);
      }
      it.recipes.add(r.name);
      const a = parseAmount(p.amount || '', k);
      if (!a) return;
      if (a.text) { it.texts.add(a.text); return; }
      const uk = (a.prefix ? 'p:' : '') + a.unit;
      const u = it.units.get(uk) || { unit: a.unit, prefix: a.prefix, qty: 0 };
      u.qty += a.qty;
      it.units.set(uk, u);
    });
  });
  return [...map.values()].map((it) => ({
    key: it.key, name: it.name, group: it.group, amount: fmtAmount(it.units, it.texts), recipes: [...it.recipes],
  }));
}

// 作り直すと、献立から作った未購入の項目を入れ替える。買ったもの・自分で追加したものはそのまま
$('#makeList').addEventListener('click', async () => {
  const items = buildShopping(planInRange());
  if (!items.length) return toast('献立のレシピに材料が登録されていません');
  const fromPlan = state.shop.filter((s) => s.source === 'plan');
  const bought = new Set(fromPlan.filter((s) => s.checked).map((s) => s.key));
  const manualKeys = new Set(state.shop.filter((s) => s.source === 'manual' && !s.checked).map((s) => s.key));
  const ops = fromPlan.filter((s) => !s.checked).map((s) => ({ type: 'del', id: s.id }));
  const now = Date.now();
  let added = 0;
  items.forEach((it, i) => {
    if (bought.has(it.key) || manualKeys.has(it.key)) return;
    ops.push({ type: 'put', d: normalizeShopItem({ ...it, id: uid(), source: 'plan', checked: false, createdAt: now + i }) });
    added++;
  });
  await writeDocs('shopping', ops);
  renderShopCount();
  goTab('shop');
  toast(`${added}点を買い物リストに入れました`);
});

/* ---------------- 買い物リスト ---------------- */
const SHOP_GROUPS = [
  { id: 'food', label: '食材', note: '' },
  { id: 'season', label: '調味料・常備品', note: '家にあれば買わなくてOK' },
  { id: 'manual', label: '自分で追加したもの', note: '' },
];
let doneOpen = false;

function renderShopCount() {
  const n = state.shop.filter((s) => !s.checked).length;
  const c = $('#shopCount');
  c.hidden = !n;
  c.textContent = n > 99 ? '99+' : String(n);
}

function renderShop(animate) {
  const todo = state.shop.filter((s) => !s.checked);
  const done = state.shop.filter((s) => s.checked);
  const byTime = (a, b) => a.createdAt - b.createdAt;
  $('#shopSub').textContent = state.shop.length
    ? (todo.length ? `残り ${todo.length}点${done.length ? ` · 買ったもの ${done.length}点` : ''}` : 'すべて買いました 🎉')
    : '';

  const box = $('#shopList');
  // 作り直す前の位置を覚えておき、並びが変わった行は今の位置から滑らかに移動させる
  const before = new Map();
  box.querySelectorAll('.shop-item').forEach((li) => before.set(li.dataset.id, li.getBoundingClientRect().top));
  box.innerHTML = '';
  box.classList.toggle('animate', !!animate);
  SHOP_GROUPS.forEach((g) => {
    const list = todo.filter((s) => s.group === g.id).sort(byTime);
    if (!list.length) return;
    const sec = el('section', 'shop-group');
    const h = el('h3', 'shop-h', g.label);
    if (g.note) h.append(el('span', null, g.note));
    const ul = el('ul', 'shop-ul');
    list.forEach((s, i) => ul.append(shopRow(s, i)));
    sec.append(h, ul);
    box.append(sec);
  });

  if (done.length) {
    const det = el('details', 'shop-done');
    det.open = doneOpen;
    det.addEventListener('toggle', () => { doneOpen = det.open; });
    const sum = el('summary', null, `買ったもの ${done.length}点`);
    const ul = el('ul', 'shop-ul');
    done.sort(byTime).forEach((s, i) => ul.append(shopRow(s, i)));
    const clear = el('button', 'btn small ghost', '買ったものを片づける');
    clear.type = 'button';
    clear.onclick = async () => {
      await writeDocs('shopping', done.map((s) => ({ type: 'del', id: s.id })));
      renderShop();
      renderShopCount();
      toast(`${done.length}点を片づけました`);
    };
    det.append(sum, ul, clear);
    box.append(det);
  }

  // リストをすべて削除(2段階。消したあとも少しの間は元に戻せる)
  if (state.shop.length) {
    const all = el('button', 'btn ghost danger wide shop-clear-all', 'リストをすべて削除');
    all.type = 'button';
    all.onclick = async () => {
      if (!all.classList.contains('confirm')) {
        all.classList.add('confirm');
        all.textContent = `${state.shop.length}点をすべて削除する`;
        setTimeout(() => { if (all.isConnected) { all.classList.remove('confirm'); all.textContent = 'リストをすべて削除'; } }, 3000);
        return;
      }
      const saved = state.shop.map((x) => ({ ...x }));
      await writeDocs('shopping', saved.map((x) => ({ type: 'del', id: x.id })));
      renderShop();
      toast('買い物リストを空にしました', {
        label: '元に戻す',
        run: async () => {
          await writeDocs('shopping', saved.map((d) => ({ type: 'put', d })));
          renderShop();
        },
      });
    };
    box.append(all);
  }

  $('#shopEmpty').hidden = state.shop.length > 0;
  $('#shopShare').disabled = !todo.length;
  renderShopCount();

  if (!animate && before.size) {
    box.querySelectorAll('.shop-item').forEach((li) => {
      const top = before.get(li.dataset.id);
      if (top == null) {
        li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
        return;
      }
      const dy = top - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    });
  }
}

const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 3.5h5M6 7l.9 12.6A1.5 1.5 0 0 0 8.4 21h7.2a1.5 1.5 0 0 0 1.5-1.4L18 7M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function shopRow(s, i) {
  const li = el('li', 'shop-item' + (s.checked ? ' done' : ''));
  li.style.setProperty('--i', Math.min(i, 12));
  li.dataset.id = s.id;

  // 左にスワイプすると出てくる削除ボタン(Apple のメールと同じ)
  const actions = el('div', 'si-actions');
  const trash = el('button', 'si-trash');
  trash.type = 'button';
  trash.innerHTML = TRASH;
  trash.append(el('span', null, '削除'));
  trash.setAttribute('aria-label', `「${s.name}」を削除`);
  trash.tabIndex = -1;
  trash.onclick = () => removeShopItem(s, li);
  actions.append(trash);

  const front = el('div', 'si-front');
  const btn = el('button', 'si-main');
  btn.type = 'button';
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', String(s.checked));
  const check = el('span', 'si-check');
  check.innerHTML = ICON.check;
  const text = el('span', 'si-text');
  text.append(el('span', 'si-name', s.name));
  if (s.recipes.length) text.append(el('span', 'si-sub', s.recipes.join('・')));
  btn.append(check, text);
  if (s.amount) btn.append(el('span', 'si-amt', s.amount));
  btn.onclick = () => {
    if (li._swiped) return; // スワイプした直後の指離れはチェックにしない
    if (li.classList.contains('open')) return closeSwipe(li);
    li.classList.add(s.checked ? 'unchecking' : 'checking');
    setTimeout(async () => {
      await writeDocs('shopping', [{ type: 'put', d: { ...s, checked: !s.checked } }]);
      renderShop();
    }, 320);
  };
  front.append(btn);

  // マウスのとき(Mac)は、行にカーソルを乗せるとゴミ箱が出る
  const del = el('button', 'si-del');
  del.type = 'button';
  del.innerHTML = TRASH;
  del.setAttribute('aria-label', `「${s.name}」を削除`);
  del.onclick = () => removeShopItem(s, li);
  front.append(del);

  li.append(actions, front);
  attachSwipe(li, front, s);
  return li;
}

/* スワイプで削除 */
const SWIPE_OPEN = 88;
let swipeOpen = null;

function setSwipeX(li, x, animate) {
  const front = li.querySelector('.si-front');
  front.style.transition = animate ? '' : 'none';
  front.style.transform = x ? `translateX(${x}px)` : '';
  li.style.setProperty('--reveal', String(Math.min(1, Math.max(0, -x / SWIPE_OPEN))));
}

function openSwipe(li) {
  if (swipeOpen && swipeOpen !== li) closeSwipe(swipeOpen);
  li.classList.add('open');
  li.querySelector('.si-trash').tabIndex = 0;
  setSwipeX(li, -SWIPE_OPEN, true);
  swipeOpen = li;
}

function closeSwipe(li) {
  if (!li) return;
  li.classList.remove('open', 'full');
  li.querySelector('.si-trash').tabIndex = -1;
  setSwipeX(li, 0, true);
  if (swipeOpen === li) swipeOpen = null;
}

function attachSwipe(li, front, s) {
  front.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('.si-del')) return;
    const sx = e.clientX, sy = e.clientY;
    const base = li.classList.contains('open') ? -SWIPE_OPEN : 0;
    const width = li.offsetWidth;
    let mode = null; // 'h' = 横スワイプ、'v' = 縦スクロール
    let x = base;

    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          mode = 'h';
          front.setPointerCapture(ev.pointerId);
          if (swipeOpen && swipeOpen !== li) closeSwipe(swipeOpen);
        } else if (Math.abs(dy) > 8) {
          mode = 'v';
          return stop();
        } else return;
      }
      x = base + dx;
      if (x > 0) x *= 0.2; // 右へはほとんど動かない
      setSwipeX(li, x, false);
      // 大きく引っぱったら「離すと削除」の見た目にする
      li.classList.toggle('full', x < -width * 0.55);
    };
    const up = () => {
      stop();
      if (mode !== 'h') return;
      li._swiped = true;
      setTimeout(() => { li._swiped = false; }, 0);
      if (x < -width * 0.55) removeShopItem(s, li);
      else if (x < -40) openSwipe(li);
      else closeSwipe(li);
    };
    const stop = () => {
      front.removeEventListener('pointermove', move);
      front.removeEventListener('pointerup', up);
      front.removeEventListener('pointercancel', up);
    };
    front.addEventListener('pointermove', move);
    front.addEventListener('pointerup', up);
    front.addEventListener('pointercancel', up);
  });
}

// ほかの場所を触ったら、開いているゴミ箱を閉じる
document.addEventListener('pointerdown', (e) => {
  if (swipeOpen && !swipeOpen.contains(e.target)) closeSwipe(swipeOpen);
});

// 行を左へ送り出してから消し、下の行は移動で詰める(高さのアニメーションは使わない)
function removeShopItem(s, li) {
  if (swipeOpen === li) swipeOpen = null;
  li.classList.add('removing');
  setSwipeX(li, -li.offsetWidth, true);
  setTimeout(async () => {
    await writeDocs('shopping', [{ type: 'del', id: s.id }]);
    renderShop();
    toast(`「${s.name}」を削除しました`);
  }, 260);
}

$('#shopAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#shopAdd input');
  const raw = input.value.trim();
  if (!raw) return input.focus();
  const p = parseIngredient(raw);
  const key = ingKey(p.name);
  // 同じものがまだ買っていない状態であれば、二重に追加しない
  const same = state.shop.find((s) => !s.checked && s.key === key);
  if (same) {
    toast(`「${same.name}」はすでにリストにあります`);
    return input.select();
  }
  const d = normalizeShopItem({ id: uid(), key, name: stripNote(p.name) || raw, amount: p.amount, group: 'manual', source: 'manual', createdAt: Date.now() });
  input.value = '';
  await writeDocs('shopping', [{ type: 'put', d }]);
  renderShop();
});

function shopText() {
  const todo = state.shop.filter((s) => !s.checked);
  const out = ['買い物リスト'];
  SHOP_GROUPS.forEach((g) => {
    const list = todo.filter((s) => s.group === g.id).sort((a, b) => a.createdAt - b.createdAt);
    if (!list.length) return;
    out.push('', `■ ${g.label}${g.note ? `(${g.note})` : ''}`);
    list.forEach((s) => out.push(`・${s.name}${s.amount ? ' ' + s.amount : ''}`));
  });
  return out.join('\n');
}

$('#shopShare').addEventListener('click', async () => {
  const text = shopText();
  if (navigator.share) {
    try {
      await navigator.share({ title: '買い物リスト', text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('買い物リストをコピーしました。Google Keep や LINE に貼り付けて送れます');
  } catch {
    toast('共有できませんでした');
  }
});

/* ---------------- はじめの表示 ---------------- */
// 履歴の土台はレシピ画面。前回ほかのタブで閉じていたら、その上に積んで開く
history.replaceState({ tab: 'recipes' }, '');
if (state.tab !== 'recipes') history.pushState({ tab: state.tab }, '');
switchTab(state.tab, true);
