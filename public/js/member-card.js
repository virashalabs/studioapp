// Membership card: black matte with gold lettering. Rendered as HTML for the page and drawn on a canvas for download.
const MemberCard = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const validThru = (d) => (d ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
  const spacedNo = (no) => String(no || '').replace(/^([A-Z]+)(\d+)$/, '$1 $2');

  function html(m, studio) {
    return `<div class="mcard" role="img" aria-label="${esc(studio)} membership card for ${esc(m.name)}, ${esc(m.plan_name)} membership, number ${esc(m.member_no)}">
      <div class="mcard-sheen"></div>
      <div class="mcard-top">
        <div><div class="mcard-brand gold">${esc(studio)}</div><div class="mcard-title gold">Membership Card</div></div>
        <div class="mcard-emblem gold" aria-hidden="true">♫</div>
      </div>
      <div class="mcard-no gold">${esc(spacedNo(m.member_no))}</div>
      <div class="mcard-bottom">
        <div class="mcard-name"><small>Member</small><b class="gold">${esc(m.name)}</b></div>
        <div><small>Membership</small><b class="gold">${esc(m.plan_name)}</b></div>
        <div><small>Valid thru</small><b class="gold">${esc(validThru(m.valid_until))}</b></div>
      </div>
    </div>`;
  }

  // Same design at 2x credit-card size, as a PNG the singer can save or share.
  async function download(m, studio) {
    const W = 1012, H = 638, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    try { await Promise.all(['700 40px Cinzel', '500 30px Cinzel', '500 20px Roboto'].map((f) => document.fonts.load(f))); } catch { /* use fallbacks */ }
    const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    // Matte black base with a soft sheen
    round(0, 0, W, H, 36); g.fillStyle = '#0c0c0d'; g.fill(); g.save(); g.clip();
    const sheen = g.createRadialGradient(W * 0.2, -H * 0.2, 0, W * 0.2, -H * 0.2, W * 0.9);
    sheen.addColorStop(0, 'rgba(255,255,255,.09)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }
    g.restore();
    const gold = (y0, y1) => {
      const gr = g.createLinearGradient(0, y0, W * 0.6, y1);
      gr.addColorStop(0, '#c89a3e'); gr.addColorStop(0.35, '#f9e6a8'); gr.addColorStop(0.6, '#ddb45c'); gr.addColorStop(1, '#a87d30');
      return gr;
    };
    g.strokeStyle = gold(0, H); g.lineWidth = 2; round(22, 22, W - 44, H - 44, 24); g.stroke();
    const text = (t, x, y, font, align = 'left', spacing = 0) => {
      g.font = font; g.textAlign = align; g.fillStyle = gold(y - 40, y);
      if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
      g.fillText(t, x, y);
    };
    const label = (t, x, y, align = 'left') => {
      g.font = '500 17px Roboto, Arial, sans-serif'; g.textAlign = align; g.fillStyle = 'rgba(232,210,150,.55)';
      if ('letterSpacing' in g) g.letterSpacing = '3px';
      g.fillText(t.toUpperCase(), x, y);
    };
    text(String(studio).toUpperCase(), 64, 108, '700 40px Cinzel, Georgia, serif', 'left', 3);
    text('MEMBERSHIP CARD', 64, 150, '500 24px Cinzel, Georgia, serif', 'left', 8);
    text('♫', W - 64, 118, '400 64px Georgia, serif', 'right');
    text(spacedNo(m.member_no), 64, 360, '700 76px Cinzel, Georgia, serif', 'left', 10);
    // Long names shrink to fit before the Membership column.
    let size = 36;
    const name = String(m.name).toUpperCase();
    do { g.font = `700 ${size}px Cinzel, Georgia, serif`; if ('letterSpacing' in g) g.letterSpacing = '2px'; } while (g.measureText(name).width > 540 && --size > 18);
    label('Member', 64, 500); text(name, 64, 548, `700 ${size}px Cinzel, Georgia, serif`, 'left', 2);
    label('Membership', 640, 500); text(String(m.plan_name).toUpperCase(), 640, 548, '700 32px Cinzel, Georgia, serif', 'left', 2);
    label('Valid thru', W - 64, 500, 'right'); text(validThru(m.valid_until), W - 64, 548, '700 32px Cinzel, Georgia, serif', 'right', 2);
    const a = document.createElement('a');
    a.download = `${m.member_no}-membership-card.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  return { html, download };
})();
