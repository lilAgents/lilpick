// lilPick: extract entrants from a blob of comments and draw a fair random
// winner using the browser's cryptographic RNG. Fully client-side.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- theme (OS-aware, matches the family) ---------- */
const MOON_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/></g></svg>';

function setThemeIcon(btn, theme) {
  if (theme === 'dark') { btn.innerHTML = SUN_SVG; btn.setAttribute('aria-label', 'Switch to light mode'); }
  else { btn.innerHTML = MOON_SVG; btn.setAttribute('aria-label', 'Switch to dark mode'); }
}
function initTheme() {
  const btn = $('#ui-theme-btn');
  const current = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setThemeIcon(btn, current());
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lilpick-theme', next); } catch (e) {}
    setThemeIcon(btn, next);
  });
}

/* ---------- state ---------- */
const state = { mode: 'handle' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const AI_PROMPT = `I'm running a giveaway and need a clean list of everyone who entered.

Below (or in the attached screenshot) are the comments from my post. List every unique commenter's @handle, one per line, with nothing else: no numbers, no comment text, no duplicates. If a handle appears more than once, include it only once.

Comments:
<paste the comments or attach the screenshot here>`;

// Console / automation snippet: scrapes @handles from the rendered page,
// dedupes, sorts, and copies them to the clipboard. Skips common nav links.
const PAGE_SNIPPET = `(() => {
  const skip = new Set(['home','explore','search','notifications','messages','settings','reels','reel','stories','about','privacy','terms','help','p','i','tv','login','signup']);
  const handles = new Set();
  (document.body.innerText.match(/@[A-Za-z0-9_.]{2,30}/g) || [])
    .forEach(h => handles.add(h.replace(/\\.+$/, '')));
  document.querySelectorAll('a[href]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(/^\\/@?([A-Za-z0-9_.]{2,30})\\/?$/);
    if (m && !skip.has(m[1].toLowerCase())) handles.add('@' + m[1]);
  });
  const list = [...handles].sort().join('\\n');
  console.log(list);
  try { copy(list); console.log('lilPick: ' + handles.size + ' handles copied to your clipboard'); }
  catch (e) { console.log('lilPick: copy the ' + handles.size + ' handles printed above'); }
})();`;

/* ---------- crypto-fair randomness ---------- */
// uniform integer in [0, max) without modulo bias
function randInt(max) {
  if (max <= 1) return 0;
  const u = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do { crypto.getRandomValues(u); x = u[0]; } while (x >= limit);
  return x % max;
}
// Fisher-Yates using the unbiased RNG above
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- entrant extraction ---------- */
const HANDLE_RE = /@[A-Za-z0-9_.]+/g;

function normHandle(h) {
  return h.replace(/[.]+$/, ''); // trailing dots are usually punctuation
}

function parseExcludes() {
  const raw = $('#f-exclude').value;
  const set = new Set();
  for (const m of raw.match(/@?[A-Za-z0-9_.]+/g) || []) {
    set.add(normHandle(m.startsWith('@') ? m : '@' + m).toLowerCase());
  }
  return set;
}

// returns { entries: [...], rawCount, excludedCount, dupesRemoved }
function buildPool() {
  const text = $('#f-entries').value;
  const keyword = $('#f-keyword').value.trim().toLowerCase();
  const dedupe = $('#opt-dedupe').checked;
  const excludes = parseExcludes();

  const collected = [];
  for (const line of text.split('\n')) {
    if (keyword && !line.toLowerCase().includes(keyword)) continue;
    if (state.mode === 'handle') {
      for (const m of line.match(HANDLE_RE) || []) {
        const h = normHandle(m);
        if (h.length > 1) collected.push(h);
      }
    } else {
      const t = line.trim();
      if (t) collected.push(t);
    }
  }

  const rawCount = collected.length;
  let excludedCount = 0;
  const kept = collected.filter((e) => {
    const key = (state.mode === 'handle' ? e : '@' + e).toLowerCase();
    if (excludes.has(key) || excludes.has(e.toLowerCase())) { excludedCount++; return false; }
    return true;
  });

  let entries = kept;
  let dupesRemoved = 0;
  if (dedupe) {
    const seen = new Set();
    entries = [];
    for (const e of kept) {
      const key = e.toLowerCase();
      if (seen.has(key)) { dupesRemoved++; continue; }
      seen.add(key);
      entries.push(e);
    }
  }
  return { entries, rawCount, excludedCount, dupesRemoved };
}

/* ---------- render ---------- */
function refreshPool() {
  $('#c-entries').textContent = $('#f-entries').value.length;
  const { entries, excludedCount, dupesRemoved } = buildPool();
  const bits = [`${entries.length} eligible ${entries.length === 1 ? 'entry' : 'entries'}`];
  if (dupesRemoved) bits.push(`${dupesRemoved} duplicate${dupesRemoved === 1 ? '' : 's'} removed`);
  if (excludedCount) bits.push(`${excludedCount} excluded`);
  $('#stat-msg').textContent = entries.length ? bits.join(' · ') : 'No eligible entries yet.';
  $('#pick-btn').disabled = entries.length === 0;
  return entries;
}

function poolListHtml(entries, winners) {
  const winSet = new Set(winners.map((w) => w.toLowerCase()));
  const shown = entries.slice(0, 200);
  const chips = shown.map((e) => {
    const won = winSet.has(e.toLowerCase());
    return `<span class="pick-chip${won ? ' pick-chip--won' : ''}">${esc(e)}</span>`;
  }).join('');
  const more = entries.length > shown.length ? `<span class="pick-more">+${entries.length - shown.length} more</span>` : '';
  return `<div class="pick-pool"><div class="pick-pool-h">The entry pool (${entries.length})</div><div class="pick-chips">${chips}${more}</div></div>`;
}

function draw() {
  const entries = refreshPool();
  if (!entries.length) return;
  let count = parseInt($('#f-count').value, 10);
  if (isNaN(count) || count < 1) count = 1;
  count = Math.min(count, entries.length);

  const winners = shuffle(entries).slice(0, count);

  const winnerHtml = winners.map((w, i) => `
    <div class="pick-winner" style="animation-delay:${i * 90}ms">
      <span class="pick-winner-rank">${winners.length > 1 ? '#' + (i + 1) : 'Winner'}</span>
      <span class="pick-winner-name">${esc(w)}</span>
    </div>`).join('');

  $('#pick-out').innerHTML = `
    <div class="pick-result">
      <div class="pick-trophy" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>
      </div>
      <div class="pick-winners">${winnerHtml}</div>
      <div class="pick-from">drawn fairly from ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</div>
      <button class="btn btn--sm" id="redraw-btn" type="button">Draw again</button>
    </div>
    ${poolListHtml(entries, winners)}`;
  $('#redraw-btn').addEventListener('click', draw);
}

/* ---------- example ---------- */
const EXAMPLE = `@maya.codes done! would love this 🎉
@jonas_b done
Nice giveaway!
@sarah.draws done done
@maya.codes done (commented twice oops)
@thedevkid entered, fingers crossed
@brand_official good luck everyone
@lena.makes done ✅
just here to look around
@pixel_pete done!`;

/* ---------- wire-up ---------- */
function initPick() {
  initTheme();
  $('#ai-prompt').querySelector('code').textContent = AI_PROMPT;
  $('#page-snippet').querySelector('code').textContent = PAGE_SNIPPET;

  // toggle between the page-scrape snippet and the AI prompt
  $$('[data-helper]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-helper]').forEach((x) => x.classList.toggle('is-active', x === b));
    $('#helper-page').classList.toggle('is-hidden', b.dataset.helper !== 'page');
    $('#helper-ai').classList.toggle('is-hidden', b.dataset.helper !== 'ai');
  }));
  $('#copy-snippet').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(PAGE_SNIPPET);
      const btn = e.currentTarget;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy snippet'; }, 1100);
    } catch (err) {}
  });

  $('#f-entries').addEventListener('input', refreshPool);
  $('#f-keyword').addEventListener('input', refreshPool);
  $('#f-exclude').addEventListener('input', refreshPool);
  $('#opt-dedupe').addEventListener('change', refreshPool);
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    $$('[data-mode]').forEach((x) => x.classList.toggle('is-active', x === b));
    refreshPool();
  }));

  $('#pick-btn').addEventListener('click', draw);
  $('#example-btn').addEventListener('click', () => {
    $('#f-entries').value = EXAMPLE;
    $('#f-keyword').value = 'done';
    $('#f-exclude').value = '@brand_official';
    refreshPool();
  });
  $('#clear-btn').addEventListener('click', () => {
    $('#f-entries').value = '';
    $('#f-keyword').value = '';
    $('#f-exclude').value = '';
    $('#pick-out').innerHTML = '<div class="insp-empty" id="empty"><p class="insp-empty__big">No winner yet</p><p class="insp-empty__sub">Paste your comments on the left, choose how many winners, and draw. The lucky handle shows up here.</p></div>';
    refreshPool();
  });

  $('#copy-prompt').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      const btn = e.currentTarget;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy prompt'; }, 1100);
    } catch (err) {}
  });

  refreshPool();
}

export { initPick };
