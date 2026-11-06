# Studio Booking Management System

Self-service booking website for a rehearsal / jam studio, with an admin dashboard.
UI inspired by BookMyShow (white header, red accent, poster cards, date strip, showtime-style slot buttons).

## Run it

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, so no database server is needed).

```bash
npm install
npm start          # or: npm run dev   (auto-restarts on code changes)
```

- Website: http://localhost:3000
- Admin:   http://localhost:3000/admin.html  (default password **admin123**; change it under Settings)

Data is stored in `data/studio.db`; uploaded images go in `public/uploads/`. Back up both.
Copy `.env.example` to `.env` to configure email, port and admin password.

## Pages

| Page | What it does |
|---|---|
| `/` Home | Promo banner carousel, "Book Your Slot" call-to-action, slot pricing, upcoming jam sessions, gallery preview, testimonials (+ "Write a review") |
| `/about.html` | About text, contact card, studio attractions |
| `/gallery.html` | Photo grid with lightbox |
| `/book.html` | Date strip + colour-coded month calendar → First Half / Second Half / Full Day → booking form → confirmation with Booking ID. Also "check my booking status". |
| `/admin.html` | Dashboard, Bookings, Calendar & Free Dates, Revenue, Banners, Gallery, Testimonials, Settings |

### Calendar colours
Green = available · amber top half = first half booked · blue bottom half = second half booked · red = full day booked · grey = past / outside booking window.

### Booking rules
- A booking holds its slot immediately as **pending**; the studio **approves** or **cancels** it from the admin.
  Cancelled bookings free the slot again.
- Full day blocks both halves; a half-day booking blocks Full Day for that date.
  Double-booking is prevented on the server, even if two people book at the same moment.
- Price is taken from Settings (half-day / full-day) and can be edited per booking in the admin.
- Admin can add walk-in / phone bookings (approved immediately) from Bookings or by clicking a free date in the calendar.

### Notifications
- New booking → notification bell in the admin (with sound; polls every 20 s) + email to the owner.
- Approve / cancel → email to the customer.
- Emails need SMTP settings in `.env`; otherwise they're printed in the server console.

### Revenue
Revenue = approved bookings (by session date). Mark bookings **paid** to track collected vs outstanding.
Pending bookings are shown separately as "pipeline".

### Singer membership
- **Plans** (Admin → Members → *Membership plans & pricing*): separate tariffs for male singers (Budget 20 songs ₹1500 / Economy 30 ₹2500 / Premium 40 ₹3500 / Unlimited ₹4000) and female singers (Budget 20 ₹1000 / Economy 25 ₹1500 / Standard 35 ₹2500 / Premium 50 ₹3000 / Elite 100 ₹4000), each with a monthly song limit and price.
- **Monthly fee** must be paid before the 10th (configurable); from the 10th an unpaid fee is overdue. Admin marks each month paid; paying a month extends validity to its end. Overdue fees show to the admin and the singer; after an upgrade the price difference shows as a balance.
- **Members** get a number `RRS` + 4 digits and a black-and-gold membership card (shown on screen, downloadable as PNG).
- **Songs** are logged by the studio (Admin → Members → *+ Songs*, one song per line, optionally `Song – Movie`). Counts reset each calendar month; records older than 12 months are deleted automatically.
- **Over the limit:** the admin is prompted to upgrade the singer when logging songs, and the singer sees an upgrade prompt and can send an upgrade request from their page.
- **Singer login** (`member.html`): member number + PIN (default PIN = last 4 digits of the phone). Singers can see their card, monthly usage and song history, and edit their contact details.
- **Demo data:** six demo singers (RRS1001–RRS1006, PIN `1234`) are created on a fresh start, with songs dated around the current month.

## Project layout

```
server.js          Express API + static hosting
db.js              SQLite schema, default settings & sample content
mailer.js          Email (nodemailer) helper
public/            Website (plain HTML/CSS/JS, no build step)
  css/style.css    Site theme      css/admin.css  Admin theme
  js/common.js     Shared helpers, header & footer
  js/home.js  js/book.js  js/admin.js
```

## Going live
Run it on any host with Node.js (a small VPS, Render, Railway, etc.) behind HTTPS, set `SESSION_SECRET`
and SMTP in `.env`, and change the admin password. Make sure `data/` and `public/uploads/` are on persistent storage.

### Hosting under a sub-path (e.g. `virashalabs.online/studioapp`)
Set `BASE_PATH=/studioapp` in `.env`. The app then serves everything under that path (and redirects
`/studioapp` to `/studioapp/`). The reverse proxy must pass the path through unchanged, e.g. Caddy:

```
virashalabs.online {
    handle /studioapp* {
        reverse_proxy localhost:3000
    }
}
```

All links in the pages are relative, so the same code also works at the site root with `BASE_PATH` empty.
Image paths and banner links saved in the admin should be relative too (`book.html`, not `/book.html`).
