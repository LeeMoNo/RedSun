export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    // GET /search?q=食べる
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q')?.trim();
      if (!q) return res({ error: 'missing q' }, 400, headers);

      const like = `%${q}%`;
      const { results } = await env.DB.prepare(`
        SELECT * FROM entries
        WHERE word LIKE ? OR reading LIKE ? OR zh_cn LIKE ?
        ORDER BY frequency ASC
        LIMIT 20
      `).bind(like, like, like).all();

      return res({ results }, 200, headers);
    }

    // GET /entry/1
    const match = url.pathname.match(/^\/entry\/(\d+)$/);
    if (match) {
      const row = await env.DB.prepare(
        'SELECT * FROM entries WHERE id = ?'
      ).bind(match[1]).first();

      if (!row) return res({ error: 'not found' }, 404, headers);
      return res(row, 200, headers);
    }

    return res({ error: 'not found' }, 404, headers);
  }
};

const res = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers });