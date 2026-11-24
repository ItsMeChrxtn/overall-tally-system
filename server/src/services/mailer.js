import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
if (env.smtp.host) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
}

/** Sends an email, or prints it to the console when SMTP is not configured (development). */
export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n[mail:dev] ${text}\n`);
    return { delivered: false };
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
  return { delivered: true };
}
