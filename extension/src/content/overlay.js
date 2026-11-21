// Visual guidance: a highlight ring + arrow anchored to the live bounding box
// of a validated element. Re-measured every animation frame, so it follows
// scroll, resize and layout shifts. Never uses model-supplied coordinates.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  let host, root, ring, arrow, bubble, badge, label, edge, tick;
  let anchor = null, raf = 0, onLost = null, onRect = null, lostFrames = 0, frameNo = 0;

  const CSS = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
    .ring { position: fixed; border: 3px solid #ff7a1a; border-radius: 10px;
      box-shadow: 0 0 0 4px rgba(255,122,26,.25), 0 0 24px 6px rgba(255,122,26,.45);
      animation: pulse 1.4s ease-in-out infinite; transition: opacity .15s; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 8px rgba(255,122,26,.12), 0 0 32px 10px rgba(255,122,26,.35); } }
    .arrow { position: fixed; width: 64px; height: 40px; transform-origin: 100% 50%; }
    .arrow svg { width: 64px; height: 40px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); animation: nudge 1s ease-in-out infinite; }
    @keyframes nudge { 50% { transform: translateX(-8px); } }
    .bubble { position: fixed; max-width: 260px; background: #2a1c10; color: #fff; font: 600 13px/1.35 "Noto Sans Malayalam","Noto Sans",system-ui,sans-serif;
      padding: 7px 10px; border-radius: 10px; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
    .ring.enter { animation: enter .35s ease-out, pulse 1.4s ease-in-out .35s infinite; }
    @keyframes enter { 0% { transform: scale(1.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    .bubble .n { display: inline-block; min-width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 50%;
      background: #ff7a1a; color: #fff; font-size: 12px; margin-right: 6px; }
    .tick { position: fixed; border: 3px solid #12b76a; border-radius: 10px; background: rgba(18,183,106,.12);
      display: flex; align-items: center; justify-content: center; color: #12b76a; font: 800 22px system-ui, sans-serif;
      animation: ok .7s ease-out forwards; }
    @keyframes ok { 0% { opacity: 1; transform: scale(1); } 60% { opacity: 1; transform: scale(1.06); } 100% { opacity: 0; transform: scale(1.12); } }
    .edge { position: fixed; left: 50%; transform: translateX(-50%); background: #ff7a1a; color: #fff;
      font: 700 13px system-ui, sans-serif; padding: 6px 12px; border-radius: 999px; }
    .hidden { display: none; }
  `;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'koode-overlay-root';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="layer">
      <div class="ring hidden"></div>
      <div class="arrow hidden"><svg viewBox="0 0 64 40"><path d="M2 20 H44 M30 6 L50 20 L30 34" stroke="#ff7a1a" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="bubble hidden"><span class="n"></span><span class="t"></span></div>
      <div class="edge hidden"></div></div>`;
    ring = root.querySelector('.ring');
    arrow = root.querySelector('.arrow');
    bubble = root.querySelector('.bubble');
    badge = bubble.querySelector('.n');
    label = bubble.querySelector('.t');
    edge = root.querySelector('.edge');
    document.documentElement.appendChild(host);
  }

  // Choose the side with the most room; returns arrow tip and rotation.
  function placeArrow(r) {
    const gap = 8;
    if (r.left >= 80) return { side: 'left', tipX: r.left - gap, tipY: r.top + r.height / 2, rot: 0 };
    if (r.top >= 80) return { side: 'top', tipX: r.left + Math.min(r.width / 2, 40), tipY: r.top - gap, rot: 90 };
    if (innerHeight - r.bottom >= 80) return { side: 'bottom', tipX: r.left + Math.min(r.width / 2, 40), tipY: r.bottom + gap, rot: -90 };
    return { side: 'right', tipX: r.right + gap, tipY: r.top + r.height / 2, rot: 180 };
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!anchor) return;
    if (!anchor.isConnected || !K.extractor.isRendered(anchor)) {
      lostFrames += 1;
      [ring, arrow, bubble].forEach((n) => n.classList.add('hidden'));
      if (lostFrames > 10 && onLost) { const cb = onLost; onLost = null; cb(); }
      return;
    }
    lostFrames = 0;
    const r = anchor.getBoundingClientRect();
    if (onRect && ++frameNo % 15 === 0) onRect(r);
    const pad = 5;
    const above = r.bottom < 0, below = r.top > innerHeight;
    host.dataset.koodeVisibility = above ? 'above' : below ? 'below' : 'in';
    host.dataset.koodeRect = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (above || below) {
      [ring, arrow, bubble].forEach((n) => n.classList.add('hidden'));
      edge.classList.remove('hidden');
      edge.textContent = (above ? '▲ Scroll up — ' : '▼ Scroll down — ') + (label.textContent || 'target');
      edge.style.top = above ? '12px' : '';
      edge.style.bottom = below ? '12px' : '';
      delete host.dataset.koodeTip;
      return;
    }
    edge.classList.add('hidden');
    ring.classList.remove('hidden');
    ring.style.left = r.left - pad + 'px';
    ring.style.top = r.top - pad + 'px';
    ring.style.width = r.width + pad * 2 + 'px';
    ring.style.height = r.height + pad * 2 + 'px';

    const p = placeArrow(r);
    arrow.classList.remove('hidden');
    // Arrow element is 64x40 with tip at its right-middle; rotate around the tip.
    arrow.style.left = p.tipX - 64 + 'px';
    arrow.style.top = p.tipY - 20 + 'px';
    arrow.style.transform = `rotate(${p.rot}deg)`;
    host.dataset.koodeTip = Math.round(p.tipX) + ',' + Math.round(p.tipY);
    host.dataset.koodeSide = p.side;

    if (label.textContent) {
      bubble.classList.remove('hidden');
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      let bx, by;
      if (p.side === 'left') { bx = p.tipX - 64 - bw - 6; by = p.tipY - bh / 2; }
      else if (p.side === 'top') { bx = p.tipX - bw / 2; by = p.tipY - 64 - bh - 6; }
      else if (p.side === 'bottom') { bx = p.tipX - bw / 2; by = p.tipY + 64 + 6; }
      else { bx = p.tipX + 64 + 6; by = p.tipY - bh / 2; }
      if (bx < 6) { bx = r.left; by = r.bottom + 12; }
      bubble.style.left = Math.max(6, Math.min(bx, innerWidth - bw - 6)) + 'px';
      bubble.style.top = Math.max(6, Math.min(by, innerHeight - bh - 6)) + 'px';
    }
  }

  function point(targetAnchor, { text = '', step = 0, lost, rect } = {}) {
    ensure();
    const fresh = anchor !== targetAnchor;
    anchor = targetAnchor;
    onLost = lost || null;
    onRect = rect || null;
    lostFrames = 0;
    label.textContent = text;
    if (step) badge.textContent = String(step);
    badge.classList.toggle('hidden', !badge.textContent);
    if (fresh) { ring.classList.remove('enter'); void ring.offsetWidth; ring.classList.add('enter'); }
    host.dataset.koodeActive = 'true';
    const r = anchor.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setText(text) { if (label) label.textContent = text || ''; }

  // Brief green tick over the element the user just completed (independent of clear()).
  function success() {
    if (!anchor || !anchor.isConnected) return;
    const r = anchor.getBoundingClientRect();
    if (tick) tick.remove();
    tick = document.createElement('div');
    tick.className = 'tick';
    tick.textContent = '✓';
    Object.assign(tick.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
    root.querySelector('.layer').appendChild(tick);
    const t = tick;
    setTimeout(() => t.remove(), 800);
  }

  function clear() {
    anchor = null;
    if (badge) badge.textContent = '';
    onLost = null;
    onRect = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!host) return;
    [ring, arrow, bubble, edge].forEach((n) => n.classList.add('hidden'));
    host.dataset.koodeActive = 'false';
    delete host.dataset.koodeTip;
    delete host.dataset.koodeRect;
  }

  function currentAnchor() { return anchor; }

  K.overlay = { point, clear, setText, success, currentAnchor };
})();
