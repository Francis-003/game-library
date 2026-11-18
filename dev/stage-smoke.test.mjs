// 部署包冒烟测试：直接加载 .zcode-site/stage 里的业务路由，跑一遍最关键的写接口。
// 为什么单独测 stage 而不是 functions/：stage 的 routes 是手工同步的副本，源码测试全绿
// 也拦不住副本漏了一句 import（线上白日梦想家建房 500 就是这么来的）。
// stage 不在仓库里，缺失时直接跳过，不影响源码测试。
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STAGE = fileURLToPath(new URL('../.zcode-site/stage/functions/routes.mjs', import.meta.url));

let checks = 0;
const failures = [];
function ok(name, condition, detail = '') {
  checks += 1;
  if (condition) return;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}
const eq = (name, actual, expected) =>
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);

try {
  await access(STAGE);
} catch {
  console.log('SKIP stage 冒烟测试：.zcode-site/stage 不存在（未生成部署包）');
  process.exit(0);
}

const { createMemoryRuntime } = await import(
  new URL('../.zcode-site/stage/dev-memory.mjs', import.meta.url).href
);
const { application } = await import(new URL('../.zcode-site/stage/functions/routes.mjs', import.meta.url).href);

const runtime = createMemoryRuntime();
const handle = application(runtime);
async function call(method, path, body) {
  const request = new Request(`http://stage.local/functions/v1/app${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handle({ request });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// 每个 POST 都过一遍 buildDreamerView / 校验分支，缺 import 会在这里抛 ReferenceError。
const created = await call('POST', '/api/dreamer/games', { nick: '庄家', role: 'banker', tier: 'small' });
eq('stage 建白日梦想家对局 201', created.status, 201);
eq('stage 建局者是 a 席位', created.body.seat, 'a');
eq('stage 建局视图带 10 个箱子', created.body.view?.boxes?.length, 10);

const joined = await call('POST', '/api/dreamer/games/join', {
  code: created.body.code, joinKey: crypto.randomUUID(), nick: '玩家',
});
eq('stage 加入对局 201', joined.status, 201);
eq('stage 双方到齐进入 playing', joined.body.view?.status, 'playing');

const picked = await call('POST', '/api/dreamer/pick-lucky', {
  code: created.body.code, token: joined.body.token, boxNo: 1,
});
eq('stage 选幸运箱 200', picked.status, 200);
eq('stage 选箱后进入 opening', picked.body.view?.phase, 'opening');

const room = await call('POST', '/api/rooms', { nick: '甲' });
eq('stage 同词遇见建房 201', room.status, 201);
eq('stage 同词遇见首轮带场景', typeof room.body.view?.scene?.text, 'string');

// 首页新增依赖：我的房间列表与未开始房间的自动销毁。
// 这两处都用到了 sweepExpired / expiresAtOf，副本漏函数会在这里立刻炸。
const me = await call('POST', '/api/users/login', { name: '冒烟用户' });
eq('stage 登录 201', me.status, 201);
const mine = await call('GET', `/api/me/rooms?token=${me.body.token}`);
eq('stage 我的房间 200', mine.status, 200);
eq('stage 我的房间是数组', Array.isArray(mine.body.rooms), true);
const mineRoom = await call('POST', '/api/rooms', { nick: '冒烟用户' });
eq('stage 建自己的房间 201', mineRoom.status, 201);
const listed = await call('GET', `/api/me/rooms?token=${me.body.token}`);
eq('stage 自己的房间进列表', listed.body.rooms?.some(row => row.code === mineRoom.body.code), true);
eq('stage 未开始的房间带销毁时间', typeof listed.body.rooms?.[0]?.expiresAt, 'string');

console.log(`stage 冒烟：${checks - failures.length}/${checks} 通过`);
if (failures.length) {
  console.error(failures.map(item => `  - ${item}`).join('\n'));
  process.exit(1);
}
