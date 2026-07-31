// שליחת התראת מייל על ליד חדש, דרך Resend.
// לעולם לא זורק שגיאה - ליד שנשמר לא ייכשל בגלל מייל.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const row = (label, value) => {
  if (value == null || value === '') return '';
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#777;font-size:13px;white-space:nowrap">${esc(label)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#111;font-size:15px;font-weight:500">${value}</td>
  </tr>`;
};

function buildHtml(lead) {
  const urgency =
    lead.days_until_wedding == null
      ? ''
      : lead.days_until_wedding < 90
      ? ' ⚠️ פחות מ-3 חודשים'
      : '';

  return `<div dir="rtl" style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#f7f3ec;padding:28px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)">
    <div style="background:#12100e;padding:22px 24px">
      <div style="color:#d4b483;font-size:12px;letter-spacing:2px">אימג׳11 · ליד חדש מהאתר</div>
      <div style="color:#fff;font-size:24px;margin-top:6px;font-weight:600">${esc(lead.couple)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${row('טלפון', `<a href="${esc(lead.tel_link)}" style="color:#b08d57;text-decoration:none">${esc(lead.phone)}</a>`)}
      ${row('תאריך חתונה', esc(lead.wedding_date) + (urgency ? `<span style="color:#c0392b;font-size:13px">${urgency}</span>` : ''))}
      ${row('ימים לחתונה', lead.days_until_wedding)}
      ${row('חבילה', esc(lead.package))}
      ${row('הודעה', esc(lead.message))}
      ${row('מיקום', esc([lead.city, lead.country].filter(Boolean).join(', ')))}
      ${row('מזהה ליד', esc(lead.lead_id))}
    </table>
    ${
      lead.whatsapp_link
        ? `<div style="padding:22px 24px;text-align:center">
             <a href="${esc(lead.whatsapp_link)}" style="display:inline-block;background:#25D366;color:#fff;padding:13px 30px;border-radius:4px;text-decoration:none;font-weight:600;font-size:15px">פתח וואטסאפ ←</a>
             <a href="${esc(lead.tel_link)}" style="display:inline-block;background:#12100e;color:#fff;padding:13px 30px;border-radius:4px;text-decoration:none;font-weight:600;font-size:15px;margin-right:8px">חייג</a>
           </div>`
        : ''
    }
    <div style="padding:14px 24px;background:#faf8f4;color:#999;font-size:12px;text-align:center">
      נשלח אוטומטית מדף הנחיתה
    </div>
  </div>
</div>`;
}

export async function sendLeadEmail(lead) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL;

  if (!apiKey || !to) {
    console.warn('RESEND_API_KEY או LEAD_NOTIFY_EMAIL חסרים - דילוג על מייל');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'אימג׳11 <onboarding@resend.dev>',
        to: [to],
        subject: `ליד חדש: ${lead.couple} · ${lead.phone}`,
        html: buildHtml(lead)
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('Resend נכשל, סטטוס', res.status, detail.slice(0, 300));
      return { sent: false, reason: `status_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('שליחת מייל נכשלה:', err.message);
    return { sent: false, reason: err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}
