/* Variant G «План»: slides push sideways along the route; elements rise in with a short stagger. */
window.DeckMotion = window.DeckCore.create({ transition: 'push', enter: 'rise', ms: 480, stagger: 60 });

/* s13 «Наша команда»: the portraits enter like the lamp in the Pixar logo. The first one drops onto its place.
   Each next one falls onto the previous portrait, squashes it, bounces off and hops to its own place.
   The name appears when its portrait lands. Only transform and opacity move; reduced motion gets a fade. */
(() => {
  const slide = document.getElementById('s13');
  if (!slide || document.documentElement.classList.contains('static')) return;
  const portraits = [...slide.querySelectorAll('.team-arches .portrait')];
  const captions = [...slide.querySelectorAll('.team-arches figcaption')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fall = 'cubic-bezier(.55,0,1,.45)';
  const rise = 'cubic-bezier(0,.55,.45,1)';
  const DUR = 950;
  const STEP = 650;
  let running = [];

  function play() {
    running.forEach((a) => a.cancel());
    running = [];
    if (reduce) {
      [...portraits, ...captions].forEach((el, i) => running.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: i * 40, fill: 'backwards' })));
      return;
    }
    const gap = portraits.length > 1 ? portraits[1].getBoundingClientRect().left - portraits[0].getBoundingClientRect().left : 0;
    const scale = slide.getBoundingClientRect().width / 1920;
    const d = gap / scale; // slot spacing in stage pixels
    const h = portraits[0].offsetHeight;
    portraits.forEach((el, k) => {
      const delay = 200 + k * STEP;
      const frames = k === 0
        ? [
          { transform: 'translate(0,-760px) scale(.92,1.1)', easing: fall },
          { transform: 'translate(0,0) scale(1.14,.84)', offset: 0.6, easing: rise },
          { transform: 'translate(0,-40px) scale(.97,1.04)', offset: 0.8, easing: fall },
          { transform: 'translate(0,0) scale(1,1)' },
        ]
        : [
          { transform: `translate(${-d}px,-760px) scale(.92,1.1)`, easing: fall },
          { transform: `translate(${-d}px,${-h}px) scale(1.16,.84)`, offset: 0.35, easing: rise },
          { transform: `translate(${-d * 0.5}px,${-h - 150}px) scale(.94,1.08)`, offset: 0.62, easing: fall },
          { transform: 'translate(0,0) scale(1.12,.88)', offset: 0.88, easing: rise },
          { transform: 'translate(0,0) scale(1,1)' },
        ];
      running.push(el.animate(frames, { duration: DUR, delay, fill: 'backwards' }));
      // the landing on the previous portrait squashes it, then it springs back
      if (k > 0) {
        running.push(portraits[k - 1].animate([
          { transform: 'scale(1,1)' },
          { transform: 'scale(1.1,.82)', offset: 0.3 },
          { transform: 'scale(.97,1.05)', offset: 0.65 },
          { transform: 'scale(1,1)' },
        ], { duration: 420, delay: delay + DUR * 0.35 - 30, easing: 'cubic-bezier(.23,1,.32,1)' }));
      }
      running.push(captions[k].animate([
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 320, delay: delay + DUR * (k === 0 ? 0.6 : 0.88), easing: 'cubic-bezier(.23,1,.32,1)', fill: 'backwards' }));
    });
  }

  let active = slide.classList.contains('active');
  if (active) play();
  new MutationObserver(() => {
    const now = slide.classList.contains('active');
    if (now && !active) play();
    if (!now && active) { running.forEach((a) => a.cancel()); running = []; }
    active = now;
  }).observe(slide, { attributes: true, attributeFilter: ['class'] });
})();
