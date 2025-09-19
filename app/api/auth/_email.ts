// app/api/auth/_email.ts
// Works with Postmark (preferred) or generic SMTP via Nodemailer.
// Runtime must be Node.js (not Edge) in the route that calls this.

const APP_URL = process.env.APP_URL || "https://recurio-notion.vercel.app";
const FROM = process.env.EMAIL_FROM || "Recurio <noreply@recurio.app>";

/** POSTMARK (first choice) */
let postmarkClient: any = null;
if (process.env.POSTMARK_API_TOKEN) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ServerClient } = require("postmark");
  postmarkClient = new ServerClient(process.env.POSTMARK_API_TOKEN);
}

/** SMTP via Nodemailer (fallback) */
let smtpTransport: any = null;
if (process.env.SMTP_HOST) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require("nodemailer");
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendOtpEmail(to: string, code: string) {
  const subject = "Your Recurio sign-in code";
  const text =
    `Your code: ${code}\n` +
    `This code expires in 10 minutes.\n\n` +
    `Open ${APP_URL} and paste it to sign in.`;

  try {
    if (postmarkClient) {
      await postmarkClient.sendEmail({
        From: FROM,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: process.env.POSTMARK_STREAM || "outbound",
      });
      return true;
    }
    if (smtpTransport) {
      await smtpTransport.sendMail({ from: FROM, to, subject, text });
      return true;
    }
  } catch {
    // swallow and report failure to caller
  }
  return false; // not configured or failed → caller can still show code if allowed
}