// Email notifications. If SMTP is not configured, messages are logged to the console instead.
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

// Returns true when the email was handed to the mail server.
async function sendMail({ to, subject, html }) {
  if (!to) return false;
  if (!transporter) {
    console.log(`\n[mail:not-configured] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return false;
  }
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
    return true;
  } catch (err) {
    console.error('[mail] failed to send:', err.message);
    return false;
  }
}
const mailReady = () => !!transporter;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function bookingTable(b, slotText, currency) {
  return `
    <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr><td><b>Booking ID</b></td><td>${esc(b.ref)}</td></tr>
      <tr><td><b>Date</b></td><td>${esc(b.date)}</td></tr>
      <tr><td><b>Slot</b></td><td>${esc(slotText)}</td></tr>
      <tr><td><b>Name</b></td><td>${esc(b.name)} (${esc(b.group_type)})</td></tr>
      <tr><td><b>Phone</b></td><td>${esc(b.phone)}</td></tr>
      <tr><td><b>Email</b></td><td>${esc(b.email)}</td></tr>
      ${b.event_type ? `<tr><td><b>Event</b></td><td>${esc(b.event_type)}</td></tr>` : ''}
      ${b.attendees ? `<tr><td><b>Attendees</b></td><td>${esc(b.attendees)}</td></tr>` : ''}
      ${b.notes ? `<tr><td><b>Notes</b></td><td>${esc(b.notes)}</td></tr>` : ''}
      <tr><td><b>Amount</b></td><td>${esc(currency)}${esc(b.amount)}</td></tr>
      <tr><td><b>Status</b></td><td>${esc(b.status)}</td></tr>
    </table>`;
}

module.exports = { sendMail, mailReady, bookingTable, esc };
