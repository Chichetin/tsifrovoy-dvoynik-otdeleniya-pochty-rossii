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
          const dot = svgEl('circle', { class: 'dot', id: `dot-${path.id}`, 'data-packet': path.id, 'data-delay': n * 90 + 100, 'data-dur': 800, r: 6 });
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

    function run(el, frames, opts = {}) {
      if (!el || !canMove()) return null;
      const a = el.animate(frames, { duration: 420, easing: cfg.ease, fill: 'both', ...opts });
      running.add(a);
      a.finished.then(() => { running.delete(a); a.cancel(); }, () => running.delete(a));
      return a;
    }

    function settle() {
      running.forEach((a) => a.cancel());
      running.clear();
      document.querySelectorAll('.slide.leaving').forEach((s) => s.classList.remove('leaving'));
    }

    const TRANSITIONS = {
      wipe: (inc, out, dir) => [
        run(inc, [{ clipPath: dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: cfg.ms, easing: cfg.easeMove }),
        run(out, [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-70 * dir}px)`, opacity: 0 }], { duration: cfg.ms * 0.8 }),
      ],
      push: (inc, out, dir) => [
        run(inc, [{ transform: `translateX(${100 * dir}%)` }, { transform: 'translateX(0)' }], { duration: cfg.ms, easing: cfg.easeMove }),
        run(out, [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-30 * dir}%)`, opacity: 0.4 }], { duration: cfg.ms, easing: cfg.easeMove }),
      ],
      rise: (inc, out, dir) => [
        run(inc, [{ opacity: 0, transform: `translateY(${36 * dir}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: cfg.ms * 0.8 }),
        run(out, [{ opacity: 1 }, { opacity: 0 }], { duration: cfg.ms * 0.5 }),
      ],
      zoom: (inc, out) => [
        run(inc, [{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'scale(1)' }], { duration: cfg.ms * 0.8 }),
        run(out, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: cfg.ms * 0.6 }),
      ],
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
      found.filter((el) => !slideLevel || inStepOnly(el)).forEach(apply);
    }

    function reset(scope) {
      scope.querySelectorAll('.drawn').forEach((el) => el.classList.remove('drawn'));
      scope.querySelectorAll('[data-twin].on').forEach((el) => el.classList.remove('on'));
    }

    function entrance(slide) {
      const lines = [...slide.querySelectorAll('.ln > span')];
      lines.forEach((el, i) => run(el, [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }], { duration: 560, delay: 120 + i * 70 }));
      const items = [...slide.querySelectorAll('.in')];
      items.forEach((el, i) => run(el, ENTER[cfg.enter], { delay: 180 + i * cfg.stagger }));
      reveal(slide, true);
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
      },
      enter(slide, prev, dir) {
        settle();
        if (staticMode) return;
        if (prev && prev !== slide && canMove()) {
          prev.classList.add('leaving');
          const anims = (TRANSITIONS[cfg.transition] ?? TRANSITIONS.wipe)(slide, prev, dir).filter(Boolean);
          Promise.allSettled(anims.map((a) => a.finished)).then(() => {
            prev.classList.remove('leaving');
            if (!prev.classList.contains('active')) reset(prev);
          });
        } else if (prev && prev !== slide) {
          reset(prev);
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
      },
    };
  }

  window.DeckCore = { create };
})();
