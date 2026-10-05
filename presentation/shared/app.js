/* Deck core: stage scaling, slide and step navigation, saved position, timer, notes.
   Every variant loads this file. Look and motion come from the variant: styles.css, motion.css
   and motion.js (window.DeckMotion). Keys: ← → Space, Home/End, ↓ or Q (questions), Esc (back),
   F fullscreen, N notes, T timer, R reset timer. `?static` shows every step and stops motion. */
(() => {
  const stage = document.getElementById('stage');
  const slides = [...stage.querySelectorAll('.slide')];
  const main = slides.filter((s) => s.dataset.kind === 'main');
  const backup = slides.filter((s) => s.dataset.kind === 'backup');
  const storeKey = `deck-${document.body.dataset.variant ?? 'x'}`;
  const staticMode = new URLSearchParams(location.search).has('static');
  const motion = window.DeckMotion;
  const budget = Number(stage.dataset.seconds ?? 420);
  const rail = document.getElementById('rail');
  const counter = document.getElementById('counter');
  const timer = document.getElementById('timer');
  const notes = document.getElementById('notes');
  const announce = document.getElementById('announce');

  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch { /* storage can be blocked: the hash still works */ }
    },
  };

  let current = main[0];
  let step = 0;
  let back = { id: main[0].id, step: 0 };
  let startedAt = 0;
  let entered = false;

  const maxStep = (slide) => Math.max(0, ...[...slide.querySelectorAll('[data-step]')].map((el) => Number(el.dataset.step)));

  function fit() {
    const f = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * f) / 2}px, ${(innerHeight - 1080 * f) / 2}px) scale(${f})`;
  }

  function formatTime(sec) {
    const s = Math.abs(sec);
    return `${sec < 0 ? '−' : ''}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function tick() {
    if (!startedAt) return;
    const left = budget - Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = formatTime(left);
    timer.classList.toggle('low', left <= 60);
  }

  function render() {
    const isMain = current.dataset.kind === 'main';
    const group = isMain ? main : backup;
    slides.forEach((s) => s.classList.toggle('active', s === current));
    current.querySelectorAll('[data-step]').forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle('on', staticMode || n <= step);
      el.classList.toggle('cur', n === step);
      el.classList.toggle('done', n < step);
    });
    stage.dataset.scene = current.id;
    stage.dataset.kind = current.dataset.kind;
    stage.style.setProperty('--seam', `${current.dataset.seam ?? 960}px`);
    const mainIndex = isMain ? main.indexOf(current) : main.findIndex((s) => s.id === back.id);
    stage.style.setProperty('--progress', String((mainIndex + 1) / main.length));
    rail.querySelectorAll('i').forEach((tickEl, i) => tickEl.classList.toggle('on', i <= mainIndex));
    counter.textContent = `${isMain ? '' : 'Q '}${String(group.indexOf(current) + 1).padStart(2, '0')} / ${String(group.length).padStart(2, '0')}`;
    notes.textContent = current.querySelector('.speaker-note')?.textContent.trim() ?? '';
    document.title = `${current.dataset.title} — Цифровой двойник ОПС`;
    announce.textContent = current.dataset.title;
    const hash = `#${current.id}${step ? `.${step}` : ''}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    store.set(storeKey, hash.slice(1));
  }

  function show(target, wantedStep = 0, remember = true) {
    if (!target) return;
    const previous = current;
    const dir = slides.indexOf(target) < slides.indexOf(previous) ? -1 : 1;
    if (remember && previous.dataset.kind === 'main' && target.dataset.kind === 'backup') back = { id: previous.id, step };
    current = target;
    step = Math.max(0, Math.min(wantedStep, maxStep(target)));
    if (!startedAt && target !== main[0]) startedAt = Date.now();
    render();
    if (target !== previous || !entered) motion?.enter(target, target === previous ? null : previous, dir);
    entered = true;
    if (step) motion?.step(target, step, 0);
  }

  function advance(dir) {
    const max = maxStep(current);
    if ((dir > 0 && step < max) || (dir < 0 && step > 0)) {
      const before = step;
      step += dir;
      render();
      motion?.step(current, step, before);
      return;
    }
    const group = current.dataset.kind === 'main' ? main : backup;
    const target = group[group.indexOf(current) + dir];
    if (target) show(target, dir < 0 ? maxStep(target) : 0);
  }

  const toQuestions = () => show(backup[0]);
  const fromQuestions = () => show(slides.find((s) => s.id === back.id) ?? main.at(-1), back.step, false);
  const isBackup = () => current.dataset.kind === 'backup';

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      announce.textContent = 'Полный экран — клавиша F11.';
    }
  }

  const keys = {
    ArrowRight: () => advance(1),
    Space: () => advance(1),
    PageDown: () => advance(1),
    ArrowLeft: () => advance(-1),
    PageUp: () => advance(-1),
    Home: () => show(main[0]),
    End: () => show(main.at(-1)),
    ArrowDown: () => (current === main.at(-1) ? toQuestions() : advance(1)),
    ArrowUp: () => (isBackup() ? fromQuestions() : advance(-1)),
    Escape: () => { if (isBackup()) fromQuestions(); },
    KeyQ: () => (isBackup() ? fromQuestions() : toQuestions()),
    KeyF: toggleFullscreen,
    KeyN: () => notes.classList.toggle('show'),
    KeyT: () => { timer.classList.toggle('show'); tick(); },
    KeyR: () => { startedAt = Date.now(); tick(); },
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = keys[e.code];
    if (!action) return;
    e.preventDefault();
    action();
  });

  function restore() {
    const m = (location.hash.slice(1) || store.get(storeKey) || '').match(/^([sb]\d+)(?:\.(\d+))?$/);
    const target = m && slides.find((s) => s.id === m[1]);
    show(target ?? main[0], m ? Number(m[2] ?? 0) : 0, false);
  }

  main.forEach(() => rail.append(document.createElement('i')));
  if (staticMode) document.documentElement.classList.add('static');
  addEventListener('resize', fit);
  addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== `${current.id}${step ? `.${step}` : ''}`) restore();
  });
  setInterval(tick, 1000);
  fit();
  document.fonts.ready.then(() => {
    motion?.prepare?.(slides);
    restore();
    document.documentElement.classList.add('ready');
  });
})();
