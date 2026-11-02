App.renderChrome('home');

const GRADIENTS = [
  'linear-gradient(120deg,#2b1055,#d53369)',
  'linear-gradient(120deg,#0f2027,#2c5364)',
  'linear-gradient(120deg,#42275a,#734b6d)',
  'linear-gradient(120deg,#1f4037,#99f2c8)',
];
const bg = (img, i) => (img ? `url('${App.esc(img)}') center/cover, ${GRADIENTS[i % GRADIENTS.length]}` : GRADIENTS[i % GRADIENTS.length]);

(async function init() {
  const [s, banners, gallery, testimonials] = await Promise.all([
    App.settings(), App.api('api/banners'), App.api('api/gallery'), App.api('api/testimonials'),
  ]);
  renderCarousel(banners, s);
  renderSlots(s);
  renderPosters(banners);
  renderGallery(gallery, s);
  renderTestimonials(testimonials);
})().catch((e) => App.toast(e.message, 'error'));

function renderCarousel(banners, s) {
  const track = document.getElementById('track');
  const dots = document.getElementById('dots');
  const slides = banners.length ? banners : [{ title: s.studio_name, subtitle: s.tagline, cta_text: 'Book Your Slot', cta_link: 'book.html' }];
  // Banners are shown as a row of equal-height tiles. Uploaded posters keep their own aspect ratio
  // (never cropped); banners without an image become a text tile.
  track.innerHTML = slides.map((b, i) => b.image ? `
    <a class="slide slide-poster" href="${App.esc(b.cta_link || 'book.html')}">
      <img src="${App.esc(b.image)}" alt="${App.esc(b.title)}${b.subtitle ? ' – ' + App.esc(b.subtitle) : ''}">
    </a>` : `
    <div class="slide slide-text" style="background:${bg(null, i)}">
      <div class="slide-content">
        <span class="slide-tag">${b.event_date ? '📅 ' + App.fmtDate(b.event_date, { day: 'numeric', month: 'short' }) : 'Featured'}</span>
        <h2>${App.esc(b.title)}</h2>
        ${b.subtitle ? `<p>${App.esc(b.subtitle)}</p>` : ''}
        ${b.cta_text ? `<a href="${App.esc(b.cta_link || 'book.html')}" class="btn btn-primary">${App.esc(b.cta_text)}</a>` : ''}
      </div>
    </div>`).join('');
  dots.innerHTML = slides.map((_, i) => `<button aria-label="Banner ${i + 1}" data-i="${i}"></button>`).join('');

  // Infinite loop: three copies of the slides; we always sit in the middle copy and
  // silently jump by one copy-length after a transition crosses into the outer copies.
  const n = slides.length;
  const originals = track.innerHTML;
  if (n > 1) track.innerHTML = originals + originals + originals;
  const items = [...track.children];
  let pos = n > 1 ? n : 0, timer;

  const place = (animate) => {
    const el = items[pos];
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const x = pos * (el.offsetWidth + gap) - (track.parentElement.clientWidth - el.offsetWidth) / 2;
    track.style.transition = animate ? 'transform .6s cubic-bezier(.4,0,.2,1)' : 'none';
    track.style.transform = `translateX(${-x}px)`;
    items.forEach((s, j) => s.classList.toggle('active', j === pos));
    dots.querySelectorAll('button').forEach((d, j) => d.classList.toggle('on', j === pos % n));
  };
  track.addEventListener('transitionend', (e) => {
    if (e.target !== track) return;
    if (pos >= 2 * n) { pos -= n; place(false); }
    else if (pos < n) { pos += n; place(false); }
  });
  // Snap back into the middle copy if a transitionend was missed (e.g. tab was in the background).
  const normalize = () => {
    if (n < 2 || (pos >= n && pos < 2 * n)) return;
    pos = n + (((pos - n) % n) + n) % n;
    place(false);
    void track.offsetWidth; // flush so the next move animates from the snapped position
  };
  const step = (d) => { normalize(); pos += d; place(true); };
  const goTo = (i) => { normalize(); pos = n + i; place(true); };
  const restart = () => { clearInterval(timer); if (n > 1) timer = setInterval(() => step(1), 2000); };

  document.querySelector('.carousel-btn.prev').onclick = () => { step(-1); restart(); };
  document.querySelector('.carousel-btn.next').onclick = () => { step(1); restart(); };
  dots.onclick = (e) => { if (e.target.dataset.i) { goTo(Number(e.target.dataset.i)); restart(); } };

  // Swipe on touch screens
  let startX = null;
  track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; clearInterval(timer); }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    startX = null;
    restart();
  });

  window.addEventListener('resize', () => place(false));
  track.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => place(false), { once: true }));
  if (n < 2) document.querySelectorAll('.carousel-btn, #dots').forEach((el) => el.classList.add('hidden'));
  place(false);
  restart();
}

function renderSlots(s) {
  const info = App.slotInfo(s);
  const card = (key, extra = '') => `
    <div class="slot-card ${extra}">
      <h3>${App.esc(info[key].name)}</h3>
      <div class="time">🕘 ${App.esc(info[key].time)}</div>
      <div class="price">${App.money(info[key].price, s.currency)} <small>/ session</small></div>
      <div class="muted" style="font-size:14px;margin-bottom:12px">${key === 'full'
        ? 'Best for music meets, workshops, celebrations & pre-production.'
        : 'Perfect for band rehearsals and jamming sessions.'}</div>
      <a href="book.html?slot=${key}" class="btn ${key === 'full' ? 'btn-primary' : 'btn-outline'}">Book ${App.esc(info[key].name)}</a>
    </div>`;
  document.getElementById('slotCards').innerHTML = card('first') + card('second') + card('full', 'featured');
}

function renderPosters(banners) {
  const today = App.ymd(new Date());
  const events = banners.filter((b) => b.event_date && b.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const el = document.getElementById('posters');
  if (!events.length) {
    el.innerHTML = '<p class="muted">No public sessions announced yet – why not host your own? <a href="book.html" style="color:var(--accent)">Book a slot</a>.</p>';
    return;
  }
  el.innerHTML = events.map((b, i) => `
    <a class="poster" href="${App.esc(b.cta_link || 'book.html')}">
      <div class="poster-img" style="background:${bg(App.thumb(b.image), i)}"></div>
      <div class="poster-when">📅 ${App.fmtDate(b.event_date)}</div>
      <h4>${App.esc(b.title)}</h4>
      <p>${App.esc(b.subtitle || '')}</p>
    </a>`).join('');
}

// One tile per gallery section (cover = its first photo), linking to that section of the gallery page.
function renderGallery(items, s) {
  const el = document.getElementById('galleryPreview');
  const cats = App.galleryCategories(s, items).filter((c) => items.some((g) => g.category === c));
  el.innerHTML = cats.map((c) => {
    const photos = items.filter((g) => g.category === c);
    return `<a class="gallery-item cat-tile" href="gallery.html#${encodeURIComponent(c)}" style="background-image:url('${App.esc(App.thumb(photos[0].image))}')">
      <span><b>${App.esc(c)}</b><small>${photos.length} photo${photos.length === 1 ? '' : 's'} →</small></span></a>`;
  }).join('') || '<p class="muted">Photos coming soon.</p>';
}

function renderTestimonials(list) {
  const el = document.getElementById('testimonials');
  el.innerHTML = list.map((t) => `
    <div class="testi">
      <div class="stars">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div>
      <p>${App.esc(t.message)}</p>
      <div class="who"><div class="avatar">${App.esc(t.name.charAt(0).toUpperCase())}</div>
        <div><b>${App.esc(t.name)}</b><small>${App.esc(t.band || '')}</small></div></div>
    </div>`).join('') || '<p class="muted">Be the first to leave a review!</p>';
}

document.getElementById('writeReview').addEventListener('click', (e) => {
  e.preventDefault();
  const bgEl = document.createElement('div');
  bgEl.className = 'modal-bg';
  bgEl.innerHTML = `
    <form class="modal">
      <div class="modal-head"><h3>Share your experience</h3><button type="button" data-close>×</button></div>
      <div class="modal-body form-grid">
        <div class="field"><label>Your name <span class="req">*</span></label><input name="name" required maxlength="80"></div>
        <div class="field"><label>Band / Group</label><input name="band" maxlength="80"></div>
        <div class="field full"><label>Rating</label>
          <select name="rating"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Great</option><option value="3">★★★ Good</option><option value="2">★★ Fair</option><option value="1">★ Poor</option></select></div>
        <div class="field full"><label>Your review <span class="req">*</span></label><textarea name="message" required minlength="10" maxlength="600"></textarea></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">Submit review</button></div>
    </form>`;
  document.body.appendChild(bgEl);
  bgEl.addEventListener('click', (ev) => { if (ev.target === bgEl || ev.target.hasAttribute('data-close')) bgEl.remove(); });
  bgEl.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await App.api('api/testimonials', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
      bgEl.remove();
      App.toast('Thank you! Your review will appear once approved.', 'ok');
    } catch (err) { App.toast(err.message, 'error'); }
  });
});
