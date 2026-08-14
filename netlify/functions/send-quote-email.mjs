import { Resend } from "resend";
import nodemailer from "nodemailer";

// Sends the generated PDF as an email attachment. Supports two paths,
// auto-selected by which credentials are actually configured -- no code
// change needed to switch between them, just environment variables:
//
//   Path A -- Gmail SMTP (send AS a real Gmail address, e.g.
//   cadcowork@gmail.com): set GMAIL_USER + GMAIL_APP_PASSWORD.
//   Uses Gmail's own mail servers directly via Nodemailer.
//
//   Path B -- Resend (send from a verified custom domain, e.g.
//   jewellery@worldshiner.com): set RESEND_API_KEY (+ optionally
//   RESEND_FROM_ADDRESS once the domain is verified).
//
// If GMAIL_USER/GMAIL_APP_PASSWORD are set, Gmail is used regardless of
// whether Resend is also configured -- Gmail takes priority since it's
// the more direct "send as our own address" path.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { to, subject, message, filenameBase, pdfBase64 } = body;

    if (!to || !pdfBase64 || !filenameBase) {
      return new Response(JSON.stringify({ error: "Missing required fields (to, filenameBase, pdfBase64)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const emailSubject = subject || `Quotation - ${filenameBase}`;
    const emailBody = message || "Please find the attached quotation.";

    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (gmailUser && gmailAppPassword) {
      // ---- Path A: Gmail SMTP ----
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailAppPassword },
      });
      await transporter.sendMail({
        from: `JWY Calculator <${gmailUser}>`,
        to,
        subject: emailSubject,
        text: emailBody,
        attachments: [
          {
            filename: `${filenameBase}.pdf`,
            content: pdfBase64,
            encoding: "base64",
          },
        ],
      });
      return new Response(JSON.stringify({ ok: true, via: "gmail" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (resendApiKey) {
      // ---- Path B: Resend ----
      const resend = new Resend(resendApiKey);
      const fromAddress = process.env.RESEND_FROM_ADDRESS || "JWY Calculator <onboarding@resend.dev>";
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: [to],
        subject: emailSubject,
        text: emailBody,
        attachments: [{ filename: `${filenameBase}.pdf`, content: pdfBase64 }],
      });
      if (error) {
        return new Response(JSON.stringify({ error: error.message || String(error) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, via: "resend", id: data?.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        error:
          "No email credentials configured yet -- set either GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY, in Netlify's environment variables. See netlify/functions/EMAIL_SETUP.md",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
