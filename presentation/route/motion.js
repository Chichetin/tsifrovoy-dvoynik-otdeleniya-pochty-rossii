/* Variant B «Дорожка»: slides push sideways along a route; elements rise in with a short stagger. */
window.DeckMotion = window.DeckCore.create({ transition: 'push', enter: 'rise', ms: 480, stagger: 60 });
