// 本地跑真实业务路由（内存假 db），不需要云资源，也不需要 Deno。
// 运行：node dev/game-local.test.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startLocalBackend } from './local.mjs';
import { application } from '../functions/routes.mjs';
import { normalizeWord } from '../functions/shared/normalize.mjs';
import { builtinSceneNames, pickScene } from '../functions/shared/scenes.mjs';
import { TIERS, baseOffer } from '../functions/shared/dreamer.mjs';

let checks = 0;
const failures = [];
function ok(name, condition, detail = '') {
  checks += 1;
  if (condition) return;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

const backend = await startLocalBackend(application);
const base = backend.origin;

async function send(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`/functions/v1/app${path}`, base);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 保留原文给断言用 */ }
  return { status: response.status, body: json ?? {}, text };
}
const get = (path, params) => send(path, { params });
const post = (path, body) => send(path, { method: 'POST', body });

async function newRoom(nick) {
  const created = await post('/api/rooms', { nick });
  if (created.status !== 201) throw new Error(`建房失败：${created.status} ${created.text}`);
  return created.body;
}
async function joinRoom(room, nick) {
  const joinKey = crypto.randomUUID();
  const joined = await post('/api/rooms/join', { code: room.code, joinKey, nick });
  if (joined.status !== 201) throw new Error(`加入失败：${joined.status} ${joined.text}`);
  return { ...joined.body, joinKey };
}

const alice = () => crypto.randomUUID();

// ---------------------------------------------------------------- 白日梦想家辅助
async function createDreamer(nick, role, tier) {
  const created = await post('/api/dreamer/games', { nick, role, tier });
  if (created.status !== 201) throw new Error(`建局失败：${created.status} ${created.text}`);
  return created.body;
}
async function joinDreamer(code, nick) {
  const joinKey = crypto.randomUUID();
  const joined = await post('/api/dreamer/games/join', { code, joinKey, nick });
  if (joined.status !== 201) throw new Error(`加入失败：${joined.status} ${joined.text}`);
  return { ...joined.body, joinKey };
}
async function dreamerState(code, token) {
  const state = await get('/api/dreamer/games/state', { code, token });
  if (state.status !== 200) throw new Error(`读状态失败：${state.status} ${state.text}`);
  return state.body.view;
}
function gameIdOf(code) {
  return backend.runtime.tables.dreamer_games.find(row => row.code === code).id;
}
// 把一局小档（10 箱）从建局一路推到终局抉择前（最终报价已被拒绝）。
// 返回 { code, bankerToken, playerToken, truth }：truth 是箱号→金额真值表。
async function playToFinalPick(nickA, nickB) {
  const a = await createDreamer(nickA, 'banker', 'small');
  const b = await joinDreamer(a.code, nickB);
  const truth = Object.fromEntries(
    backend.runtime.tables.dreamer_boxes
      .filter(row => row.game_id === gameIdOf(a.code))
      .map(row => [row.box_no, row.amount]),
  );
  await post('/api/dreamer/pick-lucky', { code: a.code, token: b.token, boxNo: 1 });
  const tier = TIERS.small;
  for (let round = 1; round <= tier.schedule.length; round += 1) {
    for (let opened = 0; opened < tier.schedule[round - 1]; opened += 1) {
      const view = await dreamerState(a.code, b.token);
      const target = view.boxes.find(box => !box.opened && box.no !== view.luckyBox).no;
      await post('/api/dreamer/open', { code: a.code, token: b.token, boxNo: target });
    }
    await post('/api/dreamer/offer', { code: a.code, token: a.token, line: `第${round}轮报价` });
    await post('/api/dreamer/decide', { code: a.code, token: b.token, deal: false });
  }
  // 终局轮：银行家发最终报价，玩家拒绝 → final_pick。
  await post('/api/dreamer/offer', { code: a.code, token: a.token, line: '最终报价' });
  await post('/api/dreamer/decide', { code: a.code, token: b.token, deal: false });
  return { code: a.code, bankerToken: a.token, playerToken: b.token, truth };
}


// ---------------------------------------------------------------- 健康检查
{
  const health = await get('/api/health');
  eq('health 返回 ok', health.body.ok, true);
}

// ---------------------------------------------------------------- 建房与加入
{
  const room = await newRoom('小舟');
  ok('口令是 6 位去歧义字符', /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(room.code), room.code);
  eq('建房者拿到 a 席位', room.seat, 'a');
  ok('席位密钥是 uuid', /^[0-9a-f-]{36}$/.test(room.token), room.token);
  eq('初始状态 waiting', room.view.status, 'waiting');
  eq('第 1 轮', room.view.round, 1);
  ok('第 1 轮带场景', typeof room.view.scene?.text === 'string' && room.view.scene.text.length > 0, JSON.stringify(room.view.scene));
  ok('抽中的场景来自内置池', builtinSceneNames.includes(room.view.scene.text), room.view.scene.text);
  eq('自己的词尚未提交', room.view.mySealed, false);
  ok('响应里没有 token 字段', !/token/.test(room.text), room.text);

  const guest = await joinRoom(room, '阿月');
  eq('加入者拿到 b 席位', guest.seat, 'b');
  eq('两人看到同一个场景', guest.view.scene.text, room.view.scene.text);
  eq('两人到齐后进入 playing', guest.view.status, 'playing');

  const again = await post('/api/rooms/join', { code: room.code, joinKey: guest.joinKey });
  eq('同一 joinKey 重复加入幂等', again.body.token, guest.token);

  const stranger = await post('/api/rooms/join', { code: room.code, joinKey: alice() });
  eq('席位已被占用时拒绝第三人', stranger.status, 409);
  eq('席位占用错误码', stranger.body.error, 'seat_taken');

  const wrongCode = await get('/api/rooms/state', { code: 'ZZZZZZ', token: room.token });
  eq('错误口令与不存在同为一码', wrongCode.status, 404);
  const wrongToken = await get('/api/rooms/state', { code: room.code, token: alice() });
  eq('token 不匹配拒绝并区分于不存在', wrongToken.status, 403);
  eq('非席位错误码', wrongToken.body.error, 'not_a_seat');
}

// ---------------------------------------------------------------- 锁步保密
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  const a = room.token;
  const b = guest.token;

  const submitted = await post('/api/rooms/submit', { code: room.code, token: a, word: '雨伞' });
  eq('A 提交成功', submitted.status, 200);
  eq('A 看见自己的词', submitted.body.view.myWord, '雨伞');
  eq('A 标记自己已封存', submitted.body.view.mySealed, true);
  eq('服务端告知对手是否封存', submitted.body.view.opponentSealed, false);
  ok('提交响应不含 opponentWord', !('opponentWord' in submitted.body.view), Object.keys(submitted.body.view).join(','));

  const beforeB = await get('/api/rooms/state', { code: room.code, token: b });
  eq('B 揭示前读取状态成功', beforeB.status, 200);
  ok('B 在揭示前看不到 A 的词', !beforeB.text.includes('雨伞'), beforeB.text);
  eq('B 只看到对手已封存这一个布尔', beforeB.body.view.opponentSealed, true);
  eq('B 自己的词仍为空', beforeB.body.view.mySealed, false);

  const bSubmit = await post('/api/rooms/submit', { code: room.code, token: b, word: '耳机' });
  eq('B 提交后直接带回揭示', bSubmit.body.revealed, true);
  eq('B 看到 A 的词', bSubmit.body.view.opponentWord, '雨伞');
  eq('未命中', bSubmit.body.view.matched, false);
  eq('状态进入 revealed', bSubmit.body.view.status, 'revealed');

  const aState = await get('/api/rooms/state', { code: room.code, token: a });
  eq('A 轮询后也看到 B 的词', aState.body.view.opponentWord, '耳机');
  eq('A 的历史此刻仍只有已揭示轮之前的记录', aState.body.view.history.length, 0);

  const aRetry = await post('/api/rooms/submit', { code: room.code, token: a, word: '雨伞' });
  eq('揭示完成后重试提交幂等返回', aRetry.status, 200);
  eq('重试直接带回揭示结果', aRetry.body.revealed, true);
  eq('重试不误开新的一轮', aRetry.body.view.round, 1);
}

// ---------------------------------------------------------------- 标准化命中
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  await post('/api/rooms/submit', { code: room.code, token: room.token, word: '遇见。' });
  const hit = await post('/api/rooms/submit', { code: room.code, token: guest.token, word: ' 遇 见 ' });
  eq('标点与空格不影响命中', hit.body.view.matched, true);
  eq('命中轮次', hit.body.view.winRound, 1);
  eq('命中后状态为 matched', hit.body.view.status, 'matched');

  const late = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '再试' });
  eq('揭示后重试不再改词', late.status, 200);
  eq('重试幂等返回揭示结果', late.body.revealed, true);
  eq('重试不推进轮次', late.body.view.round, 1);
  eq('重试仍显示命中', late.body.view.matched, true);

  // 真正不该再提交的场景：本局已结束且本轮只有一人封存。
  const pending = await newRoom();
  const waiter = await joinRoom(pending);
  await post('/api/rooms/submit', { code: pending.code, token: pending.token, word: '未完' });
  await post('/api/rooms/finish', { code: pending.code, token: pending.token });
  const afterEnd = await post('/api/rooms/submit', { code: pending.code, token: waiter.token, word: '补一个' });
  eq('已结束后不再开放提交', afterEnd.status, 409);
  eq('未开放轮次错误码', afterEnd.body.error, 'round_not_open');
  const sealedState = await get('/api/rooms/state', { code: pending.code, token: waiter.token });
  ok('结束时未封存的一方仍看不到对方词', !sealedState.text.includes('未完'), sealedState.text);
}

// ---------------------------------------------------------------- 下一轮与历史
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  await post('/api/rooms/submit', { code: room.code, token: room.token, word: '月亮' });
  await post('/api/rooms/submit', { code: room.code, token: guest.token, word: '路灯' });
  const next = await post('/api/rooms/next-round', { code: room.code, token: room.token });
  eq('进入第 2 轮', next.body.view.round, 2);
  eq('第 2 轮不再给场景', next.body.view.scene, null);
  eq('第 2 轮双方未封存', next.body.view.mySealed, false);
  eq('第 1 轮进入历史', next.body.view.history.length, 1);
  eq('历史含双方原词', next.body.view.history[0].wordA, '月亮');
  eq('历史标记未命中', next.body.view.history[0].matched, false);

  const both = await post('/api/rooms/next-round', { code: room.code, token: guest.token });
  eq('双方重复点下一轮只推进一次', both.body.view.round, 2);

  await post('/api/rooms/submit', { code: room.code, token: room.token, word: '路灯' });
  const guess = await post('/api/rooms/submit', { code: room.code, token: guest.token, word: '路灯' });
  eq('第 2 轮猜中即遇见', guess.body.view.matched, true);
  eq('命中轮次为 2', guess.body.view.winRound, 2);
  eq('揭示后历史保留第 1 轮', guess.body.view.history.length, 1);
}

// ---------------------------------------------------------------- 重复提交与响应丢失
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  const first = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '雨' });
  eq('首次提交成功', first.status, 200);
  const same = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '雨。' });
  eq('归一化相同的重复提交视为幂等', same.status, 200);
  const changed = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '伞' });
  eq('提交后改词被拒绝', changed.status, 409);
  eq('改词错误码', changed.body.error, 'word_locked');

  const stored = backend.runtime.tables.room_rounds
    .find(row => row.id === backend.runtime.tables.rooms.find(r => r.code === room.code).round_id);
  eq('被拒绝的改词没有覆盖原值', stored.word_a, '雨');
  eq('归一化值由服务端计算', stored.norm_a, '雨');
}

{
  const room = await newRoom();
  const guest = await joinRoom(room);
  backend.runtime.state.loseSubmit = true;
  const lost = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '信封' });
  eq('提交响应丢失返回 503', lost.status, 503);
  const reread = await get('/api/rooms/state', { code: room.code, token: room.token });
  eq('重读确认写入其实已提交', reread.body.view.mySealed, true);
  const roomId = backend.runtime.tables.rooms.find(row => row.code === room.code).id;
  eq('本局只有一轮行', backend.runtime.tables.room_rounds.filter(row => row.room_id === roomId).length, 1);
  eq('丢失响应没有造成重复写入', backend.runtime.tables.room_rounds.filter(row => row.room_id === roomId && row.word_a === '信封').length, 1);
  const retry = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '信封' });
  eq('丢失后原词重发幂等成功', retry.status, 200);
}

// ---------------------------------------------------------------- 并发揭示的状态滞后
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  const before = await get('/api/rooms/state', { code: room.code, token: room.token });
  await post('/api/rooms/submit', { code: room.code, token: room.token, word: '同词' });
  // 模拟对手请求抢先推进房间状态：本请求对 rooms 的 CAS 会落空。
  backend.runtime.state.conflict = true;
  const hit = await post('/api/rooms/submit', { code: room.code, token: guest.token, word: '同词' });
  eq('CAS 落空仍完成揭示', hit.body.view.opponentWord, '同词');
  eq('揭示不依赖状态推进结果', hit.body.view.matched, true);
  eq('落空后读回权威状态而非重放写', hit.body.view.rev, before.body.view.rev);
  eq('房间状态此时仍滞后为 playing', hit.body.view.status, 'playing');
  const settled = await get('/api/rooms/state', { code: room.code, token: room.token });
  eq('状态滞后不会让游戏死锁：仍可开启下一轮', (await post('/api/rooms/next-round', { code: room.code, token: room.token })).body.view.round, 2);
  eq('新一轮已清空封存状态', (await get('/api/rooms/state', { code: room.code, token: room.token })).body.view.mySealed, false);
  eq('滞后期间已完成的历史轮次可复盘', settled.body.view.history.length, 0);
}

// ---------------------------------------------------------------- 非法输入
{
  const room = await newRoom();
  await joinRoom(room);
  const empty = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '。！？' });
  eq('纯标点被拒绝', empty.status, 400);
  const missing = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '' });
  eq('空词被拒绝', missing.status, 400);
  const long = await post('/api/rooms/submit', { code: room.code, token: room.token, word: '词'.repeat(101) });
  eq('超过 100 码点被拒绝', long.status, 400);
  const badMethod = await send('/api/rooms', { method: 'GET' });
  eq('GET 不建房间', badMethod.status, 404);
  const badJoin = await post('/api/rooms/join', { code: room.code, joinKey: 'not-a-uuid' });
  eq('joinKey 必须是 uuid', badJoin.status, 400);
  const unknown = await get('/api/nope');
  eq('未知路径不返回成功', unknown.status, 404);
}

// ---------------------------------------------------------------- 结束与重开
{
  const room = await newRoom();
  const guest = await joinRoom(room);
  const ended = await post('/api/rooms/finish', { code: room.code, token: guest.token });
  eq('任一席位可结束本局', ended.body.view.status, 'ended');
  eq('记录结束者席位', ended.body.view.endedBy, 'b');
  const stateAfter = await get('/api/rooms/state', { code: room.code, token: room.token });
  eq('另一端同步看到已结束', stateAfter.body.view.status, 'ended');
  const again = await post('/api/rooms/finish', { code: room.code, token: room.token });
  eq('重复结束被拒绝', again.status, 409);

  const rematch = await post('/api/rooms/rematch', { code: room.code, token: room.token });
  eq('重开原房间 200', rematch.status, 200);
  eq('重开房间号不变', rematch.body.code, room.code);
  eq('调用者席位不变', rematch.body.seat, 'a');
  const restartedA = await get('/api/rooms/state', { code: room.code, token: room.token });
  const restartedB = await get('/api/rooms/state', { code: room.code, token: guest.token });
  eq('对手席位凭据仍然有效', restartedB.status, 200);
  eq('双方都看到新一局已开始', restartedA.body.view.status, 'playing');
  eq('对手也看到新一局', restartedB.body.view.status, 'playing');
  eq('新一局回到第 1 轮', restartedA.body.view.round, 1);
  eq('新一局双方未封存', restartedA.body.view.mySealed, false);
  eq('历史已清空', restartedA.body.view.history.length, 0);
  // 双方同时点重开：第二次幂等返回，不应把新一局又重置一遍或报 409。
  const double = await post('/api/rooms/rematch', { code: room.code, token: room.token });
  eq('进行中重复重开被拒绝', double.status, 409);
  await post('/api/rooms/submit', { code: room.code, token: room.token, word: '新词' });
  const before = await get('/api/rooms/state', { code: room.code, token: room.token });
  eq('重开后可正常继续玩', before.body.view.mySealed, true);
}

// ---------------------------------------------------------------- 场景库
{
  const room = await newRoom();
  await joinRoom(room);
  const list = await get('/api/scenes', { code: room.code, token: room.token });
  eq('内置场景 100 条', list.body.builtin.length, 100);
  eq('内置场景去重后仍是 100', new Set(list.body.builtin.map(s => s.name)).size, 100);
  eq('自定义初始为空', list.body.custom.length, 0);

  const added = await post('/api/scenes/add', { code: room.code, token: room.token, name: '周末菜市场' });
  eq('添加自定义场景成功', added.status, 201);
  eq('自定义场景进入共享列表', (await get('/api/scenes', { code: room.code, token: room.token })).body.custom.length, 1);

  const duplicate = await post('/api/scenes/add', { code: room.code, token: room.token, name: '周末菜市场' });
  eq('同名不新建第二条', duplicate.status, 200);
  eq('列表仍只有一条', (await get('/api/scenes', { code: room.code, token: room.token })).body.custom.length, 1);

  const builtinClash = await post('/api/scenes/add', { code: room.code, token: room.token, name: '雨伞' });
  eq('与内置重名被拒绝', builtinClash.status, 409);
  const tooLong = await post('/api/scenes/add', { code: room.code, token: room.token, name: '一二三四五六七八九十一二三四五六' });
  eq('超长场景名被拒绝', tooLong.status, 400);

  const sceneId = added.body.scene.id;
  const disabled = await post('/api/scenes/toggle', { code: room.code, token: room.token, id: sceneId, enabled: false });
  eq('禁用改为布尔开关而非删除', disabled.body.scene.enabled, false);
  const revived = await post('/api/scenes/add', { code: room.code, token: room.token, name: '周末菜市场' });
  eq('重新添加同名即恢复启用', revived.body.scene.enabled, true);
  const strangerToggle = await post('/api/scenes/toggle', { code: room.code, token: alice(), id: sceneId, enabled: false });
  eq('非席位不能改场景库', strangerToggle.status, 403);

  // 抽取函数只依赖传入的池，用单元素池证明自定义项确实在池里可被抽中。
  eq('pickScene 可从自定义池取词', pickScene([{ text: '周末菜市场', source: 'custom' }]).text, '周末菜市场');
  eq('空池返回 null', pickScene([]), null);
}

// ---------------------------------------------------------------- 用户身份与在线
{
  const created = await post('/api/users/login', { name: '小舟' });
  eq('登录创建账号', created.status, 201);
  ok('登录返回 token', typeof created.body.token === 'string' && created.body.token.length > 0);
  eq('登录回显用户名', created.body.name, '小舟');
  ok('登录响应不含内部 id', !('id' in created.body));

  const clash = await post('/api/login', { name: '小舟' });
  eq('错误路径不是登录', clash.status, 404);

  const again = await post('/api/users/login', { name: '小舟' });
  eq('同名登录直接进入（不再报重名）', again.status, 200);
  eq('同名登录复用原凭据', again.body.token, created.body.token);
  ok('同名登录不含错误码', !('error' in again.body));

  const emptyName = await post('/api/users/login', { name: '  ' });
  eq('空名被拒绝', emptyName.status, 400);
  const longName = await post('/api/users/login', { name: '一二三四五六七八九十一二三四五六' });
  eq('超长用户名被拒绝', longName.status, 400);

  const second = await post('/api/users/login', { name: '阿月' });
  eq('第二个账号创建成功', second.status, 201);
  ok('不同账号 token 不同', second.body.token !== created.body.token);

  const snapshot = await get('/api/me', { token: created.body.token });
  eq('me 返回自己的名字', snapshot.body.name, '小舟');
  ok('me 返回好友列表', Array.isArray(snapshot.body.friends));
  ok('me 返回邀请列表', Array.isArray(snapshot.body.invites));
  const bad = await get('/api/me', { token: 'nope' });
  eq('无效 token 拒绝', bad.status, 403);
  eq('无效 token 错误码', bad.body.error, 'invalid_token');

  // 在线窗口：把小舟的 last_seen 拨回 2 分钟前 → 阿月看到离线；小舟再心跳 → 恢复在线。
  const row = backend.runtime.tables.users.find(user => user.name === '小舟');
  row.last_seen = new Date(Date.now() - 2 * 60_000).toISOString();
  const offlineView = await get('/api/me', { token: second.body.token });
  eq('超过在线窗口显示离线', offlineView.body.friends?.find(f => f.name === '小舟')?.online, false);
  await get('/api/me', { token: created.body.token });
  const onlineView = await get('/api/me', { token: second.body.token });
  eq('心跳后恢复在线', onlineView.body.friends.find(f => f.name === '小舟').online, true);
}

// ---------------------------------------------------------------- 用户 2 小时不活跃自动删除
{
  const stale = await post('/api/users/login', { name: '沉睡用户' });
  eq('沉睡用户创建成功', stale.status, 201);
  const watcher = await post('/api/users/login', { name: '清醒用户' });
  // 好友 = 全部用户：另一个账号能看到沉睡用户。
  let seen = await get('/api/me', { token: watcher.body.token });
  eq('新用户自动成为所有人的好友', seen.body.friends.some(f => f.name === '沉睡用户'), true);

  // 把沉睡用户的 last_seen 拨回 2 小时零 1 分钟。
  const row = backend.runtime.tables.users.find(user => user.name === '沉睡用户');
  row.last_seen = new Date(Date.now() - (2 * 60 * 60_000 + 60_000)).toISOString();

  // 任何用户登录/心跳都会触发回收：这里用清醒用户登录触发。
  await post('/api/users/login', { name: '清醒用户' });
  eq('超过 2 小时未登录的用户被删除',
    backend.runtime.tables.users.some(user => user.name === '沉睡用户'), false);
  eq('被删用户的 token 立即失效',
    (await get('/api/me', { token: stale.body.token })).status, 403);
  seen = await get('/api/me', { token: watcher.body.token });
  eq('好友列表同步移除被删用户', seen.body.friends.some(f => f.name === '沉睡用户'), false);

  // 同名重新登录 = 新建用户（拿到新 token），不是复活旧账号。
  const reborn = await post('/api/users/login', { name: '沉睡用户' });
  eq('过期用户同名登录新建成功', reborn.status, 201);
  ok('同名新用户 token 不同', reborn.body.token !== stale.body.token);
  // 未到 2 小时的用户不能被误删。
  const fresh = await post('/api/users/login', { name: '活跃用户' });
  await post('/api/users/login', { name: '另一个人' });
  eq('未过期用户不会被删除',
    backend.runtime.tables.users.some(user => user.name === '活跃用户'), true);
  eq('活跃用户 token 仍有效', (await get('/api/me', { token: fresh.body.token })).status, 200);
}

// ---------------------------------------------------------------- 邀请与接受
{
  const host = await post('/api/users/login', { name: '房东' });
  const guest = await post('/api/users/login', { name: '房客' });
  const room = await newRoom('房东');

  const stranger = await post('/api/invites', { code: room.code, token: alice(), to: '房客' });
  eq('非席位不能发邀请', stranger.status, 403);
  eq('非席位错误码', stranger.body.error, 'not_a_seat');

  const invite = await post('/api/invites', { code: room.code, token: room.token, to: '房客' });
  eq('邀请好友进入房间', invite.status, 201);
  eq('邀请带房间口令', invite.body.invite.roomCode, room.code);
  eq('邀请显示发起人', invite.body.invite.toName, '房客');

  const repeat = await post('/api/invites', { code: room.code, token: room.token, to: '房客' });
  eq('重复邀请幂等', repeat.status, 200);
  eq('幂等返回同一邀请', repeat.body.invite.id, invite.body.invite.id);

  const seen = await get('/api/me', { token: guest.body.token });
  const entry = seen.body.invites.find(item => item.roomCode === room.code);
  ok('被邀请方能在 me 里看到邀请', Boolean(entry), JSON.stringify(seen.body.invites));
  eq('邀请显示发起人', entry.fromName, '房东');
  eq('同词遇见邀请带游戏标识', entry.game, 'tongci');

  const self = await post('/api/invites', { code: room.code, token: room.token, to: '房东' });
  eq('不能邀请自己', self.status, 400);

  const ghost = await post('/api/invites', { code: room.code, token: room.token, to: '不存在的人' });
  eq('邀请未注册用户被拒', ghost.status, 404);

  const joined = await joinRoom(room, '房客');
  eq('接受邀请后房间进入 playing', joined.view.status, 'playing');
  const late = await post('/api/invites', { code: room.code, token: room.token, to: '房客' });
  eq('房间开玩后不再接受邀请', late.status, 409);
  eq('房间状态错误码', late.body.error, 'room_not_waiting');

  const dismissed = await post('/api/invites/dismiss', { token: guest.body.token, id: entry.id });
  eq('领取/忽略后删除邀请', dismissed.status, 200);
  const cleared = await get('/api/me', { token: guest.body.token });
  eq('清理后邀请不再出现', cleared.body.invites.some(i => i.id === entry.id), false);

  // 只能删发给自己的邀请：拿房东的 token 删房客的邀请，行应当原样保留。
  const room2 = await newRoom('房东');
  const secondInvite = await post('/api/invites', { code: room2.code, token: room2.token, to: '房客' });
  eq('新房间可再次邀请', secondInvite.status, 201);
  await post('/api/invites/dismiss', { token: host.body.token, id: secondInvite.body.invite.id });
  eq('只能删除发给自己的邀请', backend.runtime.tables.invites.some(row => row.id === secondInvite.body.invite.id), true);

  // 过期邀请不再出现在 me 快照里。
  const expired = backend.runtime.tables.invites.find(row => row.id === secondInvite.body.invite.id);
  expired.created_at = new Date(Date.now() - 3 * 60_000).toISOString();
  const afterExpire = await get('/api/me', { token: guest.body.token });
  eq('过期邀请自动不再出现', afterExpire.body.invites.some(row => row.id === secondInvite.body.invite.id), false);
}

// ---------------------------------------------------------------- 白日梦想家的邀请（首页好友弹层用）
{
  const guest = await post('/api/users/login', { name: '梦客' });
  const game = await createDreamer('梦主', 'player', 'small');

  const invite = await post('/api/invites', { code: game.code, token: game.token, to: '梦客', game: 'dreamer' });
  eq('白日梦想家也能发邀请', invite.status, 201);
  eq('邀请标明白日梦想家', invite.body.invite.game, 'dreamer');

  const seen = await get('/api/me', { token: guest.body.token });
  const entry = seen.body.invites.find(row => row.roomCode === game.code);
  ok('被邀请方看到白日梦想家邀请', Boolean(entry), JSON.stringify(seen.body.invites));
  eq('邀请里的游戏是 dreamer', entry?.game, 'dreamer');

  // 不传 game 时仍按同词遇见解析：白日梦想家的口令在同词遇见表里查不到。
  const wrongGame = await post('/api/invites', { code: game.code, token: game.token, to: '梦客' });
  eq('按同词遇见发白日梦想家邀请失败', wrongGame.status, 404);

  const repeat = await post('/api/invites', { code: game.code, token: game.token, to: '梦客', game: 'dreamer' });
  eq('白日梦想家重复邀请幂等', repeat.status, 200);

  const joined = await joinDreamer(game.code, '梦客');
  eq('接受后白日梦想家开局', joined.view.status, 'playing');
  const late = await post('/api/invites', { code: game.code, token: game.token, to: '梦客', game: 'dreamer' });
  eq('开局后不能再邀请', late.status, 409);
}

// ---------------------------------------------------------------- 白日梦想家 · 建局与加入
{
  for (const [tier, meta] of Object.entries(TIERS)) {
    const created = await post('/api/dreamer/games', { nick: '庄家', role: 'banker', tier });
    eq(`${tier} 建局 201`, created.status, 201);
    eq(`${tier} 席位 a`, created.body.seat, 'a');
    const rows = backend.runtime.tables.dreamer_boxes.filter(row => row.game_id === gameIdOf(created.body.code));
    eq(`${tier} 箱数 = ${meta.boxCount}`, rows.length, meta.boxCount);
    const sorted = rows.map(row => row.amount).sort((x, y) => x - y);
    const ladder = [...meta.ladder].sort((x, y) => x - y);
    eq(`${tier} 金额多重集等于阶梯`, JSON.stringify(sorted), JSON.stringify(ladder));
    ok(`${tier} 已洗牌（非原序）`, JSON.stringify(rows.map(row => row.amount)) !== JSON.stringify(meta.ladder));
    const view = await dreamerState(created.body.code, created.body.token);
    eq(`${tier} 角色 banker`, view.role, 'banker');
    eq(`${tier} 初始 phase`, view.phase, 'waiting');
  }
  const wrongTier = await post('/api/dreamer/games', { nick: '庄家', role: 'banker', tier: 'nope' });
  eq('非法档位 400', wrongTier.status, 400);
  const wrongRole = await post('/api/dreamer/games', { nick: '庄家', role: 'bank', tier: 'small' });
  eq('非法身份 400', wrongRole.status, 400);

  const a = await createDreamer('庄家A', 'banker', 'small');
  const b = await joinDreamer(a.code, '玩家B');
  eq('加入席位 b', b.seat, 'b');
  const joinedView = await dreamerState(a.code, b.token);
  eq('加入后角色 player', joinedView.role, 'player');
  eq('加入后 phase pick_lucky', joinedView.phase, 'pick_lucky');
  const third = await post('/api/dreamer/games/join', { code: a.code, joinKey: crypto.randomUUID(), nick: '第三人' });
  eq('第三人 409', third.status, 409);
  // joinKey 自愈：同 joinKey 重发取回原 token。
  const healed = await post('/api/dreamer/games/join', { code: a.code, joinKey: b.joinKey, nick: '玩家B' });
  eq('joinKey 自愈 200', healed.status, 200);
  eq('joinKey 自愈取回 token', healed.body.token, b.token);
  // 越权令牌与错误口令语义。
  const stranger = await get('/api/dreamer/games/state', { code: a.code, token: crypto.randomUUID() });
  eq('陌生 token 403', stranger.status, 403);
  const badCode = await get('/api/dreamer/games/state', { code: 'ZZZZZZ', token: b.token });
  eq('错误口令 404', badCode.status, 404);
}

// ---------------------------------------------------------------- 白日梦想家 · 盲箱保密
{
  const { code, bankerToken, playerToken, truth } = await playToFinalPick('保密庄', '保密玩家');
  for (const token of [bankerToken, playerToken]) {
    const view = await dreamerState(code, token);
    const unopened = view.boxes.filter(box => !box.opened);
    ok('未开箱金额一律 null（含幸运箱）', unopened.every(box => box.amount === null),
      JSON.stringify(unopened.filter(box => box.amount !== null)));
    eq(`${token === bankerToken ? 'banker' : 'player'} 揭晓前无 result`, view.result, undefined);
    // 剩余金额板是公开信息：必须等于真值表里未开箱的金额。
    const board = [...view.remainingAmounts].sort((x, y) => x - y);
    const expected = Object.values(truth).filter((amount, index) => {
      const opened = Object.entries(truth).some(([no, value]) => value === amount
        && view.boxes.find(box => box.no === Number(no))?.opened);
      return !opened;
    }).sort((x, y) => x - y);
    ok('金额板与真值一致', JSON.stringify(board) === JSON.stringify(expected),
      `${JSON.stringify(board)} vs ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------- 白日梦想家 · 全流程
{
  const { code, bankerToken, playerToken, truth } = await playToFinalPick('流程庄', '流程玩家');
  let view = await dreamerState(code, playerToken);
  eq('终局 phase final_pick', view.phase, 'final_pick');
  eq('终局轮号', view.roundNo, 5);
  eq('5 次报价历史', view.offers.length, 5);
  ok('每轮报价金额 = 参考价', view.offers.every(offer => offer.amount === offer.base));
  // 净收益模型：P = 最后一轮银行家报价，V = 幸运箱（1 号）真值，玩家净 = P − V。
  const lastOffer = view.offers[view.offers.length - 1].amount;
  const expectedNet = Math.round((lastOffer - truth[1]) * 100) / 100;
  const keep = await post('/api/dreamer/final-pick', { code, token: playerToken, choice: 'keep' });
  eq('终局保留 200', keep.status, 200);
  view = await dreamerState(code, playerToken);
  eq('keep 后 phase ended', view.phase, 'ended');
  eq('keep 的 P 是最后一轮报价', view.result.p, lastOffer);
  eq('keep 的 V 是幸运箱真值', view.result.luckyAmount, Math.round(truth[1] * 100) / 100);
  eq('keep 玩家净收益 = P − V', view.result.playerGain, expectedNet);
  eq('keep 银行家净收益 = V − P', view.result.bankerGain, -expectedNet);
  eq('keep 的 finalBoxNo 是幸运箱', view.result.finalBoxNo, view.result.luckyBox);
  eq('keep 的 finalAmount', view.result.finalAmount, truth[1]);
  ok('揭晓后金额全部可见', view.boxes.every(box => box.amount !== null));
  eq('揭晓后金额板清空', view.remainingAmounts.length, 0);
  // 双方视图拿到同一份 P/V 与相反符号的净收益，前端按各自角色选字段显示。
  const keepBankerView = await dreamerState(code, bankerToken);
  eq('两方净收益数据一致', keepBankerView.result.playerGain, view.result.playerGain);
  eq('玩家净 + 银行家净 = 0', view.result.playerGain + view.result.bankerGain, 0);
}
{
  // swap 路径：小档唯一幸运箱是 1 号，最后一个公共箱是 10 号。
  // 净收益仍按 P − V（P=最后一轮报价，V=1 号幸运箱），不随 keep/swap 改变。
  const swapGame = await playToFinalPick('换箱庄', '换箱玩家');
  const lastOffer = (await dreamerState(swapGame.code, swapGame.playerToken)).offers.slice(-1)[0].amount;
  const swap = await post('/api/dreamer/final-pick', { code: swapGame.code, token: swapGame.playerToken, choice: 'swap' });
  eq('终局交换 200', swap.status, 200);
  const swapView = await dreamerState(swapGame.code, swapGame.playerToken);
  const expectedNet = Math.round((lastOffer - swapGame.truth[1]) * 100) / 100;
  eq('swap 玩家净收益 = P − V', swapView.result.playerGain, expectedNet);
  eq('swap 银行家净收益 = V − P', swapView.result.bankerGain, -expectedNet);
  eq('swap 的 finalBoxNo', swapView.result.finalBoxNo, 10);
  eq('swap 的 finalAmount 是交换箱真值', swapView.result.finalAmount, swapGame.truth[10]);
  const changed = await post('/api/dreamer/final-pick', { code: swapGame.code, token: swapGame.playerToken, choice: 'keep' });
  eq('终局改口 409', changed.status, 409);
}
{
  // 中途 Deal：第 1 轮报价直接成交。
  const dealGame = await createDreamer('成交庄', 'banker', 'small');
  const dealPlayer = await joinDreamer(dealGame.code, '成交玩家');
  await post('/api/dreamer/pick-lucky', { code: dealGame.code, token: dealPlayer.token, boxNo: 3 });
  for (let opened = 0; opened < 3; opened += 1) {
    const current = await dreamerState(dealGame.code, dealPlayer.token);
    const target = current.boxes.find(box => !box.opened && box.no !== current.luckyBox).no;
    await post('/api/dreamer/open', { code: dealGame.code, token: dealPlayer.token, boxNo: target });
  }
  await post('/api/dreamer/offer', { code: dealGame.code, token: dealGame.token });
  const deal = await post('/api/dreamer/decide', { code: dealGame.code, token: dealPlayer.token, deal: true });
  eq('中途 Deal 200', deal.status, 200);
  const dealView = await dreamerState(dealGame.code, dealPlayer.token);
  eq('Deal 后 phase ended', dealView.phase, 'ended');
  eq('Deal 标记 dealt', dealView.result.dealt, true);
  // 净收益模型：P = 成交价，V = 幸运箱（3 号）真值，玩家净 = P − V。
  const dealV = dealView.boxes.find(box => box.no === dealView.result.luckyBox).amount;
  eq('Deal 的 P 是成交价', dealView.result.p, dealView.offers[0].amount);
  eq('Deal 的 V 是幸运箱真值', dealView.result.luckyAmount, dealV);
  eq('Deal 玩家净收益 = P − V', dealView.result.playerGain,
    Math.round((dealView.offers[0].amount - dealV) * 100) / 100);
  eq('Deal 银行家净收益 = V − P', dealView.result.bankerGain,
    -Math.round((dealView.offers[0].amount - dealV) * 100) / 100);
  eq('Deal 的成交价', dealView.result.dealAmount, dealView.offers[0].amount);
  eq('Deal 后轮号停在 1', dealView.roundNo, 1);
}

// ---------------------------------------------------------------- 白日梦想家 · 越权
{
  const { code, bankerToken, playerToken } = await playToFinalPick('越权庄', '越权玩家');
  eq('玩家报价 403', (await post('/api/dreamer/offer', { code, token: playerToken })).status, 403);
  eq('银行家选幸运箱 403', (await post('/api/dreamer/pick-lucky', { code, token: bankerToken, boxNo: 2 })).status, 403);
  eq('银行家开箱 403', (await post('/api/dreamer/open', { code, token: bankerToken, boxNo: 5 })).status, 403);
  eq('银行家决定 403', (await post('/api/dreamer/decide', { code, token: bankerToken, deal: false })).status, 403);
}

// ---------------------------------------------------------------- 白日梦想家 · 故障注入
{
  const a = await createDreamer('故障庄', 'banker', 'small');
  const b = await joinDreamer(a.code, '故障玩家');
  await post('/api/dreamer/pick-lucky', { code: a.code, token: b.token, boxNo: 1 });
  for (let opened = 0; opened < 3; opened += 1) {
    const current = await dreamerState(a.code, b.token);
    const target = current.boxes.find(box => !box.opened && box.no !== current.luckyBox).no;
    await post('/api/dreamer/open', { code: a.code, token: b.token, boxNo: target });
  }
  await post('/api/dreamer/offer', { code: a.code, token: a.token });
  await post('/api/dreamer/decide', { code: a.code, token: b.token, deal: false });
  // loseSubmit：开箱已写入但响应丢失 — 重试同箱幂等。
  backend.runtime.state.loseSubmit = true;
  eq('开箱响应丢失 503', (await post('/api/dreamer/open', { code: a.code, token: b.token, boxNo: 5 })).status, 503);
  const afterLost = await dreamerState(a.code, b.token);
  eq('写入已生效', afterLost.boxes.find(box => box.no === 5).opened, true);
  eq('同箱重试幂等 200', (await post('/api/dreamer/open', { code: a.code, token: b.token, boxNo: 5 })).status, 200);
  // conflict：决定落库但推进 CAS 失败 — 重试补上推进。
  for (let opened = 0; opened < 1; opened += 1) {
    const current = await dreamerState(a.code, b.token);
    const target = current.boxes.find(box => !box.opened && box.no !== current.luckyBox).no;
    await post('/api/dreamer/open', { code: a.code, token: b.token, boxNo: target });
  }
  await post('/api/dreamer/offer', { code: a.code, token: a.token });
  backend.runtime.state.conflict = true;
  const conflicted = await post('/api/dreamer/decide', { code: a.code, token: b.token, deal: false });
  eq('推进冲突 200', conflicted.status, 200);
  eq('决定已落库', (await dreamerState(a.code, b.token)).offers.at(-1).decision, 'no_deal');
  eq('轮次未推进', (await dreamerState(a.code, b.token)).roundNo, 2);
  const retried = await post('/api/dreamer/decide', { code: a.code, token: b.token, deal: false });
  void retried;
  eq('重试补上推进', (await dreamerState(a.code, b.token)).roundNo, 3);
}

// ---------------------------------------------------------------- 白日梦想家 · 自由出价与未翻均值
{
  const adjustGame = await createDreamer('调价庄', 'banker', 'standard');
  const adjustPlayer = await joinDreamer(adjustGame.code, '调价玩家');
  await post('/api/dreamer/pick-lucky', { code: adjustGame.code, token: adjustPlayer.token, boxNo: 2 });
  for (let opened = 0; opened < 4; opened += 1) {
    const current = await dreamerState(adjustGame.code, adjustPlayer.token);
    const target = current.boxes.find(box => !box.opened && box.no !== current.luckyBox).no;
    await post('/api/dreamer/open', { code: adjustGame.code, token: adjustPlayer.token, boxNo: target });
  }
  const bankerView = await dreamerState(adjustGame.code, adjustGame.token);
  ok('参考价 > 0', bankerView.offerBase > 0, String(bankerView.offerBase));
  ok('未翻均值 > 0', bankerView.averageLeft > 0, String(bankerView.averageLeft));
  // 出价不限：任意非负金额都接受（含远高于/低于参考价）。
  eq('任意高出价 200', (await post('/api/dreamer/offer', { code: adjustGame.code, token: adjustGame.token, amount: 999999 })).status, 200);
  const otherGame = await createDreamer('低庄', 'banker', 'small');
  const otherPlayer = await joinDreamer(otherGame.code, '低玩家');
  await post('/api/dreamer/pick-lucky', { code: otherGame.code, token: otherPlayer.token, boxNo: 1 });
  for (let opened = 0; opened < 3; opened += 1) {
    const current = await dreamerState(otherGame.code, otherPlayer.token);
    const target = current.boxes.find(box => !box.opened && box.no !== current.luckyBox).no;
    await post('/api/dreamer/open', { code: otherGame.code, token: otherPlayer.token, boxNo: target });
  }
  eq('低价 0 也接受', (await post('/api/dreamer/offer', { code: otherGame.code, token: otherGame.token, amount: 0 })).status, 200);
}

// ---------------------------------------------------------------- 白日梦想家 · 再来一局
{
  const first = await playToFinalPick('再庄', '再玩家');
  // 先把终局抉择做完，对局才进入 ended，才允许再来一局。
  await post('/api/dreamer/final-pick', { code: first.code, token: first.playerToken, choice: 'keep' });
  eq('终局已结束', (await dreamerState(first.code, first.playerToken)).status, 'ended');
  const rematch = await post('/api/dreamer/rematch', { code: first.code, token: first.playerToken });
  eq('玩家发起 rematch 200', rematch.status, 200);
  eq('就地重开房间号不变', rematch.body.code, first.code);
  eq('调用者席位不变', rematch.body.seat, 'b');
  eq('rematch 保持档位', rematch.body.view.tier, 'small');
  eq('rematch 保持角色', rematch.body.view.role, 'player');
  // 双方的原 token 都仍然有效，对手不用拿新口令，轮询同一个 code 就能看到新局。
  const restartedBanker = await dreamerState(first.code, first.bankerToken);
  const restartedPlayer = await dreamerState(first.code, first.playerToken);
  eq('银行家 token 仍有效', restartedBanker.status !== undefined, true);
  eq('银行家看到新局已开始', restartedBanker.status, 'playing');
  eq('玩家也看到新局', restartedPlayer.status, 'playing');
  eq('新局回到 pick_lucky', restartedPlayer.phase, 'pick_lucky');
  eq('新局幸运箱未选', restartedPlayer.luckyBox, null);
  eq('新局报价清空', restartedPlayer.offers.length, 0);
  eq('新局箱子重新洗过（10 箱）', restartedPlayer.boxes.length, 10);
  ok('新局未开箱', restartedPlayer.boxes.every(box => !box.opened));
  // 进行中的对局不允许重复重开，避免把别人正在玩的一局重置掉。
  const double = await post('/api/dreamer/rematch', { code: first.code, token: first.bankerToken });
  eq('进行中重复重开被拒绝', double.status, 409);
  // 新局可继续玩：玩家选幸运箱进入开箱阶段。
  const picked = await post('/api/dreamer/pick-lucky', { code: first.code, token: first.playerToken, boxNo: 1 });
  eq('重开后可正常选箱', picked.body.view.phase, 'opening');
}

// ---------------------------------------------------------------- 我的房间列表
{
  const me = await post('/api/users/login', { name: '列表用户' });
  const mine = await get('/api/me/rooms', { token: me.body.token });
  eq('未建房时列表为空', mine.body.rooms.length, 0);

  const host = await newRoom('列表用户');
  const listed = await get('/api/me/rooms', { token: me.body.token });
  eq('自己开的房间出现在列表里', listed.body.rooms.length, 1);
  eq('列表里的口令一致', listed.body.rooms[0].code, host.code);
  eq('列表标记为同词遇见', listed.body.rooms[0].game, 'tongci');
  eq('列表标记房主席位', listed.body.rooms[0].seat, 'a');
  eq('未开始的房间带销毁时间', typeof listed.body.rooms[0].expiresAt, 'string');
  eq('列表不泄露席位密钥', /token/.test(JSON.stringify(listed.body)), false);

  const guestMe = await post('/api/users/login', { name: '列表客人' });
  await joinRoom(host, '列表客人');
  const guestList = await get('/api/me/rooms', { token: guestMe.body.token });
  eq('加入者也能列出该房间', guestList.body.rooms.length, 1);
  eq('加入者席位是 b', guestList.body.rooms[0].seat, 'b');
  eq('开局后不再有销毁时间', guestList.body.rooms[0].expiresAt, null);
  eq('开局后状态是 playing', guestList.body.rooms[0].status, 'playing');

  const dreamerHost = await createDreamer('列表用户', 'player', 'small');
  const afterDreamer = await get('/api/me/rooms', { token: me.body.token });
  const dreamerRow = afterDreamer.body.rooms.find(row => row.code === dreamerHost.code);
  eq('白日梦想家房间也进列表', Boolean(dreamerRow), true);
  eq('白日梦想家档位名带上', dreamerRow?.tierName, '小赌怡情');
}

// ---------------------------------------------------------------- 未开始的房间自动销毁
{
  const me = await post('/api/users/login', { name: '过期用户' });
  // 直接改行上的时间戳来模拟 5 分钟后的状态，不必真的等。
  const past = new Date(Date.now() - 6 * 60_000).toISOString();
  const stale = await newRoom('过期用户');
  const staleRow = backend.runtime.tables.rooms.find(row => row.code === stale.code);
  staleRow.created_at = past;
  staleRow.touched_at = past;
  eq('过期房间读状态返回 404', (await get('/api/rooms/state', { code: stale.code, token: stale.token })).status, 404);
  eq('过期房间主行已删除', backend.runtime.tables.rooms.some(row => row.code === stale.code), false);
  eq('过期房间轮次行一并删除', backend.runtime.tables.room_rounds.some(row => row.room_id === staleRow.id), false);
  eq('过期房间不在我的列表里',
    (await get('/api/me/rooms', { token: me.body.token })).body.rooms.some(row => row.code === stale.code), false);

  const staleDreamer = await createDreamer('过期用户', 'player', 'small');
  const staleGame = backend.runtime.tables.dreamer_games.find(row => row.code === staleDreamer.code);
  staleGame.created_at = past;
  staleGame.touched_at = past;
  eq('过期对局读状态返回 404',
    (await get('/api/dreamer/games/state', { code: staleDreamer.code, token: staleDreamer.token })).status, 404);
  eq('过期对局主行已删除', backend.runtime.tables.dreamer_games.some(row => row.code === staleDreamer.code), false);
  eq('过期对局箱子已删除', backend.runtime.tables.dreamer_boxes.some(row => row.game_id === staleGame.id), false);

  // 未到期的房间不能被误删；已开局的历史房间即使创建很久也不销毁。
  const fresh = await newRoom('过期用户');
  eq('刚建的房间仍可读', (await get('/api/rooms/state', { code: fresh.code, token: fresh.token })).status, 200);
  const played = await newRoom('过期用户');
  await joinRoom(played, '过期搭子');
  const playedRow = backend.runtime.tables.rooms.find(row => row.code === played.code);
  playedRow.created_at = past;
  playedRow.touched_at = past;
  eq('已开局房间不会过期', (await get('/api/rooms/state', { code: played.code, token: played.token })).status, 200);
}

// ---------------------------------------------------------------- 标准化用例
{
  const cases = JSON.parse(await readFile(fileURLToPath(new URL('./normalize-cases.json', import.meta.url)), 'utf8'));
  for (const item of cases) {
    const result = normalizeWord(item.input);
    eq(`normalize(${JSON.stringify(item.input)})`, result.norm, item.norm);
    eq(`ok(${JSON.stringify(item.input)})`, result.ok, item.norm.length > 0);
  }
  eq('非字符串输入不通过', normalizeWord(undefined).ok, false);
  eq('揭示时原词按 trim 保存', normalizeWord('  雨伞  ').raw, '雨伞');
}

await backend.close();
console.log(`\n${checks - failures.length}/${checks} 通过`);
if (failures.length) {
  console.error(`失败 ${failures.length} 项：\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
