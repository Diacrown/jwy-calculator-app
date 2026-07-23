import { Resend } from "resend";

// Sends the generated PDF as an email attachment via Resend. Requires
// the RESEND_API_KEY environment variable to be set in Netlify (see
// README.md in this folder for the one-time setup steps). Never throws
// into the app in a way that blocks the local download -- the calling
// code in JwyCalculator.jsx treats this as best-effort, same pattern as
// the cloud archive step.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY is not configured on this site yet -- see netlify/functions/README.md" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const { to, subject, message, html, filenameBase, pdfBase64 } = body;

    if (!to || !pdfBase64 || !filenameBase) {
      return new Response(JSON.stringify({ error: "Missing required fields (to, filenameBase, pdfBase64)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(apiKey);
    const fromAddress = process.env.RESEND_FROM_ADDRESS || "JWY Calculator <onboarding@resend.dev>";

    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: subject || `Quotation - ${filenameBase}`,
      // Both are sent when available: html renders in modern email clients,
      // text is the plain-text fallback for anything that can't render HTML.
      text: message || "Please find the attached quotation.",
      html: html || undefined,
      attachments: [
        {
          filename: `${filenameBase}.pdf`,
          content: pdfBase64, // Resend accepts a base64 string directly here
        },
      ],
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message || String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
