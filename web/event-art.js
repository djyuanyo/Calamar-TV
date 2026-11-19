export function eventCover(el, c, cls) {
  const hero = cls === 'event-hero-cover';
  const image = (src, className) => el('img', {
    class: className, src, alt: '', loading: hero ? 'eager' : 'lazy',
    fetchpriority: hero && src === (c.cover || c.background) ? 'high' : null, referrerpolicy: 'no-referrer',
  });
  if (c.cover && !c.homeLogo && !c.awayLogo) return image(c.cover, cls);
  const crest = (src, side) => src ? image(src, `crest ${side}`) : el('span', { class: `crest ${side} crest-empty` });
  const background = c.cover || c.background;
  return el('span', { class: `${cls} event-generic`, 'aria-hidden': 'true' },
    background ? image(background, 'event-background') : null,
    crest(c.homeLogo, 'home'),
    c.leagueLogo ? el('span', { class: 'crest-league' }, image(c.leagueLogo)) : el('span', { class: 'crest-vs' }, 'VS'),
    crest(c.awayLogo, 'away'));
}
