/* Variant A «Шов»: the new slide is revealed by a wipe that follows the seam; lines rise out of masks. */
window.DeckMotion = window.DeckCore.create({ transition: 'wipe', enter: 'mask', ms: 520, stagger: 55 });
