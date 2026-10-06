/* Variant C «Пульт»: the next slide zooms in out of the dark; items scale up in a short stagger; a scan line passes once per cycle. */
window.DeckMotion = window.DeckCore.create({ transition: 'zoom', enter: 'scale', ms: 460, stagger: 50 });
