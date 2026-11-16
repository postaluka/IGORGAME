// Спільна таблиця рекордів гри «ІГОР» (серверна функція Vercel).
// Дані лежать в Upstash Redis: для кожного рівня окремий sorted set, де оцінка — час у секундах.
// Ключі доступу Vercel додає сам, коли базу підключено до проєкту (Storage → Upstash Redis).
//
// GET  /api/records            → { easy: [...], normal: [...], hard: [...], hell: [...] }
// POST /api/records {level, name, time} → { ok: true, id, list: [...топ рівня] }

const LEVELS = ["easy", "normal", "hard", "hell"];
const MAX_RECORDS = 10;
const MIN_TIME = 0.5;     // швидше чотирьох влучних кліків людина не встигне
const MAX_TIME = 600;
const POSTS_PER_MINUTE = 10;

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const key = (level) => `igor:records:${level}`;

async function redis(commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

/** [member, score, member, score, …] → [{name, time, date, id}] */
function parseRange(flat) {
  const list = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const m = JSON.parse(flat[i]);
      list.push({ name: String(m.name), date: m.date, id: m.id, time: Number(flat[i + 1]) });
    } catch { /* пропускаємо зіпсований запис */ }
  }
  return list;
}

const top = (level) => ["ZRANGE", key(level), "0", String(MAX_RECORDS - 1), "WITHSCORES"];

function cleanName(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "База не підключена" });

  try {
    if (req.method === "GET") {
      const results = await redis(LEVELS.map(top));
      const data = {};
      LEVELS.forEach((l, i) => { data[l] = parseRange(results[i] || []); });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const level = body.level;
      const name = cleanName(body.name);
      const time = Math.round(Number(body.time) * 100) / 100;
      if (!LEVELS.includes(level)) return res.status(400).json({ error: "Невідомий рівень" });
      if (!name) return res.status(400).json({ error: "Порожнє ім'я" });
      if (!Number.isFinite(time) || time < MIN_TIME || time > MAX_TIME) {
        return res.status(400).json({ error: "Неможливий час" });
      }

      // Простий захист від спаму: не більше N записів на хвилину з однієї адреси
      const ip = String(req.headers["x-forwarded-for"] || "anon").split(",")[0].trim();
      const rateKey = `igor:rate:${ip}`;
      const [count] = await redis([["INCR", rateKey], ["EXPIRE", rateKey, "60", "NX"]]);
      if (count > POSTS_PER_MINUTE) return res.status(429).json({ error: "Забагато спроб, зачекай хвилину" });

      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      const member = JSON.stringify({ name, date: new Date().toISOString(), id });
      const results = await redis([
        ["ZADD", key(level), String(time), member],
        ["ZREMRANGEBYRANK", key(level), String(MAX_RECORDS), "-1"],
        top(level),
      ]);
      const list = parseRange(results[2] || []);
      return res.status(200).json({ ok: true, id, list, inTop: list.some((r) => r.id === id) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Метод не підтримується" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Помилка сервера" });
  }
};
