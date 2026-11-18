// 本地 fixtures only. setup.mjs keeps this directory outside both upload roots.
// 内存假 db 只实现真实 SDK 用到的那部分方法，路由代码与线上完全一致。
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export function createMemoryRuntime() {
  // 与 schema.sql 对齐的列清单：真实 PostgREST 对未知列会报错，这里同样报错，
  // 否则 select 拼错的列会被静默投影成 undefined，本地测试看不出问题。
  const schema = {
    rooms: ['id', 'code', 'status', 'current_round', 'round_id', 'scene_text', 'scene_source',
      'token_a', 'token_b', 'join_key_b', 'nick_a', 'nick_b', 'win_round', 'ended_by',
      'version', 'created_at', 'touched_at'],
    room_rounds: ['id', 'room_id', 'round_no', 'word_a', 'word_b', 'norm_a', 'norm_b',
      'sealed_a', 'sealed_b', 'submitted_at_a', 'submitted_at_b', 'created_at'],
    custom_scenes: ['id', 'name', 'added_by', 'enabled', 'created_at'],
    users: ['id', 'name', 'token', 'last_seen', 'created_at'],
    invites: ['id', 'room_code', 'from_name', 'to_name', 'created_at'],
    dreamer_games: ['id', 'code', 'status', 'tier', 'banker_seat', 'token_a', 'token_b',
      'join_key_b', 'nick_a', 'nick_b', 'round_no', 'opened_in_round', 'lucky_box',
      'offer_base', 'offer_amount', 'offer_line', 'offer_sent', 'final_pick',
      'deal_taken', 'won_amount', 'version', 'created_at', 'touched_at'],
    dreamer_boxes: ['id', 'game_id', 'box_no', 'amount', 'opened', 'opened_round', 'created_at'],
    dreamer_offers: ['id', 'game_id', 'round_no', 'base_amount', 'amount', 'line', 'decision', 'created_at'],
  };
  const tables = {
    rooms: [], room_rounds: [], custom_scenes: [], users: [], invites: [],
    dreamer_games: [], dreamer_boxes: [], dreamer_offers: [],
  };
  // 故障开关只影响下一次匹配的请求，用于验证恢复路径。
  const state = { failState: false, loseSubmit: false, conflict: false };

  function reset() {
    for (const key of Object.keys(tables)) tables[key].length = 0;
  }
  const requireColumn = (table, column) => {
    if (!schema[table].includes(column)) throw new LocalError(`invalid_column_${table}_${column}`, 400);
  };

  const db = {
    from(table) {
      if (!(table in tables)) throw new LocalError('invalid_table', 400);
      const filters = [];
      const order = [];
      let mode = 'read';
      let values;
      let conflict;
      let columns;
      let count = 1000;
      const query = {
        select(value) { columns = value; String(value).split(',').forEach(column => requireColumn(table, column)); return query; },
        eq(key, value) { requireColumn(table, key); filters.push([key, value]); return query; },
        order(key, options = {}) { requireColumn(table, key); order.push([key, options.ascending !== false]); return query; },
        limit(value) { count = value; return query; },
        insert(value) { mode = 'insert'; values = value; Object.keys(value).forEach(column => requireColumn(table, column)); return query; },
        insertIfAbsent(value, options) {
          mode = 'insert'; values = value; conflict = options.onConflict.split(',');
          Object.keys(value).forEach(column => requireColumn(table, column));
          conflict.forEach(column => requireColumn(table, column));
          return query;
        },
        update(value) { mode = 'update'; values = value; Object.keys(value).forEach(column => requireColumn(table, column)); return query; },
        delete() { mode = 'delete'; return query; },
        then(fulfilled, rejected) {
          return Promise.resolve().then(() => {
            // 冲突只模拟房间状态推进落空（真正的并发揭示竞争），不干扰轮次封存写入。
            if (mode === 'update' && (table === 'rooms' || table === 'dreamer_games') && state.conflict) { state.conflict = false; return { data: [], error: null }; }
            let result;
            if (mode === 'insert') {
              const duplicate = conflict && tables[table].some(row => conflict.every(key => row[key] === values[key]));
              if (duplicate) result = [];
              else {
                // 真实表有 NOT NULL 默认值；这里要求调用方显式传全字段，避免本地静默补默认。
                const row = { created_at: new Date().toISOString(), ...values };
                tables[table].push(row);
                result = [row];
              }
            } else {
              result = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
              if (mode === 'update') result.forEach(row => Object.assign(row, values));
              if (mode === 'delete') {
                tables[table] = tables[table].filter(row => !result.includes(row));
              }
            }
            for (const [key, ascending] of [...order].reverse()) {
              result = [...result].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1));
            }
            result = result.slice(0, count).map(row => (columns
              ? Object.fromEntries(columns.split(',').map(key => [key, row[key]]))
              : { ...row }));
            return { data: result, error: null };
          }).then(fulfilled, rejected);
        },
      };
      return query;
    },
  };

  return {
    db, state, tables, reset, BackendError: LocalError,
  };
}

const controls = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同词遇见 · 本地测试控制台</title><style>body{font:16px/1.7 system-ui;max-width:700px;margin:50px auto;padding:20px;color:#4a2f22}button{font:inherit;padding:10px;margin:6px;border:1px solid #d8bda8;background:#fdf3ea;border-radius:10px;cursor:pointer}p{color:#7a6152}</style><h1>本地测试控制台</h1><p>只影响本次内存数据，不连接云端。故障开关只作用于下一次匹配的请求。</p><p><a href="/">← 返回游戏</a></p><div id="controls"></div><p id="status" role="status"></p><script>const actions={'fail-state':'下一次读取状态失败','lose-submit':'下一次提交已写入但丢失响应','conflict':'下一次状态推进发生版本冲突','reset':'清空所有房间'};for(const [action,label]of Object.entries(actions)){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{const r=await fetch('/__local/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});document.querySelector('#status').textContent=r.ok?'已设置：'+label:'设置失败'};document.querySelector('#controls').append(b)}</script></html>`;

export async function startLocalBackend(application, { port = 0 } = {}) {
  const runtime = createMemoryRuntime();
  const handle = application(runtime);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://${incoming.headers.host}`);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new LocalError('invalid_host', 403);
      if (!['GET', 'HEAD'].includes(incoming.method) && incoming.headers.origin && incoming.headers.origin !== url.origin) throw new LocalError('invalid_origin', 403);
      let size = 0;
      const chunks = [];
      for await (const chunk of incoming) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new LocalError('payload_too_large', 413); chunks.push(chunk); }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      let response;
      if (url.pathname === '/__local/' && incoming.method === 'GET') {
        response = new Response(controls, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      } else if (url.pathname === '/__local/control' && incoming.method === 'POST') {
        const { action } = await request.json();
        if (action === 'reset') runtime.reset();
        else if (['fail-state', 'lose-submit', 'conflict'].includes(action)) {
          runtime.state[{ 'fail-state': 'failState', 'lose-submit': 'loseSubmit', conflict: 'conflict' }[action]] = true;
        } else throw new LocalError('invalid_control', 400);
        response = Response.json({ ok: true });
      } else {
        // 故障注入贴着真实路由生效：提交已落库但响应丢失，正是必须验证的恢复路径。
        const dreamerWrite = request.method === 'POST'
          && /\/api\/dreamer\/(open|offer|decide|final-pick)$/.test(url.pathname);
        const isSubmit = request.method === 'POST'
          && (url.pathname.endsWith('/api/rooms/submit') || dreamerWrite);
        const isState = request.method === 'GET'
          && /\/api\/(rooms|dreamer\/games)\/state$/.test(url.pathname);
        if (isState && runtime.state.failState) { runtime.state.failState = false; throw new LocalError('database_unavailable', 503); }
        response = await handle({ request, user: null });
        if (isSubmit && runtime.state.loseSubmit) {
          runtime.state.loseSubmit = false;
          response = Response.json({ error: 'response_lost' }, { status: 503 });
        }
      }
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(error instanceof LocalError ? error.status : 500, {
        'content-type': 'application/json', 'cache-control': 'no-store',
      });
      outgoing.end(JSON.stringify({ error: error instanceof LocalError ? error.code : 'local_failure' }));
    }
  });
  await new Promise((done, failed) => { server.once('error', failed); server.listen(port, '127.0.0.1', done); });
  return {
    runtime, server, origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done, failed) => server.close(error => (error ? failed(error) : done()))),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { application } = await import(/* @vite-ignore */ new URL('../functions/routes.mjs', import.meta.url).href);
  const backend = await startLocalBackend(application);
  process.env.RECORDS_LOCAL_API = backend.origin;
  const vite = await import('vite');
  let frontend;
  try {
    frontend = await vite.createServer();
    await frontend.listen();
    frontend.printUrls();
  } catch (error) {
    await backend.close();
    throw error;
  }
  console.log('本地 fixture 模式：数据重启即清空。打开 /__local/ 注入读取失败、提交响应丢失与版本冲突。');
  const stop = async () => { await frontend.close(); await backend.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
