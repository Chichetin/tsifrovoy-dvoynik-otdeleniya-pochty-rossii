/* Shared motion toolkit. A variant's motion.js calls DeckCore.create({...}) and gets window.DeckMotion.
   Only transform, opacity, clip-path and stroke-dashoffset move. Everything is finite: no endless loops.
   Markup hooks (written in slides.js):
     [data-step=n]  shown by app.js (class .on), CSS transitions do the fade
     [data-draw]    SVG stroke drawn when its slide or step shows (class .drawn), data-delay in ms
     [data-count]   number counts up (data-from, data-dec, data-dur)
     [data-packet]  SVG circle runs along the path with the id given (data-dur, data-delay)
     [data-ping]    one expanding ring (data-delay)
     [data-links]   box that gets connector paths between its [data-node] elements: "a>b c;d>e"
     [data-twin]    plan art: 2D and 3D drawn from one list of rectangles */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const staticMode = new URLSearchParams(location.search).has('static');
  const canMove = () => !staticMode && !reduce.matches && !document.hidden && typeof Element.prototype.animate === 'function';
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  };
  const inStepOnly = (el) => !el.closest('[data-step]');

  /* ---------- plan art: one rectangle list, two views ---------- */
  const PLAN = {
    w: 15, d: 10, partX: 7.5, door: [4, 5.4], wallH: 2.4,
    zones: [[0.4, 5.6, 6.4, 4], [8.2, 0.8, 6.4, 3.6]],
    // x, y, width, depth, height, flagged (finding of the check)
    boxes: [
      [1, 0.8, 1.6, 0.9, 1.1], [3.2, 0.8, 1.6, 0.9, 1.1], [5.4, 0.8, 1.6, 0.9, 1.1],
      [1.2, 7.6, 1.6, 0.5, 0.5], [8.6, 1.4, 1.2, 0.5, 0.7], [10.2, 1.4, 1.2, 0.5, 0.7],
      [9.6, 6.2, 1.2, 0.5, 1.8], [9.6, 7.4, 1.2, 0.5, 1.8],
      [12.8, 6.6, 1.2, 0.5, 1.8], [13.1, 8.5, 0.5, 0.5, 1.4, 1],
    ],
  };
  const K2 = 28; // pixels per metre, top view
  const K3 = 20; // pixels per metre, 3D view
  const O2 = [30, 150];
  const O3 = [740, 140];
  const p2 = (x, y) => [O2[0] + x * K2, O2[1] + y * K2];
  const p3 = (x, y, z = 0) => [O3[0] + (x - y) * 0.866 * K3, O3[1] + (x + y) * 0.5 * K3 - z * K3];
  const pts = (list) => list.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const isoBox = (x, y, w, d, h, cls, i) => {
    const top = pts([p3(x, y, h), p3(x + w, y, h), p3(x + w, y + d, h), p3(x, y + d, h)]);
    const right = pts([p3(x + w, y, 0), p3(x + w, y + d, 0), p3(x + w, y + d, h), p3(x + w, y, h)]);
    const front = pts([p3(x, y + d, 0), p3(x + w, y + d, 0), p3(x + w, y + d, h), p3(x, y + d, h)]);
    return `<g class="bx ${cls}" style="--i:${i}"><polygon class="side" points="${front}"/><polygon class="side2" points="${right}"/><polygon class="top" points="${top}"/></g>`;
  };

  function buildTwin(host) {
    const { w, d, partX, door, wallH, zones, boxes } = PLAN;
    const [rx, ry] = p2(0, 0);
    const [rx2, ry2] = p2(w, d);
    const [px1, py1] = p2(partX, 0);
    const [px2, py2] = p2(partX, d);
    const flag = boxes.find((b) => b[5]);
    const c2 = p2(flag[0] + flag[2] / 2, flag[1] + flag[3] / 2);
    const c3 = p3(flag[0] + flag[2] / 2, flag[1] + flag[3] / 2, flag[4]);
    let out = '<svg viewBox="0 0 1000 520" aria-hidden="true">';
    out += `<g class="v2d"><rect class="room" data-draw pathLength="1" x="${rx}" y="${ry}" width="${rx2 - rx}" height="${ry2 - ry}"/>`;
    out += `<line class="part" data-draw pathLength="1" x1="${px1}" y1="${py1}" x2="${px2}" y2="${py2}"/>`;
    out += `<line class="door" x1="${px1}" y1="${p2(0, door[0])[1]}" x2="${px1}" y2="${p2(0, door[1])[1]}"/>`;
    zones.forEach((z) => {
      const [zx, zy] = p2(z[0], z[1]);
      out += `<rect class="zone" x="${zx}" y="${zy}" width="${z[2] * K2}" height="${z[3] * K2}"/>`;
    });
    boxes.forEach((b, i) => {
      const [bx, by] = p2(b[0], b[1]);
      out += `<rect class="bx obj${b[5] ? ' flag' : ''}" style="--i:${i}" x="${bx}" y="${by}" width="${b[2] * K2}" height="${b[3] * K2}"/>`;
    });
    out += '</g><g class="v3d">';
    out += `<polygon class="floor" points="${pts([p3(0, 0), p3(w, 0), p3(w, d), p3(0, d)])}"/>`;
    out += `<polygon class="wall" points="${pts([p3(0, 0), p3(w, 0), p3(w, 0, wallH), p3(0, 0, wallH)])}"/>`;
    out += `<polygon class="wall" points="${pts([p3(0, 0), p3(0, d), p3(0, d, wallH), p3(0, 0, wallH)])}"/>`;
    const order = boxes.map((b, i) => ({ b, i })).sort((a, c) => a.b[0] + a.b[1] - (c.b[0] + c.b[1]));
    out += isoBox(partX, 0, 0.15, door[0], wallH, 'wall3', 0);
    out += isoBox(partX, door[1], 0.15, d - door[1], wallH, 'wall3', 1);
    order.forEach(({ b, i }) => { out += isoBox(b[0], b[1], b[2], b[3], b[4], b[5] ? 'flag' : '', i + 2); });
    out += '</g>';
    out += `<path id="twin-link" class="twin-link" data-draw pathLength="1" data-delay="1000" d="M${c2[0]},${c2[1]} C${c2[0]},${c2[1] - 150} ${c3[0]},${c3[1] - 150} ${c3[0]},${c3[1]}"/>`;
    out += `<circle class="ring" data-ping data-delay="1000" cx="${c2[0]}" cy="${c2[1]}" r="20"/>`;
    out += `<circle class="ring" data-ping data-delay="1900" cx="${c3[0]}" cy="${c3[1]}" r="20"/>`;
    out += '<circle class="dot" data-packet="twin-link" data-delay="1000" data-dur="900" r="6"/>';
    out += '<text class="cap" x="30" y="490">plan.json → 2D</text><text class="cap" x="567" y="490">plan.json → 3D</text></svg>';
    host.innerHTML = out;
  }

  /* ---------- connectors between nodes ---------- */
  function offsetIn(el, box) {
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== box; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return { x, y };
  }

  function buildLinks(box) {
    const svg = svgEl('svg', { class: 'links', 'aria-hidden': 'true', width: box.offsetWidth, height: box.offsetHeight });
    box.dataset.links.split(';').forEach((spec) => {
      const [from, tos] = spec.split('>').map((t) => t.trim());
      const a = box.querySelector(`[data-node="${from}"]`);
      tos.split(/\s+/).forEach((token, n) => {
        const [id, mode] = token.split('|');
        const b = box.querySelector(`[data-node="${id}"]`);
        if (!a || !b) return;
        const pa = offsetIn(a, box);
        const pb = offsetIn(b, box);
        const vertical = mode === 'v';
        const ax = pa.x + (vertical ? a.offsetWidth / 2 : a.offsetWidth);
        const ay = pa.y + (vertical ? a.offsetHeight : a.offsetHeight / 2);
        const bx = pb.x + (vertical ? b.offsetWidth / 2 : 0);
        const by = pb.y + (vertical ? 0 : b.offsetHeight / 2);
        const dx = vertical ? 0 : (bx - ax) * 0.5;
        const dy = vertical ? (by - ay) * 0.5 : 0;
        const path = svgEl('path', {
          class: `link${b.dataset.dashed !== undefined ? ' dashed' : ''}`, 'data-draw': '', pathLength: 1, 'data-delay': n * 90, id: `lk-${from}-${id}`,
          d: `M${ax},${ay} C${ax + dx},${ay + dy} ${bx - dx},${by - dy} ${bx},${by}`,
        });
        if (b.dataset.step) path.dataset.step = b.dataset.step;
        svg.append(path);
        if (b.dataset.packet !== undefined) {
          const dot = svgEl('circle', { class: 'dot', id: `dot-${path.id}`, 'data-linked': '', 'data-packet': path.id, 'data-delay': n * 90 + 100, 'data-dur': 800, r: 6 });
          path.dataset.dot = dot.id;
          svg.append(dot);
        }
      });
    });
    box.prepend(svg);
  }

  /* ---------- the toolkit ---------- */
  function create(config = {}) {
    const cfg = {
      ease: 'cubic-bezier(.23,1,.32,1)',
      easeMove: 'cubic-bezier(.77,0,.175,1)',
      transition: 'wipe', // wipe | push | rise | zoom
      enter: 'mask', // how .in elements arrive: mask | rise | scale
      ms: 520,
      stagger: 55,
      ...config,
    };
    const running = new Set();
    let seq = 0;
    const loops = new Set();
    let ambientTimer = 0;

    function run(el, frames, opts = {}) {
      if (!el || !canMove()) return null;
      const a = el.animate(frames, { duration: 420, easing: cfg.ease, fill: 'both', ...opts });
      running.add(a);
      a.finished.then(() => { running.delete(a); a.cancel(); }, () => running.delete(a));
      return a;
    }

    function settle() {
      clearTimeout(timer);
      clearTimeout(ambientTimer);
      running.forEach((a) => a.cancel());
      running.clear();
      stopLoops();
      document.querySelectorAll('.slide.moving').forEach((s) => s.classList.remove('moving'));
    }

    // Only the incoming slide animates. app.js has already hidden the old one, so nothing of it can show up again
    // (the earlier version let the old slide fade out and then snap back for a few frames in Firefox).
    // Only transform and opacity: clip-path would repaint the whole slide every frame.
    const lead = () => (cfg.transition === 'push' ? 120 : 80); // when the content may start moving
    const TRANSITIONS = {
      wipe: (inc, dir) => [run(inc, [{ opacity: 0, transform: `translateX(${56 * dir}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: cfg.ms * 0.7 })],
      push: (inc, dir) => [run(inc, [{ transform: `translateX(${100 * dir}%)` }, { transform: 'translateX(0)' }], { duration: cfg.ms, easing: cfg.easeMove })],
      rise: (inc, dir) => [run(inc, [{ opacity: 0, transform: `translateY(${30 * dir}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: cfg.ms * 0.7 })],
      zoom: (inc) => [run(inc, [{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'scale(1)' }], { duration: cfg.ms * 0.7 })],
    };

    const ENTER = {
      mask: [{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'translateY(0)' }],
      rise: [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'translateY(0)' }],
      scale: [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }],
    };

    function countUp(el) {
      const to = Number(el.dataset.count);
      const from = Number(el.dataset.from ?? 0);
      const dec = Number(el.dataset.dec ?? 0);
      const fmt = (v) => v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const id = String(++seq);
      el.dataset.run = id;
      if (!canMove()) { el.textContent = fmt(to); return; }
      const dur = Number(el.dataset.dur ?? 900);
      const delay = Number(el.dataset.delay ?? 0);
      el.textContent = fmt(from);
      const t0 = performance.now() + delay;
      const frame = (now) => {
        if (el.dataset.run !== id) return;
        const p = Math.max(0, Math.min(1, (now - t0) / dur));
        el.textContent = fmt(from + (to - from) * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    function movePacket(dot) {
      const path = document.getElementById(dot.dataset.packet);
      if (!path || !canMove()) return;
      const length = path.getTotalLength();
      const frames = [];
      for (let i = 0; i <= 36; i++) {
        const p = path.getPointAtLength((length * i) / 36);
        frames.push({ transform: `translate(${p.x}px,${p.y}px)`, opacity: i === 0 || i === 36 ? 0 : 1, offset: i / 36 });
      }
      run(dot, frames, { duration: Number(dot.dataset.dur ?? 1000), delay: Number(dot.dataset.delay ?? 0), easing: 'linear' });
    }

    function ping(ring) {
      run(ring, [{ opacity: 0.9, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 900, delay: Number(ring.dataset.delay ?? 0) });
    }

    function apply(el) {
      if (el.matches('[data-draw]')) {
        el.style.setProperty('--draw-delay', `${el.dataset.delay ?? 0}ms`);
        void el.getBoundingClientRect();
        el.classList.add('drawn');
      }
      if (el.dataset.dot) movePacket(document.getElementById(el.dataset.dot));
      if (el.matches('[data-count]')) countUp(el);
      if (el.matches('[data-packet]')) movePacket(el);
      if (el.matches('[data-ping]')) ping(el);
      if (el.matches('[data-twin]')) el.classList.add('on');
    }

    const HOOKS = '[data-draw],[data-count],[data-packet],[data-ping],[data-twin]';

    function reveal(scope, slideLevel) {
      const found = [...(scope.matches(HOOKS) ? [scope] : []), ...scope.querySelectorAll(HOOKS)];
      found.filter((el) => !el.hasAttribute('data-linked') && (!slideLevel || inStepOnly(el))).forEach(apply);
    }

    function reset(scope) {
      scope.querySelectorAll('.drawn').forEach((el) => el.classList.remove('drawn'));
      scope.querySelectorAll('[data-twin].on').forEach((el) => el.classList.remove('on'));
    }

    // A slide that has left starts clean: no step stays on, so nothing flashes when it comes back.
    function clear(slide) {
      reset(slide);
      slide.querySelectorAll('[data-step]').forEach((el) => el.classList.remove('on', 'cur', 'done'));
    }

    // ---------- ambient motion: the slide keeps living while the speaker talks ----------
    // Loops run only on the active slide and stop on every navigation. Movement is linear (constant flow).
    function stopLoops() {
      loops.forEach((a) => a.cancel());
      loops.clear();
      document.querySelectorAll('[data-loop]').forEach((el) => el.removeAttribute('data-loop'));
    }

    // A packet runs along a path for `travel` ms, hides, and starts again every `period` ms.
    function loopAlong(dot, path, { period, travel, delay = 0 }) {
      if (!canMove() || dot.hasAttribute('data-loop')) return;
      const length = path.getTotalLength();
      const share = Math.min(0.9, travel / period);
      const count = 28;
      const frames = [];
      for (let i = 0; i <= count; i++) {
        const p = path.getPointAtLength((length * i) / count);
        frames.push({ transform: `translate(${p.x}px,${p.y}px)`, opacity: i === 0 || i === count ? 0 : 1, offset: (i / count) * share });
      }
      const end = path.getPointAtLength(length);
      frames.push({ transform: `translate(${end.x}px,${end.y}px)`, opacity: 0, offset: 1 });
      dot.setAttribute('data-loop', '');
      loops.add(dot.animate(frames, { duration: period, delay, iterations: Infinity, easing: 'linear' }));
    }

    // A ring expands, fades, rests, and repeats.
    function loopPing(ring, delay) {
      if (!canMove() || ring.hasAttribute('data-loop')) return;
      ring.setAttribute('data-loop', '');
      loops.add(ring.animate([{ opacity: 0.9, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 900, delay, endDelay: 1700, iterations: Infinity, easing: cfg.ease }));
    }

    const isShown = (el) => { const step = el.closest('[data-step]'); return !step || step.classList.contains('on'); };

    function ambient(slide) {
      if (!canMove() || !slide.classList.contains('active')) return;
      // the pipeline passes a packet from node to node; everything else flows in parallel
      const relay = slide.classList.contains('s-ai');
      slide.querySelectorAll('.links .link').forEach((path, i) => {
        if (!isShown(path)) return;
        let dot = path.dataset.dot ? document.getElementById(path.dataset.dot) : null;
        if (!dot) {
          dot = svgEl('circle', { class: 'dot', id: `dot-${path.id}`, 'data-linked': '', 'data-packet': path.id, r: 6 });
          path.dataset.dot = dot.id;
          path.parentNode.append(dot);
        }
        loopAlong(dot, path, relay ? { period: 5600, travel: 700, delay: Math.min(i, 4) * 700 } : { period: 2800, travel: 1000, delay: i * 200 });
      });
      slide.querySelectorAll('[data-ping]').forEach((ring, i) => { if (isShown(ring)) loopPing(ring, i * 450); });
      slide.querySelectorAll('[data-packet]:not([data-linked])').forEach((dot) => {
        const path = document.getElementById(dot.dataset.packet);
        if (path) loopAlong(dot, path, { period: 3800, travel: 1100, delay: 300 });
      });
      const curve = slide.querySelector('.chart .curve');
      if (curve) {
        curve.id ||= 'curve-path';
        let dot = slide.querySelector('.chart .amb-dot');
        if (!dot) {
          dot = svgEl('circle', { class: 'dot amb-dot', 'data-linked': '', 'data-packet': curve.id, r: 9 });
          curve.parentNode.append(dot);
        }
        loopAlong(dot, curve, { period: 4200, travel: 2200, delay: 400 });
      }
    }

    const ambientAfter = (slide, ms) => {
      clearTimeout(ambientTimer);
      stopLoops();
      ambientTimer = setTimeout(() => ambient(slide), ms);
    };

    let timer = 0;
    function entrance(slide) {
      const start = lead();
      const lines = [...slide.querySelectorAll('.ln > span')];
      lines.forEach((el, i) => run(el, [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }], { duration: 520, delay: start + i * 70 }));
      const items = [...slide.querySelectorAll('.in')];
      items.forEach((el, i) => run(el, ENTER[cfg.enter], { duration: 380, delay: start + 60 + i * cfg.stagger }));
      timer = setTimeout(() => { if (slide.classList.contains('active')) reveal(slide, true); }, start);
      ambientAfter(slide, slide.classList.contains('s-title') ? 2400 : 1500);
    }

    return {
      cfg,
      prepare(slides) {
        document.querySelectorAll('[data-twin]').forEach(buildTwin);
        document.querySelectorAll('[data-links]').forEach(buildLinks);
        if (staticMode) {
          document.querySelectorAll('[data-draw]').forEach((el) => el.classList.add('drawn'));
          document.querySelectorAll('[data-twin]').forEach((el) => el.classList.add('on'));
        }
        slides.forEach((s) => s.classList.remove('leaving'));
        // decode screenshots now, not in the middle of the first transition
        document.querySelectorAll('.slide img').forEach((img) => { img.decode?.().catch(() => {}); });
      },
      enter(slide, prev, dir) {
        settle();
        if (staticMode) return;
        if (prev && prev !== slide) clear(prev);
        if (canMove()) {
          slide.classList.add('moving');
          const anims = (TRANSITIONS[cfg.transition] ?? TRANSITIONS.wipe)(slide, dir).filter(Boolean);
          Promise.allSettled(anims.map((x) => x.finished)).then(() => slide.classList.remove('moving'));
        }
        entrance(slide);
      },
      step(slide, n, before) {
        if (staticMode) return;
        if (n > before) {
          for (let k = before + 1; k <= n; k++) slide.querySelectorAll(`[data-step="${k}"]`).forEach((el) => reveal(el, false));
        } else {
          slide.querySelectorAll('[data-step]').forEach((el) => { if (Number(el.dataset.step) > n) reset(el); });
        }
        ambientAfter(slide, 1200);
      },
    };
  }

  window.DeckCore = { create };
})();
