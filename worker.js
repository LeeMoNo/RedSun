export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    // ── GET /search?q=食べる ──────────────────────────────
    if (request.method === 'GET' && url.pathname === '/search') {
      const q = url.searchParams.get('q')?.trim();
      if (!q) return res({ error: 'missing q' }, 400, headers);

      const like = `%${q}%`;
      const { results } = await env.DB.prepare(`
        SELECT * FROM entries
        WHERE word LIKE ? OR reading LIKE ? OR zh_cn LIKE ?
        ORDER BY frequency ASC LIMIT 20
      `).bind(like, like, like).all();

      if (results.length === 0) {
        await env.DB.prepare(`
          INSERT INTO missing_words (query, count, last_at) VALUES (?, 1, datetime('now'))
          ON CONFLICT(query) DO UPDATE SET count = count + 1, last_at = datetime('now')
        `).bind(q).run();
      }

      return res({ results }, 200, headers);
    }

    // ── GET /entries?jlpt=N5&pos=动词&page=1&limit=10 ────
    // 支持字段：jlpt / pos / frequency / verified
    if (request.method === 'GET' && url.pathname === '/entries') {
      const page  = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '10'));
      const offset = (page - 1) * limit;

      const allowed = ['jlpt', 'pos', 'frequency', 'verified'];
      const filters = [];
      const binds   = [];

      for (const field of allowed) {
        const val = url.searchParams.get(field);
        if (val !== null) { filters.push(`${field} = ?`); binds.push(val); }
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const { results } = await env.DB.prepare(
        `SELECT * FROM entries ${where} ORDER BY jlpt, frequency LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      const total = (await env.DB.prepare(
        `SELECT COUNT(*) as n FROM entries ${where}`
      ).bind(...binds).first()).n;

      return res({ page, limit, total, pages: Math.ceil(total / limit), results }, 200, headers);
    }

    // ── PATCH /entry/:id  编辑词条 ────────────────────────
    const matchId = url.pathname.match(/^\/entry\/(\d+)$/);
    if (request.method === 'PATCH' && matchId) {
      if (request.headers.get('X-Admin-Key') !== env.ADMIN_KEY)
        return res({ error: 'unauthorized' }, 401, headers);

      const body = await request.json();
      const fields = ['word','reading','tone','zh_cn','pos','jlpt',
                      'frequency','example_jp','example_zh','verified'];
      const updates = Object.keys(body).filter(k => fields.includes(k));
      if (!updates.length) return res({ error: 'no valid fields' }, 400, headers);

      await env.DB.prepare(
        `UPDATE entries SET ${updates.map(k => `${k}=?`).join(', ')} WHERE id = ?`
      ).bind(...updates.map(k => body[k]), matchId[1]).run();

      return res({ ok: true }, 200, headers);
    }

    // ── POST /entry  新增词条 ─────────────────────────────
    if (request.method === 'POST' && url.pathname === '/entry') {
      if (request.headers.get('X-Admin-Key') !== env.ADMIN_KEY)
        return res({ error: 'unauthorized' }, 401, headers);

      const b = await request.json();
      if (!b.word || !b.reading || !b.zh_cn)
        return res({ error: 'word/reading/zh_cn 必填' }, 400, headers);

      const result = await env.DB.prepare(`
        INSERT OR IGNORE INTO entries
          (word, reading, tone, zh_cn, pos, jlpt, frequency, example_jp, example_zh, verified, ai_generated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).bind(
        b.word, b.reading, b.tone || null, b.zh_cn,
        b.pos || null, b.jlpt || null, b.frequency || null,
        b.example_jp || null, b.example_zh || null
      ).run();

      if (result.changes === 0) return res({ error: '词条已存在' }, 409, headers);

      // 新增成功后从 missing_words 删掉
      await env.DB.prepare(
        `DELETE FROM missing_words WHERE query = ?`
      ).bind(b.word).run();

      return res({ ok: true, id: result.meta.last_row_id }, 200, headers);
    }

    // ── GET /missing ──────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/missing') {
      if (url.searchParams.get('key') !== env.ADMIN_KEY)
        return res({ error: 'unauthorized' }, 401, headers);

      const { results } = await env.DB.prepare(`
        SELECT query, count, last_at FROM missing_words
        ORDER BY count DESC LIMIT 100
      `).all();

      return res({ results }, 200, headers);
    }

    return res({ error: 'not found' }, 404, headers);
  }
};

const res = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers });