export function eventCover(el, c, cls) {
  if (c.cover && !c.homeLogo && !c.awayLogo) return el('img', { class: cls, src: c.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  const crest = (src, side) => src ? el('img', { class: `crest ${side}`, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: `crest ${side} crest-empty` });
  const background = c.cover || c.background;
  return el('span', { class: `${cls} event-generic`, style: background ? `background-image:url("${background.replace(/"/g, '%22')}")` : null, 'aria-hidden': 'true' },
    crest(c.homeLogo, 'home'),
    c.leagueLogo ? el('span', { class: 'crest-league' }, el('img', { src: c.leagueLogo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : el('span', { class: 'crest-vs' }, 'VS'),
    crest(c.awayLogo, 'away'));
}

