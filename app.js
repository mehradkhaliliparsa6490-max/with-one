/* =========================================================
   app.js
   سیستم اصلی — منطق تطبیق هوشمند، پیشنهاد روز، جستجو
   ========================================================= */

/* ---------- ۱) ابزار ---------- */
function toPersian(n){
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function escapeHTML(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- ۲) نرمال‌سازی ---------- */
function normalize(str){
  return String(str)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(word){
  return word.replace(/هایی$/, '').replace(/های$/, '').replace(/ها$/, '');
}

function tokenize(str){
  return normalize(str)
    .split(' ')
    .filter(Boolean)
    .map(t => stem(TOKEN_SYNONYMS.get(t) || t))
    .filter(Boolean);
}

function containsPhrase(hay, needle){
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i++){
    let ok = true;
    for (let j = 0; j < needle.length; j++){
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/* ---------- ۳) تطبیق هوشمند (رفع باگ گوشت / گوشت چرخ کرده) ---------- */

/* واژه‌هایی که نشان می‌دهند ورودی کاربر یک «فرم فرآوری‌شده» است، نه خود مادهٔ اصلی.
   مثال: آرد برنج ≠ برنج، گوشت چرخ کرده ≠ گوشت، آب لیمو ≠ لیمو، لیمو عمانی ≠ لیمو */
const PREP_MODIFIERS = new Set([
  'چرخ', 'کرده',            // گوشت چرخ کرده
  'آرد',                     // آرد برنج
  'رب',                      // رب گوجه
  'آب',                      // آب لیمو
  'پودر',                    // پودر سوخاری
  'خمیر',                    // خمیر پیتزا
  'سس',                      // سس مایونز
  'عصاره',
  'کنسرو',
  'منجمد',
  'یخ',
  'خلال',                    // خلال بادام
  'عمانی'                    // لیمو عمانی
]);

/**
 * تطبیق بین «آنچه کاربر دارد» و «آنچه دستور نیاز دارد».
 * - تطبیق دقیق → true
 * - ورودی کاربر باید نیاز دستور را به‌صورت یک عبارت پیوسته در خود داشته باشد
 * - اگر کاربر کلمات اضافه دارد، دست‌کم یکی باید «نوع/گونه» باشد نه «فرآوری»
 *   ⇒ «گوشت گوساله» → «گوشت» ✓ / «آرد برنج» → «برنج» ✗ / «گوشت» → «گوشت چرخ کرده» ✗
 */
function ingredientMatches(userTokens, needTokens){
  /* تطبیق دقیق */
  if (userTokens.length === needTokens.length &&
      userTokens.every((t, i) => t === needTokens[i])){
    return true;
  }

  /* نیاز باید در ورودی کاربر به‌صورت عبارت پیوسته باشد */
  if (!containsPhrase(userTokens, needTokens)) return false;

  /* کلمات اضافه در ورودی کاربر */
  const needSet = new Set(needTokens);
  const extras = userTokens.filter(t => !needSet.has(t));
  if (extras.length === 0) return true;

  /* اگر تمام کلمات اضافه از جنس «فرآوری» باشند، تطبیق نمی‌کنیم */
  return extras.some(t => !PREP_MODIFIERS.has(t));
}

/* پیش‌محاسبه */
RECIPES.forEach(r => {
  r._tokens = r.main.map(ing => tokenize(ing));
  r._nameTokens = tokenize(r.name);
});

/* ---------- ۴) ذخیره‌سازی ---------- */
const STORAGE_KEY  = 'chi-bepazam-items-v1';
const DAILY_KEY    = 'chi-bepazam-daily-v1';
const EXCLUDED_KEY = 'chi-bepazam-excluded-v1';

const state = { items: [], minMatch: 40, cat: 'همه' };
let selectedDaily = [];

/* ---------- ۵) DOM ---------- */
const els = {
  input: document.getElementById('ingInput'),
  addBtn: document.getElementById('addBtn'),
  chips: document.getElementById('chips'),
  hint: document.getElementById('emptyHint'),
  quick: document.getElementById('quickAdd'),
  minMatch: document.getElementById('minMatch'),
  minMatchLbl: document.getElementById('minMatchLabel'),
  findBtn: document.getElementById('findBtn'),
  clearBtn: document.getElementById('clearBtn'),
  results: document.getElementById('results'),
  cats: document.getElementById('catFilters'),

  recipeSearch: document.getElementById('recipeSearch'),
  recipeSearchBtn: document.getElementById('recipeSearchBtn'),
  recipeSearchRes: document.getElementById('recipeSearchResult'),

  dailyCards: document.getElementById('dailyCards'),
  dailyActions: document.getElementById('dailyActions'),
  dailyHint: document.getElementById('dailyHint'),
  confirmDaily: document.getElementById('confirmDaily'),
  selectedCount: document.getElementById('selectedCount'),
  selectedIngredients: document.getElementById('selectedIngredients')
};

/* ---------- ۶) تاریخ ---------- */
function getTodayKey(){
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function getLastSaturdayKey(){
  const now = new Date();
  const day = now.getDay();               // 6 = شنبه
  const diff = (day + 1) % 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() - diff);
  sat.setHours(0, 0, 0, 0);
  return sat.getFullYear() + '-' +
    String(sat.getMonth() + 1).padStart(2, '0') + '-' +
    String(sat.getDate()).padStart(2, '0');
}

/* ---------- ۷) ذخیره / بازیابی ---------- */
function save(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items)); } catch(e){}
}
function load(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) state.items = arr.filter(x => typeof x === 'string');
  } catch(e){}
}

/* ---------- ۸) پنهان‌سازی هفتگی ---------- */
function getExcludedFoods(){
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.weekStart !== getLastSaturdayKey()){
      localStorage.removeItem(EXCLUDED_KEY);
      return [];
    }
    return Array.isArray(data.foods) ? data.foods : [];
  } catch(e){ return []; }
}

function setExcludedFoods(foods){
  try {
    if (foods.length === 0){
      localStorage.removeItem(EXCLUDED_KEY);
    } else {
      localStorage.setItem(EXCLUDED_KEY, JSON.stringify({
        weekStart: getLastSaturdayKey(), foods
      }));
    }
  } catch(e){}
}

function addExcludedFood(name){
  const foods = getExcludedFoods();
  if (!foods.includes(name)) foods.push(name);
  setExcludedFoods(foods);
}

/* ---------- ۹) انتخاب امروز ---------- */
function getTodaySelection(){
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.date !== getTodayKey()) return null;
    return data;
  } catch(e){ return null; }
}

function saveTodaySelection(names){
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({
      date: getTodayKey(), selected: names
    }));
  } catch(e){}
}

function clearTodaySelection(){
  try { localStorage.removeItem(DAILY_KEY); } catch(e){}
}

/* ---------- ۱۰) تولید ۶ پیشنهاد روزانه ---------- */
const DAILY_COUNT = 6;   // ← تعداد پیشنهاد روزانه

function getDailySuggestions(){
  const excluded = getExcludedFoods();
  const available = RECIPES.filter(r => !excluded.includes(r.name));

  /* seed پایدار بر اساس تاریخ امروز */
  const dateKey = getTodayKey();
  let seed = 0;
  for (let i = 0; i < dateKey.length; i++){
    seed = (seed * 31 + dateKey.charCodeAt(i)) % 2147483647;
  }
  if (seed <= 0) seed += 2147483646;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(DAILY_COUNT, shuffled.length));
}

/* ---------- ۱۱) رندر روزانه ---------- */
function suggestCardHTML(r, selected){
  return `
    <button type="button" class="daily-card ${selected ? 'selected' : ''}" data-food="${escapeHTML(r.name)}">
      ${selected ? '<span class="check-mark">✓</span>' : ''}
      <span class="daily-emoji">${r.emoji}</span>
      <span class="daily-name">${escapeHTML(r.name)}</span>
      <span class="daily-cat">${escapeHTML(r.cat)}</span>
    </button>`;
}

function confirmedCardHTML(r){
  return `
    <div class="daily-card confirmed">
      <span class="check-mark">✓</span>
      <span class="daily-emoji">${r.emoji}</span>
      <span class="daily-name">${escapeHTML(r.name)}</span>
      <span class="daily-cat">${escapeHTML(r.cat)}</span>
    </div>`;
}

function ingredientsBlockHTML(r){
  const optionalHTML = r.pantry.length
    ? `<p class="pantry">مواد اختیاری: ${r.pantry.map(escapeHTML).join('، ')}</p>`
    : '';
  return `
    <div class="ingredients-block">
      <h3>${r.emoji} ${escapeHTML(r.name)}</h3>
      <p class="label">مواد اولیهٔ اصلی:</p>
      <div class="pills">
        ${r.main.map(ing => `<span class="pill need">• ${escapeHTML(ing)}</span>`).join('')}
      </div>
      ${optionalHTML}
    </div>`;
}

function updateSelectedCount(){
  const n = selectedDaily.length;
  els.selectedCount.textContent = n === 0
    ? 'هنوز چیزی انتخاب نکردی'
    : `${toPersian(n)} از ۲ انتخاب شده`;
  els.confirmDaily.disabled = n === 0;
}

function renderDaily(){
  const todaySel = getTodaySelection();

  /* حالت تأییدشده */
  if (todaySel){
    const selected = todaySel.selected
      .map(name => RECIPES.find(r => r.name === name))
      .filter(Boolean);
    if (selected.length === 0){
      clearTodaySelection();
      renderDaily();
      return;
    }
    els.dailyHint.textContent = 'انتخاب امروز ثبت شده — می‌تونی همین الان بپزی!';
    els.dailyCards.classList.add('confirmed');
    els.dailyCards.innerHTML = selected.map(confirmedCardHTML).join('');
    els.dailyActions.classList.add('is-hidden');
    els.selectedIngredients.innerHTML = selected.map(ingredientsBlockHTML).join('');
    return;
  }

  /* حالت انتخاب */
  const suggestions = getDailySuggestions();
  if (suggestions.length === 0){
    els.dailyHint.textContent = 'همهٔ غذاها این هفته پیشنهاد داده شده‌اند 🌱';
    els.dailyCards.classList.remove('confirmed');
    els.dailyCards.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <span class="big">🌱</span>
        همهٔ غذاهای این هفته پیشنهاد داده شده‌اند.<br>
        شنبهٔ آینده دوباره سر بزن.
      </div>`;
    els.dailyActions.classList.add('is-hidden');
    els.selectedIngredients.innerHTML = '';
    return;
  }

  els.dailyHint.textContent = `هر روز ${toPersian(DAILY_COUNT)} پیشنهاد تازه — حداکثر ۲ تا انتخاب کن و تأیید بزن`;
  selectedDaily = [];
  els.dailyCards.classList.remove('confirmed');
  els.dailyCards.innerHTML = suggestions.map(r => suggestCardHTML(r, false)).join('');
  els.dailyActions.classList.remove('is-hidden');
  els.selectedIngredients.innerHTML = '';
  updateSelectedCount();
}

/* ---------- ۱۲) رندر چیپ/فیلتر ---------- */
function renderChips(){
  els.chips.innerHTML = state.items.map((item, i) => `
    <span class="chip">
      ${escapeHTML(item)}
      <button type="button" data-index="${i}" title="حذف" aria-label="حذف">✕</button>
    </span>`).join('');
  els.hint.style.display = state.items.length ? 'none' : 'block';
}

function renderQuickAdd(){
  els.quick.innerHTML = QUICK_ADD
    .map(name => `<button type="button" class="quick-btn" data-quick="${escapeHTML(name)}">${escapeHTML(name)}</button>`)
    .join('');
}

function renderCategories(){
  els.cats.innerHTML = CATEGORIES
    .map(c => `<button type="button" class="cat-btn${c === state.cat ? ' active' : ''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`)
    .join('');
}

/* ---------- ۱۳) نتایج بر اساس مواد ---------- */
function computeResults(){
  const userTokens = state.items.map(tokenize).filter(t => t.length);
  const out = [];

  for (const recipe of RECIPES){
    if (state.cat !== 'همه' && recipe.cat !== state.cat) continue;

    const matched = [], missing = [];
    recipe.main.forEach((ing, i) => {
      const need = recipe._tokens[i];
      const has = userTokens.some(u => ingredientMatches(u, need));
      has ? matched.push(ing) : missing.push(ing);
    });

    const percent = Math.round((matched.length / recipe.main.length) * 100);
    if (percent < state.minMatch) continue;

    out.push({ ...recipe, matched, missing, percent });
  }

  out.sort((a, b) =>
    b.percent - a.percent ||
    a.missing.length - b.missing.length ||
    b.matched.length - a.matched.length ||
    a.name.localeCompare(b.name, 'fa')
  );
  return out;
}

function cardHTML(r){
  const cls = r.percent === 100 ? 'full'
            : r.percent >= 70   ? 'high'
            : r.percent >= 40   ? 'mid'
            : 'low';

  const pills = r.main.map(ing => {
    const has = r.matched.includes(ing);
    return `<span class="pill ${has ? 'have' : 'need'}">${has ? '✓' : '+'} ${escapeHTML(ing)}</span>`;
  }).join('');

  const footer = r.missing.length
    ? `<p class="missing">کم داری: ${r.missing.map(escapeHTML).join('، ')}</p>`
    : `<p class="ready">🎉 همهٔ مواد اصلی رو داری، دست به کار شو!</p>`;

  const optional = r.pantry.length
    ? `<p class="pantry">مواد اختیاری: ${r.pantry.map(escapeHTML).join('، ')}</p>`
    : '';

  return `
    <article class="card ${cls}">
      <div class="card-head">
        <span class="card-emoji">${r.emoji}</span>
        <div style="flex:1">
          <h3>${escapeHTML(r.name)}</h3>
          <span class="card-cat">${escapeHTML(r.cat)}</span>
        </div>
        <span class="badge">${r.percent}%</span>
      </div>
      <div class="bar"><span style="width:${r.percent}%"></span></div>
      <p class="label">مواد اصلی (${r.matched.length} از ${r.main.length})</p>
      <div class="pills">${pills}</div>
      ${footer}
      ${optional}
    </article>`;
}

function renderResults(){
  if (state.items.length === 0){
    els.results.innerHTML = `
      <div class="empty">
        <span class="big">🥕</span>
        اول مواد اولیه‌ای که داری رو اضافه کن، بعد نتیجه‌ها همین‌جا ظاهر می‌شن.
      </div>`;
    return;
  }

  const list = computeResults();
  if (list.length === 0){
    els.results.innerHTML = `
      <div class="empty">
        <span class="big">😕</span>
        با این مواد و این حداقل تطابق، غذایی پیدا نشد.<br>
        یا مواد بیشتری اضافه کن، یا اسلایدر «حداقل تطابق» رو کم کن.
      </div>`;
    return;
  }
  els.results.innerHTML = list.map(cardHTML).join('');
}

/* ---------- ۱۴) جستجو ---------- */
function searchRecipes(query){
  const q = tokenize(query);
  if (q.length === 0) return [];

  const results = RECIPES.filter(r =>
    q.every(qt => r._nameTokens.some(nt => ingredientMatches([nt], [qt])))
  );

  results.sort((a, b) => {
    const aE = normalize(a.name) === normalize(query) ? 1 : 0;
    const bE = normalize(b.name) === normalize(query) ? 1 : 0;
    if (aE !== bE) return bE - aE;
    return a.name.localeCompare(b.name, 'fa');
  });
  return results;
}

function renderRecipeSearch(){
  const query = els.recipeSearch.value.trim();
  if (!query){
    els.recipeSearchRes.innerHTML = '';
    return;
  }

  const results = searchRecipes(query);
  if (results.length === 0){
    els.recipeSearchRes.innerHTML = `
      <div class="search-empty">
        ❌ غذایی با نام «${escapeHTML(query)}» پیدا نشد.
      </div>`;
    return;
  }

  els.recipeSearchRes.innerHTML = results.map(r => {
    const userTokens = state.items.map(tokenize).filter(t => t.length);
    const mainHTML = r.main.map((ing, i) => {
      const need = r._tokens[i];
      const has = userTokens.some(u => ingredientMatches(u, need));
      return `<span class="pill ${has ? 'have' : 'need'}">${has ? '✓' : '•'} ${escapeHTML(ing)}</span>`;
    }).join('');

    const optionalHTML = r.pantry.length
      ? `<p class="pantry">مواد اختیاری: ${r.pantry.map(escapeHTML).join('، ')}</p>`
      : '';

    return `
      <div class="search-card">
        <div class="search-card-head">
          <span class="card-emoji">${r.emoji}</span>
          <div style="flex:1">
            <h3>${escapeHTML(r.name)}</h3>
            <span class="card-cat">${escapeHTML(r.cat)}</span>
          </div>
        </div>
        <p class="label">مواد اولیهٔ اصلی (${r.main.length} مورد):</p>
        <div class="pills">${mainHTML}</div>
        ${optionalHTML}
      </div>`;
  }).join('');
}

/* ---------- ۱۵) عملیات مواد اولیه ---------- */
function addIngredient(raw){
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return;
  const key = normalize(text);
  if (!key) return;
  if (state.items.some(i => normalize(i) === key)){
    els.input.classList.remove('shake');
    void els.input.offsetWidth;
    els.input.classList.add('shake');
    return;
  }
  state.items.push(text);
  save(); renderChips(); renderResults();
  if (els.recipeSearch.value.trim()) renderRecipeSearch();
}

function removeIngredient(index){
  if (index < 0 || index >= state.items.length) return;
  state.items.splice(index, 1);
  save(); renderChips(); renderResults();
  if (els.recipeSearch.value.trim()) renderRecipeSearch();
}

function clearAll(){
  state.items = [];
  save(); renderChips(); renderResults();
  if (els.recipeSearch.value.trim()) renderRecipeSearch();
  els.input.focus();
}

/* ---------- ۱۶) تب‌ها ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.dataset.panel === tab));
  });
});

/* ---------- ۱۷) رویدادهای روزانه ---------- */
els.dailyCards.addEventListener('click', e => {
  if (getTodaySelection()) return;
  const card = e.target.closest('button[data-food]');
  if (!card) return;

  const name = card.dataset.food;
  const idx = selectedDaily.indexOf(name);
  if (idx >= 0) selectedDaily.splice(idx, 1);
  else {
    if (selectedDaily.length >= 2) selectedDaily.shift();
    selectedDaily.push(name);
  }

  els.dailyCards.querySelectorAll('button[data-food]').forEach(c => {
    const isSel = selectedDaily.includes(c.dataset.food);
    c.classList.toggle('selected', isSel);
    const mark = c.querySelector('.check-mark');
    if (isSel && !mark){
      const m = document.createElement('span');
      m.className = 'check-mark'; m.textContent = '✓';
      c.insertBefore(m, c.firstChild);
    } else if (!isSel && mark) mark.remove();
  });

  updateSelectedCount();
});

els.confirmDaily.addEventListener('click', () => {
  if (selectedDaily.length === 0) return;
  saveTodaySelection(selectedDaily);
  selectedDaily.forEach(addExcludedFood);
  renderDaily();
});

/* ---------- ۱۸) رویدادهای مواد اولیه ---------- */
els.addBtn.addEventListener('click', () => {
  addIngredient(els.input.value);
  els.input.value = '';
  els.input.focus();
});

els.input.addEventListener('keydown', e => {
  if (e.key === 'Enter'){
    e.preventDefault();
    addIngredient(els.input.value);
    els.input.value = '';
  }
});

els.chips.addEventListener('click', e => {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;
  removeIngredient(Number(btn.dataset.index));
});

els.quick.addEventListener('click', e => {
  const btn = e.target.closest('button[data-quick]');
  if (!btn) return;
  addIngredient(btn.dataset.quick);
});

els.minMatch.addEventListener('input', () => {
  state.minMatch = Number(els.minMatch.value);
  els.minMatchLbl.textContent = state.minMatch + '%';
  renderResults();
});

els.findBtn.addEventListener('click', () => {
  renderResults();
  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

els.clearBtn.addEventListener('click', clearAll);

els.cats.addEventListener('click', e => {
  const btn = e.target.closest('button[data-cat]');
  if (!btn) return;
  state.cat = btn.dataset.cat;
  renderCategories(); renderResults();
});

/* ---------- ۱۹) رویدادهای جستجو ---------- */
els.recipeSearchBtn.addEventListener('click', renderRecipeSearch);
els.recipeSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); renderRecipeSearch(); }
});
let searchTimer = null;
els.recipeSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderRecipeSearch, 200);
});

/* ---------- ۲۰) شروع ---------- */
(function init(){
  load();
  state.minMatch = Number(els.minMatch.value);
  els.minMatchLbl.textContent = state.minMatch + '%';

  renderQuickAdd();
  renderCategories();
  renderChips();
  renderResults();
  renderDaily();
  els.input.focus();
})();