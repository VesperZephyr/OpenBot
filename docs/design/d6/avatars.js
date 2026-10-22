// Original deterministic vector recipe for the standalone design study.
// No network or model calls. A selected recipe is stable until explicitly changed.
function generatedAvatar(seed, role = '') {
  const palettes = [
    ['#ded1ee','#534060','#eee8b5'], ['#d5e8dc','#385d4c','#eed5ad'],
    ['#f2dac2','#78523d','#e4d5ef'], ['#d4e3ef','#3b5269','#e8e7b5'],
    ['#eed7e1','#714757','#d9e7c0'], ['#e3e5bf','#555d35','#e4d8ee']
  ];
  const n = Math.abs(Math.trunc(seed));
  const [body, ink, accent] = palettes[n % palettes.length];
  const shape = Math.floor(n / 6) % 3;
  const outline = shape === 0
    ? '<path d="M37 31C56 10 99 12 117 35c16 22 18 59 2 83-13 21-40 27-62 20-28-8-39-34-36-61 1-19 6-35 16-46Z"/>'
    : shape === 1
      ? '<rect x="24" y="24" width="104" height="116" rx="37"/>'
      : '<path d="M26 59 38 25l31 10c12-3 23-3 34 0l22-9 3 40c10 35-5 70-39 76-34 6-66-9-68-44-1-15 1-29 5-39Z"/>';
  const researcher = /research|analyst|scout|review/i.test(role);
  const writer = /writ|edit|scribe|design/i.test(role);
  const motif = researcher
    ? `<g fill="none" stroke="${ink}" stroke-width="2"><circle cx="57" cy="78" r="15"/><circle cx="96" cy="78" r="15"/><path d="M72 78h9"/></g>`
    : writer
      ? `<path d="M43 38c10-18 40-22 62-10l-6 14H43Z" fill="${accent}" stroke="${ink}" stroke-width="1.5"/>`
      : `<path d="M76 26C74 10 88 5 101 11c-2 12-12 18-25 15Z" fill="${accent}" stroke="${ink}" stroke-width="1.5"/>`;
  const mouth = Math.floor(n / 18) % 2 ? 'M66 105h17' : 'M64 101c8 9 17 8 24-1';
  return `<svg viewBox="0 0 150 165" aria-hidden="true"><g fill="${body}" stroke="${ink}" stroke-width="1.8">${outline}</g><g fill="${ink}"><ellipse cx="57" cy="78" rx="5" ry="8"/><ellipse cx="96" cy="78" rx="5" ry="8"/></g>${motif}<path d="${mouth}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="m48 136-5 15m58-14 6 13" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/></svg>`;
}
