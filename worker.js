export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // GET /search?q=食べる
    if (request.method === 'GET' && url.pathname === '/search') {
      const q = url.searchParams.get('q')?.trim();
      if (!q) return res({ error: 'missing q' }, 400, headers);

      const like = `%${q}%`;
      const { results } = await env.DB.prepare(`
        SELECT * FROM entries
        WHERE word LIKE ? OR reading LIKE ? OR zh_cn LIKE ?
        ORDER BY frequency ASC LIMIT 20
      `).bind(like, like, like).all();

      // 搜不到 → 记录到 missing_words
      if (results.length === 0) {
        await env.DB.prepare(`
        INSERT INTO missing_words (query, count, last_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(query) DO UPDATE SET
          count = count + 1,
          last_at = datetime('now')
        `).bind(q).run();
      }

      return res({ results }, 200, headers);
    }

    // PATCH /entry/:id  — 编辑词条
    const match = url.pathname.match(/^\/entry\/(\d+)$/);
    if (request.method === 'PATCH' && match) {

      // 密码验证
      const pwd = request.headers.get('X-Admin-Key');
      if (pwd !== env.ADMIN_KEY) {
        return res({ error: 'unauthorized' }, 401, headers);
      }

      const body = await request.json();
      const fields = ['word', 'reading', 'tone', 'zh_cn', 'pos', 'jlpt',
        'frequency', 'example_jp', 'example_zh', 'verified'];

      // 只更新传入的字段
      const updates = Object.keys(body).filter(k => fields.includes(k));
      if (updates.length === 0) return res({ error: 'no valid fields' }, 400, headers);

      const sql = `UPDATE entries SET ${updates.map(k => `${k}=?`).join(', ')}
                   WHERE id = ?`;
      await env.DB.prepare(sql)
        .bind(...updates.map(k => body[k]), match[1])
        .run();

      return res({ ok: true }, 200, headers);
    }

    // GET /missing?key=密码 --查看未收录词排行
    if (request.method === 'GET' && url.pathname === '/missing') {
      const key = url.searchParams.get('key');
      if (key !== env.ADMIN_KEY) return res({ error: 'unauthorized' }, 401, headers);

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