import { neon } from '@neondatabase/serverless';
import { checkBotId } from 'botid/server';
import { sendLeadEmail } from './_notify.js';

// חותך רווחים, מגביל אורך, ומחזיר null אם ריק
const clean = (value, max) => {
  if (value == null) return null;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed === '' ? null : trimmed;
};

// מפרק מספר טלפון ישראלי לכל הצורות השימושיות
function enrichPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');

  let international = null;
  if (/^0\d{9}$/.test(digits)) {
    international = '+972' + digits.slice(1);          // 0501234567
  } else if (/^972\d{9}$/.test(digits)) {
    international = '+' + digits;                       // 972501234567
  } else if (/^0\d{8}$/.test(digits)) {
    international = '+972' + digits.slice(1);          // קווי ישן, 9 ספרות
  }

  const bare = international ? international.replace('+', '') : null;
  const isMobile = /^0(5\d)\d{7}$/.test(digits) || /^9725\d{8}$/.test(digits);

  return {
    raw: String(raw),
    digits,
    international,
    is_valid: Boolean(international),
    is_mobile: isMobile,
    tel_link: international ? `tel:${international}` : null,
    whatsapp_link: bare ? `https://wa.me/${bare}` : null
  };
}

// שולח ל-Make. לעולם לא זורק שגיאה - ליד שנשמר לא ייכשל בגלל webhook
async function sendToWebhook(payload) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) {
    console.warn('MAKE_WEBHOOK_URL לא מוגדר - דילוג על webhook');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      console.error('webhook החזיר סטטוס', r.status);
      return { sent: false, reason: `status_${r.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('webhook נכשל:', err.message);
    return { sent: false, reason: err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // BotID ברמת Basic - חינמית, לא מפעילה חיובי Deep Analysis
    const verification = await checkBotId({
      advancedOptions: {
        checkLevel: 'basic',
        headers: req.headers
      }
    });

    if (verification.isBot) {
      return res.status(403).json({ error: 'הבקשה נחסמה' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    if (!name || !phone) {
      return res.status(400).json({ error: 'שם וטלפון הם שדות חובה' });
    }

    const partner = clean(body.partner, 120);
    const pkg = clean(body.package, 120);
    const message = clean(body.message, 2000);
    const userAgent = clean(req.headers['user-agent'], 400);

    // תאריך ריק חייב להיות null, אחרת Postgres נכשל בהמרה
    const weddingDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date : null;

    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`
      INSERT INTO leads (name, partner, phone, wedding_date, package, message, user_agent)
      VALUES (${name}, ${partner}, ${phone}, ${weddingDate}, ${pkg}, ${message}, ${userAgent})
      RETURNING id, created_at`;

    // ==== payload מועשר ל-Make ====
    const phoneInfo = enrichPhone(phone);
    const daysUntil = weddingDate
      ? Math.round((new Date(weddingDate + 'T00:00:00Z') - new Date(row.created_at)) / 86400000)
      : null;

    const country = req.headers['x-vercel-ip-country'] ?? null;
    const city = req.headers['x-vercel-ip-city']
      ? decodeURIComponent(req.headers['x-vercel-ip-city'])
      : null;

    const lead = {
      lead_id: String(row.id),
      created_at: new Date(row.created_at).toISOString(),
      name,
      partner,
      couple: partner ? `${name} & ${partner}` : name,
      phone: phoneInfo.raw,
      phone_international: phoneInfo.international,
      phone_digits: phoneInfo.digits,
      phone_is_valid: phoneInfo.is_valid,
      phone_is_mobile: phoneInfo.is_mobile,
      tel_link: phoneInfo.tel_link,
      whatsapp_link: phoneInfo.whatsapp_link,
      wedding_date: weddingDate,
      days_until_wedding: daysUntil,
      package: pkg,
      message,
      country,
      city
    };

    // Make ומייל רצים במקביל - אף אחד מהם לא יכול להפיל את השני
    const [webhookResult, emailResult] = await Promise.all([
      sendToWebhook({
        ...lead,
        source: {
          site: 'אימג׳11 - דף נחיתה',
          referrer: clean(req.headers['referer'], 300),
          user_agent: userAgent,
          country,
          city
        }
      }),
      sendLeadEmail(lead)
    ]);

    return res.status(200).json({
      ok: true,
      id: String(row.id),
      notified: webhookResult.sent,
      emailed: emailResult.sent
    });
  } catch (err) {
    console.error('lead insert failed:', err);
    return res.status(500).json({ error: 'השמירה נכשלה, נסו שוב' });
  }
}
