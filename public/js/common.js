// Shared helpers + header/footer for public pages.
const App = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }

  function toast(msg, type = '') {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
    s ? parseYmd(s).toLocaleDateString('en-IN', opts) : '';
  // Small copy of an uploaded photo for grids and tiles (the server falls back to the full image).
  const thumb = (url) => (/^uploads\/[^/]+$/.test(url || '') ? url.replace('uploads/', 'uploads/thumbs/') : url);
  const money = (n, cur = '₹') => cur + Number(n || 0).toLocaleString('en-IN');

  let settingsPromise;
  const settings = () => (settingsPromise ||= api('api/settings'));

  function slotInfo(s) {
    return {
      first: { name: s.first_half_label, time: s.first_half_time, price: Number(s.price_half) },
      second: { name: s.second_half_label, time: s.second_half_time, price: Number(s.price_half) },
      full: { name: 'Full Day', time: s.full_day_time, price: Number(s.price_full) },
    };
  }

  function renderChrome(active) {
    // Inside the singer app the page is shown without the website header/footer.
    if (window.self !== window.top || new URLSearchParams(location.search).has('embed')) {
      document.body.classList.add('embedded');
      settings().then(fillSettings).catch(() => {});
      return;
    }
    const header = document.getElementById('site-header');
    const footer = document.getElementById('site-footer');
    const links = [
      ['home', './', 'Home'],
      ['book', 'book.html', 'Book a Slot'],
      ['member', 'member.html', 'Membership'],
      ['event', 'event.html', 'Weekly Event'],
      ['events', './#events', 'Upcoming Jams'],
      ['gallery', 'gallery.html', 'Gallery'],
      ['about', 'about.html', 'About Us'],
      ['reviews', './#reviews', 'Reviews'],
    ];
    if (header) {
      header.className = 'site-header';
      header.innerHTML = `
        <div class="wrap header-top">
          <a href="./" class="logo"><img class="logo-mark" src="img/logo-mark.png" alt=""><span><span data-s="studio_name">Studio</span><small>Rehearsal & Jam Studio</small></span></a>
          <form class="header-search" action="book.html">
            <input type="date" name="date" aria-label="Check availability for a date" title="Check availability for a date">
          </form>
          <div class="header-right">
            <a class="header-phone" data-tel>📞 <b data-s="phone"></b></a>
            <button class="theme-toggle" id="themeToggle" aria-label="Switch light / dark theme"></button>
            <a href="book.html" class="btn btn-primary btn-sm">Book Your Slot</a>
          </div>
        </div>
        <nav class="subnav"><div class="wrap">
          ${links.map(([k, href, t]) => `<a href="${href}" class="${k === active ? 'active' : ''}">${t}</a>`).join('')}
          <span class="right"><a href="app.html">📱 Singer App</a><a href="member.html">Member Login</a><a href="book.html#lookup">My Booking</a><a href="admin.html">Studio Admin</a></span>
        </div></nav>`;
      header.querySelector('.header-search input').addEventListener('change', (e) => e.target.form.submit());
      const root = document.documentElement;
      const tbtn = header.querySelector('#themeToggle');
      const paint = () => { tbtn.textContent = root.dataset.theme === 'dark' ? '☀️' : '🌙'; tbtn.title = root.dataset.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'; };
      paint();
      tbtn.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('sb-theme', root.dataset.theme); } catch { /* storage blocked */ }
        paint();
      });
    }
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = `
        <div class="footer-cta"><div class="wrap">
          <span style="font-size:26px">🎶</span>
          <span>Got a gig coming up? Lock your rehearsal slot in under a minute.</span>
          <a href="book.html" class="btn btn-primary">Book Your Slot</a>
        </div></div>
        <div class="wrap footer-grid">
          <div>
            <img class="footer-logo" src="img/logo.png" alt="Demo Studio" width="220" height="131">
            <p data-s="tagline"></p>
            <p>📍 <span data-s="address"></span><br>📞 <a data-tel><span data-s="phone"></span></a><br>✉️ <a data-mail><span data-s="email"></span></a></p>
          </div>
          <div><h4>Explore</h4><ul>${links.map(([, h, t]) => `<li><a href="${h}">${t}</a></li>`).join('')}</ul></div>
          <div><h4>Connect</h4><ul>
            <li><a data-wa target="_blank" rel="noopener">WhatsApp us</a></li>
            <li><a data-link="instagram" target="_blank" rel="noopener">Instagram</a></li>
            <li><a data-link="youtube" target="_blank" rel="noopener">YouTube</a></li>
            <li><a data-link="map_link" target="_blank" rel="noopener">Get directions</a></li>
          </ul></div>
        </div>
        <div class="footer-bottom">© ${new Date().getFullYear()} <span data-s="studio_name"></span>. All rights reserved.</div>`;
    }
    settings().then(fillSettings).catch(() => {});
  }

  function fillSettings(s) {
    document.querySelectorAll('[data-s]').forEach((el) => { el.textContent = s[el.dataset.s] || ''; });
    document.querySelectorAll('[data-tel]').forEach((el) => { el.href = 'tel:' + (s.phone || '').replace(/\s/g, ''); });
    document.querySelectorAll('[data-mail]').forEach((el) => { el.href = 'mailto:' + s.email; });
    document.querySelectorAll('[data-wa]').forEach((el) => { el.href = 'https://wa.me/' + s.whatsapp; });
    document.querySelectorAll('[data-link]').forEach((el) => { el.href = s[el.dataset.link] || '#'; });
    const base = document.title.split('|')[0].trim();
    document.title = base && base !== s.studio_name ? `${base} | ${s.studio_name}` : s.studio_name;
  }

  // Admin-defined section order, plus any section a photo uses that isn't in the list.
  function galleryCategories(s, items = []) {
    const list = String(s.gallery_categories || '').split(',').map((c) => c.trim()).filter(Boolean);
    for (const g of items) if (g.category && !list.includes(g.category)) list.push(g.category);
    return list;
  }

  function lightbox(items, index) {
    let i = index;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    const draw = () => {
      lb.innerHTML = `<button class="close" aria-label="Close">×</button>
        <img src="${esc(items[i].image)}" alt="${esc(items[i].caption)}"><p>${items[i].category ? `<b>${esc(items[i].category)}</b> · ` : ''}${esc(items[i].caption || '')} · ${i + 1}/${items.length}</p>${items[i].credit ? `<p class="lb-credit">${esc(items[i].credit)}</p>` : ''}`;
    };
    draw();
    lb.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG') { i = (i + 1) % items.length; draw(); } else lb.remove();
    });
    const onKey = (e) => {
      if (!document.body.contains(lb)) return document.removeEventListener('keydown', onKey);
      if (e.key === 'Escape') lb.remove();
      if (e.key === 'ArrowRight') { i = (i + 1) % items.length; draw(); }
      if (e.key === 'ArrowLeft') { i = (i - 1 + items.length) % items.length; draw(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(lb);
  }

  // UPI payment links. GPay opens directly (tez:// on Android, gpay:// on iPhone); "any UPI app" lets the phone choose.
  // On a computer these links can't open an app, so pages show the QR to scan instead.
  function upiLinks({ pa, pn, am, tn }) {
    const q = new URLSearchParams({ pa, pn, cu: 'INR', ...(am ? { am: String(am) } : {}), ...(tn ? { tn } : {}) }).toString().replace(/\+/g, '%20');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const mobile = ios || /android/i.test(navigator.userAgent);
    return { gpay: (ios ? 'gpay://upi/pay?' : 'tez://upi/pay?') + q, any: 'upi://pay?' + q, mobile };
  }

  return { upiLinks, esc, api, toast, ymd, parseYmd, fmtDate, thumb, money, settings, slotInfo, renderChrome, lightbox, galleryCategories, pad };
})();

// Eye button on every password / PIN field to show what's being typed.
// Call App.eyes(root) after adding password fields to the page.
App.eyes = function passwordEyes(root = document) {
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  root.querySelectorAll('input[type=password]:not([data-eye])').forEach((input) => {
    input.dataset.eye = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    const set = (show) => {
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
    };
    set(false);
    btn.addEventListener('click', () => { set(input.type === 'password'); input.focus(); });
    // Hide again once the form is sent, so it isn't left visible on screen.
    if (input.form) input.form.addEventListener('submit', () => set(false));
    wrap.appendChild(btn);
  });
};
App.eyes();
