import { neon } from '@neondatabase/serverless';

// חותך רווחים, מגביל אורך, ומחזיר null אם ריק
const clean = (value, max) => {
  if (value == null) return null;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed === '' ? null : trimmed;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    if (!name || !phone) {
      return res.status(400).json({ error: 'שם וטלפון הם שדות חובה' });
    }

    // תאריך ריק חייב להיות null, אחרת Postgres נכשל בהמרה
    const weddingDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date : null;

    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`
      INSERT INTO leads (name, partner, phone, wedding_date, package, message, user_agent)
      VALUES (
        ${name},
        ${clean(body.partner, 120)},
        ${phone},
        ${weddingDate},
        ${clean(body.package, 120)},
        ${clean(body.message, 2000)},
        ${clean(req.headers['user-agent'], 400)}
      )
      RETURNING id, created_at`;

    return res.status(200).json({ ok: true, id: String(row.id) });
  } catch (err) {
    console.error('lead insert failed:', err);
    return res.status(500).json({ error: 'השמירה נכשלה, נסו שוב' });
  }
}
