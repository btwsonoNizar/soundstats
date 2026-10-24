'use strict';
/*
 * Grafico a barre in SVG, senza librerie.
 * Tocca o trascina col dito sul grafico per leggere i valori.
 *
 * items: [{ value, label, tip }]
 *   label: testo sotto la barra ('' = nessuna etichetta)
 *   tip:   titolo del fumetto
 * opt: { height, fmt(value) -> html, title }
 */

function niceTicks(max, count) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v <= Math.ceil(max / step) * step + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function compactNum(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',').replace(/,0$/, '') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + 'k';
  return String(Math.round(v));
}

function barChart(host, items, opt = {}) {
  const H = opt.height || 170;
  const padT = 10, padB = 22, padL = 34, padR = 4;
  const W = Math.max(260, Math.round(host.clientWidth || 320));
  const n = items.length;
  let max = 0;
  for (const d of items) if (d.value > max) max = d.value;
  const ticks = niceTicks(max || 1, 3);
  const top = ticks[ticks.length - 1];
  const iw = W - padL - padR, ih = H - padT - padB;
  const bw = iw / Math.max(1, n);
  const gap = Math.min(2, bw * 0.3);
  const y0 = padT + ih;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${opt.title || ''}">`;
  for (const v of ticks) {
    const y = y0 - (v / top) * ih;
    s += `<line class="grid${v === 0 ? ' base' : ''}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    s += `<text class="axis" x="${padL - 6}" y="${y + 3.5}" text-anchor="end">${compactNum(v)}</text>`;
  }
  items.forEach((d, i) => {
    const x = padL + i * bw + gap / 2, w = Math.max(0.5, bw - gap);
    const h = (d.value / top) * ih;
    if (h > 0) {
      const r = Math.min(4, w / 2, h);
      const yt = y0 - h;
      s += `<path class="bar" data-i="${i}" d="M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + w - r}Q${x + w},${yt} ${x + w},${yt + r}V${y0}Z"/>`;
    }
    if (d.label) {
      const cx = Math.min(Math.max(x + w / 2, padL + 8), W - padR - 8);
      s += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${d.label}</text>`;
    }
  });
  s += `</svg><div class="tip" hidden></div>`;

  host.classList.add('chart');
  host.innerHTML = s;
  const svg = host.querySelector('svg');
  const tip = host.querySelector('.tip');
  const bars = [];
  host.querySelectorAll('.bar').forEach(el => { bars[+el.dataset.i] = el; });
  let current = -1;

  const hide = () => {
    tip.hidden = true;
    if (bars[current]) bars[current].classList.remove('on');
    current = -1;
  };
  const show = e => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const i = Math.floor((sx - padL) / bw);
    if (i < 0 || i >= n) return hide();
    if (i !== current) {
      if (bars[current]) bars[current].classList.remove('on');
      if (bars[i]) bars[i].classList.add('on');
      current = i;
      const d = items[i];
      tip.innerHTML = `<span>${d.tip}</span><b>${opt.fmt ? opt.fmt(d.value) : d.value}</b>`;
    }
    tip.hidden = false;
    const barX = (padL + (i + 0.5) * bw) * (rect.width / W);
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(barX - tw / 2, 0), rect.width - tw) + 'px';
  };
  host.onpointerdown = show;
  host.onpointermove = show;
  host.onpointerleave = hide;
  host.onpointercancel = hide;
}
