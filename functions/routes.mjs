// 同词遇见 · 业务路由。依赖注入只用于本地测试；index.ts 保留 Deno.serve。
// 席位身份由服务端比对 token 推导，绝不接受前端传来的 seat。
import { normalizeWord } from './shared/normalize.mjs';
import { builtinScenes, builtinSceneNames, pickScene } from './shared/scenes.mjs';
import {
  MAX_LINE, TIERS, isTier, baseOffer, rawAverage, remainingAmounts, shuffleLadder,
} from './shared/dreamer.mjs';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 6;
const MAX_NICK = 12;
const MAX_SCENE_NAME = 12;
const HISTORY_LIMIT = 64;
const SCENES_LIMIT = 500;
// 好友在线 = 90 秒内有心跳；超过 2 分钟的邀请自动作废。
const ONLINE_WINDOW_MS = 90_000;
const INVITE_TTL_MS = 120_000;
const FRIENDS_LIMIT = 200;
const INVITES_LIMIT = 20;
// 未开始的对局超过这个时间自动销毁。轮询不续命：否则房主挂着页面就永远不会过期。
const WAITING_TTL_MS = 5 * 60_000;
// 单次清理上限：心跳每 10 秒跑一次，积压的房间分几轮清完即可。
const SWEEP_LIMIT = 50;
// 用户超过 2 小时未登录（心跳）自动删除。线上没有 cron，借登录/心跳触发回收。
const USER_TTL_MS = 2 * 60 * 60_000;

// 内部读取字段：token 只出现在这里，任何响应 DTO 都不转发它。
const ROOM_FIELDS = 'id,code,status,current_round,round_id,scene_text,scene_source,token_a,token_b,join_key_b,nick_a,nick_b,win_round,ended_by,version,created_at,touched_at';
// 状态推进后重读用的字段，刻意不含 token。
const ROOM_PUBLIC_FIELDS = 'id,code,status,current_round,round_id,scene_text,scene_source,nick_a,nick_b,win_round,ended_by,version,created_at,touched_at';
const ROUND_FIELDS = 'id,room_id,round_no,word_a,word_b,norm_a,norm_b,sealed_a,sealed_b,submitted_at_a,submitted_at_b';

// 白日梦想家：内部读取字段（含 token）；公开字段刻意不含 token。
const DREAMER_GAME_FIELDS = 'id,code,status,tier,banker_seat,token_a,token_b,join_key_b,nick_a,nick_b,round_no,lucky_box,final_pick,deal_taken,won_amount,version,created_at,touched_at';
const DREAMER_GAME_PUBLIC_FIELDS = 'id,code,status,tier,banker_seat,nick_a,nick_b,round_no,lucky_box,final_pick,deal_taken,won_amount,version,created_at,touched_at';

// 白日梦想家：箱子行与报价行的读取字段。
const DREAMER_BOX_FIELDS = 'id,game_id,box_no,amount,opened,opened_round';
const DREAMER_OFFER_FIELDS = 'id,game_id,round_no,base_amount,amount,line,decision';

// 金额保留两位小数。对极大的有限数，先 ×100 再 ÷100 会溢出成 Infinity，
// 而 Infinity 经 JSON 序列化会变成 null，污染报价历史与结算视图。
// 这种量级下 IEEE754 双精度本就没有两位小数精度，直接返回原值即为正确结果。
function roundMoney(value) {
  if (!Number.isFinite(value)) return value;
  const scaled = value * 100;
  return Number.isFinite(scaled) ? Math.round(scaled) / 100 : value;
}

export function application({ db, BackendError }) {
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = result => {
    if (result.error) fail(result.error.code, result.error.status);
    return result.data ?? [];
  };
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const text = value => (typeof value === 'string' ? value.trim() : '');
  const within = (value, max) => Array.from(value).length <= max;
  const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

  async function input(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) { await reader.cancel(); fail('payload_too_large', 413); }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('invalid_input', 400); }
  }

  function newCode() {
    const buffer = new Uint32Array(CODE_LENGTH);
    crypto.getRandomValues(buffer);
    let code = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[buffer[index] % CODE_ALPHABET.length];
    return code;
  }

  async function loadRoom(code, fields = ROOM_FIELDS) {
    const found = rows(await db.from('rooms').select(fields).eq('code', code).limit(1));
    // 口令错误与房间不存在返回同一个结果，不给口令枚举留出旁路信号。
    if (!found.length) fail('not_found', 404);
    const room = found[0];
    // 过期房间当场销毁并报 not_found：与「从来没有过这个口令」完全同形，不泄露房间存在过。
    if (isLapsed(room)) {
      await destroyRoom(room);
      fail('not_found', 404);
    }
    return room;
  }

  // 未开始的对局超过 TTL 视为作废。基准取 touched_at（真实操作会顺延），
  // 轮询读状态不续命——否则房主挂着页面这间房就永远不会被回收。
  function isLapsed(row) {
    if (row.status !== 'waiting') return false;
    const since = Date.parse(row.touched_at ?? row.created_at ?? '');
    return Number.isFinite(since) && Date.now() - since > WAITING_TTL_MS;
  }

  // 前端展示「还有几分钟自动销毁」用的绝对时间戳（ISO），不依赖客户端时钟偏差之外的东西。
  function expiresAtOf(row) {
    const since = Date.parse(row.touched_at ?? row.created_at ?? '');
    if (!Number.isFinite(since)) return null;
    return new Date(since + WAITING_TTL_MS).toISOString();
  }

  // 先删子行再删主行：schema 里没有 ON DELETE CASCADE，反序会撞外键。
  async function destroyRoom(room) {
    rows(await db.from('room_rounds').delete().eq('room_id', room.id).select('id'));
    rows(await db.from('rooms').delete().eq('id', room.id).select('id'));
  }

  async function destroyDreamerGame(game) {
    rows(await db.from('dreamer_boxes').delete().eq('game_id', game.id).select('id'));
    rows(await db.from('dreamer_offers').delete().eq('game_id', game.id).select('id'));
    rows(await db.from('dreamer_games').delete().eq('id', game.id).select('id'));
  }

  // 回收过期房间：只取 waiting 的行，按 touched_at 升序，遇到第一个未过期的就可以停。
  // 心跳接口与建房前各跑一次，不额外依赖定时任务（线上没有 cron）。
  async function sweepExpired() {
    const now = Date.now();
    const since = now - WAITING_TTL_MS;
    const staleRooms = rows(await db.from('rooms').select('id,code,status,touched_at,created_at')
      .eq('status', 'waiting').order('touched_at').limit(SWEEP_LIMIT));
    for (const room of staleRooms) {
      const touched = Date.parse(room.touched_at ?? room.created_at ?? '');
      if (!Number.isFinite(touched) || touched >= since) break;
      await destroyRoom(room);
    }
    const staleGames = rows(await db.from('dreamer_games').select('id,code,status,touched_at,created_at')
      .eq('status', 'waiting').order('touched_at').limit(SWEEP_LIMIT));
    for (const game of staleGames) {
      const touched = Date.parse(game.touched_at ?? game.created_at ?? '');
      if (!Number.isFinite(touched) || touched >= since) break;
      await destroyDreamerGame(game);
    }
  }

  // 回收 2 小时未登录（未心跳）的用户。用户是「名字即账号」，没有密码，
  // 删掉后同名重新登录会作为新用户创建，天然满足「不活跃即删除」。
  // 顺带清理发给该用户的邀请，避免残留脏数据。线上没有 cron，借登录/心跳触发。
  async function sweepStaleUsers() {
    const since = Date.now() - USER_TTL_MS;
    const stale = rows(await db.from('users').select('id,name,last_seen,created_at')
      .order('last_seen').limit(SWEEP_LIMIT));
    for (const person of stale) {
      const seen = Date.parse(person.last_seen ?? person.created_at ?? '');
      if (!Number.isFinite(seen) || seen >= since) break;
      rows(await db.from('invites').delete().eq('to_name', person.name).select('id'));
      rows(await db.from('users').delete().eq('id', person.id).select('id'));
    }
  }

  async function ensureRound(roomId, roundNo, id = crypto.randomUUID()) {
    const created = {
      id, room_id: roomId, round_no: roundNo,
      word_a: '', word_b: '', norm_a: '', norm_b: '',
      sealed_a: false, sealed_b: false,
      submitted_at_a: null, submitted_at_b: null, created_at: new Date().toISOString(),
    };
    rows(await db.from('room_rounds').insertIfAbsent(created, { onConflict: 'room_id,round_no' }).select('id'));
    const found = rows(await db.from('room_rounds').select(ROUND_FIELDS)
      .eq('room_id', roomId).eq('round_no', roundNo).limit(1));
    if (!found.length) fail('db_unavailable', 503);
    return found[0];
  }

  // 当前轮行缺失时按房间记录的 round_id 补建，让房间可继续而不必重开。
  async function loadRound(room) {
    const found = rows(await db.from('room_rounds').select(ROUND_FIELDS).eq('id', room.round_id).limit(1));
    if (found.length) return found[0];
    return ensureRound(room.id, room.current_round, room.round_id);
  }

  function seatOf(room, token) {
    if (typeof token !== 'string' || !token) return null;
    if (room.token_a === token) return 'a';
    if (room.token_b && room.token_b === token) return 'b';
    return null;
  }

  // 席位校验一律读全字段（含 token），调用方只拿到推导出的 seat。
  async function authenticate(code, token) {
    if (typeof code !== 'string' || code.length !== CODE_LENGTH) fail('not_found', 404);
    const room = await loadRoom(code);
    const seat = seatOf(room, token);
    if (!seat) fail('not_a_seat', 403);
    return { room, seat };
  }

  // 全局用户身份校验：token 是登录时下发一次的身份凭据，绝不回传给前端。
  async function userByToken(token) {
    if (typeof token !== 'string' || !token) fail('invalid_token', 403);
    const found = rows(await db.from('users').select('id,name,token,last_seen')
      .eq('token', token).limit(1));
    if (!found.length) fail('invalid_token', 403);
    return found[0];
  }

  async function scenePool() {
    const custom = rows(await db.from('custom_scenes').select('name').eq('enabled', true).limit(SCENES_LIMIT));
    return [
      ...builtinScenes.map(scene => ({ text: scene.name, source: 'builtin' })),
      ...custom.map(scene => ({ text: scene.name, source: 'custom' })),
    ];
  }

  // 只有 round_no < current_round 的行才进历史，而它们必然已双方揭示，因此原词可安全返回。
  function historyOf(rounds, currentRound) {
    return rounds
      .filter(round => round.round_no < currentRound)
      .map(round => ({
        round: round.round_no,
        wordA: round.word_a,
        wordB: round.word_b,
        matched: round.norm_a === round.norm_b,
      }));
  }

  // 显式白名单拼字段，绝不 spread 数据库行。未揭示时对手的词根本不出现在响应里。
  // 揭示判据取“双方都已封存”这一条产品规则本身，而不是状态推进的结果：并发揭示时
  // rooms.status 可能还滞后在 playing，依赖它就会误判为尚未揭示。
  function buildSeatView(room, round, rounds, seat) {
    const opponent = seat === 'a' ? 'b' : 'a';
    const revealed = round.sealed_a && round.sealed_b;
    const matched = revealed && round.norm_a === round.norm_b;
    const view = {
      code: room.code,
      rev: room.version,
      seat,
      status: room.status,
      round: room.current_round,
      scene: room.current_round === 1 && room.scene_text
        ? { text: room.scene_text, source: room.scene_source }
        : null,
      myNick: room[`nick_${seat}`] || null,
      opponentNick: room[`nick_${opponent}`] || null,
      mySealed: Boolean(round[`sealed_${seat}`]),
      opponentSealed: Boolean(round[`sealed_${opponent}`]),
      myWord: round[`sealed_${seat}`] ? round[`word_${seat}`] : null,
      history: historyOf(rounds, room.current_round),
    };
    if (revealed) {
      view.opponentWord = round[`word_${opponent}`];
      view.matched = matched;
      if (matched) view.winRound = round.round_no;
    }
    if (room.status === 'ended') view.endedBy = room.ended_by || null;
    return view;
  }

  async function viewFor(room, seat, knownRound) {
    const round = knownRound ?? await loadRound(room);
    const rounds = rows(await db.from('room_rounds').select(ROUND_FIELDS)
      .eq('room_id', room.id).order('round_no').limit(HISTORY_LIMIT));
    const view = buildSeatView(room, round, rounds, seat);
    // 再来一局意图：终局才有意义，但这里统一附带，由前端按状态决定是否展示。
    view.rematch = await rematchInfoFor('tongci', room, seat);
    return view;
  }

  async function createRoom(nick) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const scene = pickScene(await scenePool());
    if (!scene) fail('no_scene_available', 503);
    const token = crypto.randomUUID();
    let code = '';
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt += 1) {
      const inserted = rows(await db.from('rooms').insertIfAbsent({
        id, code: newCode(), status: 'waiting', current_round: 1, round_id: roundId,
        scene_text: scene.text, scene_source: scene.source,
        token_a: token, token_b: '', join_key_b: '',
        nick_a: nick, nick_b: '', win_round: 0, ended_by: '',
        version: 1, created_at: now, touched_at: now,
      }, { onConflict: 'code' }).select('id,code'));
      if (inserted.length) code = inserted[0].code;
    }
    if (!code) fail('db_unavailable', 503);
    // 房间行先落库，再按预生成的 id 补第 1 轮行，避免指向不存在房间的轮行。
    await ensureRound(id, 1, roundId);
    return { code, seat: 'a', token };
  }

  // 再来一局：原房间就地重开，口令与双方席位/凭据都不变，只重置轮次、场景和状态。
  // 双方客户端轮询的是同一个 code，谁都能看到新的一局，不会出现「新房口令没发给对手、
  // 对手还停在已结束旧房」的脱节。CAS 防双方同时点重开时重复重置；落空的一方
  // 读回权威状态，若已变成本局的新状态就幂等当作成功。
  async function restartRoom(room) {
    const now = new Date().toISOString();
    const roundId = crypto.randomUUID();
    const scene = pickScene(await scenePool());
    if (!scene) fail('no_scene_available', 503);
    // CAS 守卫取「版本未变 + 仍是终局」：双方同时点重开时只有一方能推进，
    // 另一方读回权威状态，看到已是本局的新状态就幂等当作成功，不再碰子行。
    const updated = rows(await db.from('rooms').update({
      status: 'playing', current_round: 1, round_id: roundId,
      scene_text: scene.text, scene_source: scene.source,
      win_round: 0, ended_by: '',
      version: room.version + 1, touched_at: now,
    }).eq('id', room.id).eq('version', room.version)
      .select(ROOM_PUBLIC_FIELDS));
    if (!updated.length) {
      const fresh = await loadRoom(room.code, ROOM_PUBLIC_FIELDS);
      if (fresh.status === 'playing' && fresh.version > room.version) return fresh;
      fail('version_conflict', 409);
    }
    // 状态推进成功后再重置轮次；中途轮询若读到旧 round_id，loadRound 会按 current_round 自愈。
    rows(await db.from('room_rounds').delete().eq('room_id', room.id).select('id'));
    await ensureRound(room.id, 1, roundId);
    return updated[0];
  }

  // ===== 白日梦想家 =====

  // 从 token 推导席位；语义与 authenticate 一致（404 防枚举、403 非席位）。
  async function authenticateDreamer(code, token) {
    if (typeof code !== 'string' || code.length !== CODE_LENGTH) fail('not_found', 404);
    const game = await loadDreamerGame(code);
    const seat = seatOf(game, token);
    if (!seat) fail('not_a_seat', 403);
    return { game, seat };
  }

  async function loadDreamerGame(code, fields = DREAMER_GAME_FIELDS) {
    const found = rows(await db.from('dreamer_games')
      .select(fields).eq('code', code).limit(1));
    if (!found.length) fail('not_found', 404);
    const game = found[0];
    // 与同词遇见同语义：过期即销毁，响应与「从来没有过」无法区分。
    if (isLapsed(game)) {
      await destroyDreamerGame(game);
      fail('not_found', 404);
    }
    return game;
  }

  function roleOf(game, seat) {
    return game.banker_seat === seat ? 'banker' : 'player';
  }

  // 由 game + boxes + offers 推导 phase（不落库）：
  // pick_lucky → opening ⇄ offer → decide → … → final_offer → final_decide → final_pick → ended
  function dreamerPhase(game, boxes, offers) {
    if (game.status === 'waiting') return 'waiting';
    if (game.status === 'ended') return 'ended';
    if (!game.lucky_box) return 'pick_lucky';
    const tier = TIERS[game.tier];
    const currentOffer = offers.find(offer => offer.round_no === game.round_no) ?? null;
    if (game.round_no > tier.schedule.length) {
      if (!currentOffer) return 'final_offer';
      if (currentOffer.decision === '') return 'final_decide';
      if (currentOffer.decision === 'no_deal') return 'final_pick';
      return 'ended';
    }
    const openedThisRound = boxes.filter(
      box => box.opened && box.opened_round === game.round_no,
    ).length;
    if (openedThisRound < tier.schedule[game.round_no - 1]) return 'opening';
    if (!currentOffer) return 'offer';
    return 'decide';
  }

  // 显式白名单拼视图，绝不 spread 数据库行。未开箱的金额绝不进响应（终局揭开才可见）。
  function buildDreamerView(game, boxes, offers, seat) {
    const tier = TIERS[game.tier];
    const opponent = seat === 'a' ? 'b' : 'a';
    const phase = dreamerPhase(game, boxes, offers);
    const revealed = game.status === 'ended';
    const openedThisRound = boxes.filter(
      box => box.opened && box.opened_round === game.round_no,
    ).length;
    const currentOfferRow = offers.find(offer => offer.round_no === game.round_no) ?? null;
    const luckyBoxRow = game.lucky_box
      ? boxes.find(box => box.box_no === game.lucky_box) : null;
    const restBoxes = revealed && !game.deal_taken
      ? boxes.filter(box => !box.opened && box.box_no !== game.lucky_box) : [];
    const view = {
      code: game.code,
      rev: game.version,
      seat,
      role: roleOf(game, seat),
      status: game.status,
      phase,
      tier: game.tier,
      tierName: tier.name,
      boxCount: tier.boxCount,
      myNick: game[`nick_${seat}`] || null,
      opponentNick: game[`nick_${opponent}`] || null,
      roundNo: game.round_no,
      openingsLeft: phase === 'opening'
        ? tier.schedule[game.round_no - 1] - openedThisRound : 0,
      luckyBox: game.lucky_box || null,
      boxes: boxes.map(box => ({
        no: box.box_no,
        opened: Boolean(box.opened),
        // 保密核心：未开且未揭开的箱子金额一律 null。
        amount: box.opened || revealed ? box.amount : null,
        openedRound: box.opened ? box.opened_round : null,
      })),
      remainingAmounts: revealed ? [] : remainingAmounts(boxes),
      offers: offers.map(offer => ({
        roundNo: offer.round_no,
        amount: offer.amount,
        base: offer.base_amount,
        line: offer.line || null,
        decision: offer.decision || null,
      })),
      currentOffer: currentOfferRow && currentOfferRow.decision === ''
        ? { roundNo: currentOfferRow.round_no, amount: currentOfferRow.amount, line: currentOfferRow.line || null }
        : null,
      // 出价提示：未翻面额均值 + 系数参考价，都只在银行家出价阶段下发（前端可自行从金额板算出）。
      offerBase: roleOf(game, seat) === 'banker' && (phase === 'offer' || phase === 'final_offer')
        ? baseOffer(boxes, offers.length) : null,
      averageLeft: roleOf(game, seat) === 'banker' && (phase === 'offer' || phase === 'final_offer')
        ? rawAverage(boxes) : null,
      finalPick: game.final_pick || null,
    };
    if (revealed) {
      const finalBoxNo = game.deal_taken ? null
        : (game.final_pick === 'swap' && restBoxes.length ? restBoxes[0].box_no : game.lucky_box);
      const finalBoxRow = finalBoxNo ? boxes.find(box => box.box_no === finalBoxNo) : null;
      const luckyAmount = luckyBoxRow ? luckyBoxRow.amount : 0;
      // 净收益模型：P = 银行家买断幸运箱的钱（中途成交取成交价，开箱到底取最后一轮银行家报价）；
      // V = 幸运箱真实面额。玩家净收益 = P − V，银行家净收益 = V − P（两者恒相反）。
      // 例：P=800、V=520 → 玩家 +280（赚）、银行家 −280（赔）；反之玩家赔、银行家赚。
      const p = game.deal_taken ? game.won_amount : (offers.length ? offers[offers.length - 1].amount : game.won_amount);
      const playerGain = p - luckyAmount;
      view.result = {
        dealt: Boolean(game.deal_taken),
        // P 与 V 下发供双方结果页各自展示「银行家出价 / 幸运箱面额 / 净收益」。
        p: roundMoney(p),
        luckyAmount: roundMoney(luckyAmount),
        // 两方净收益符号相反：一方为正（赚），另一方为负（赔）。
        playerGain: roundMoney(playerGain),
        bankerGain: roundMoney(-playerGain),
        luckyBox: game.lucky_box || null,
        finalBoxNo,
        finalAmount: finalBoxRow ? finalBoxRow.amount : null,
        dealAmount: game.deal_taken ? game.won_amount : null,
      };
    }
    return view;
  }

  async function loadBoxes(gameId) {
    return rows(await db.from('dreamer_boxes')
      .select(DREAMER_BOX_FIELDS).eq('game_id', gameId).order('box_no').limit(100));
  }

  async function loadOffers(gameId) {
    return rows(await db.from('dreamer_offers')
      .select(DREAMER_OFFER_FIELDS).eq('game_id', gameId).order('round_no').limit(100));
  }

  async function dreamerViewFor(game, seat) {
    const boxes = await loadBoxes(game.id);
    const offers = await loadOffers(game.id);
    const view = buildDreamerView(game, boxes, offers, seat);
    view.rematch = await rematchInfoFor('dreamer', game, seat);
    return view;
  }

  // 建局：游戏行先落库（口令冲突重试），再按预生成 id 补箱子行。
  async function createDreamerGame(nick, tierKey, role) {
    const tier = TIERS[tierKey];
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const bankerSeat = role === 'banker' ? 'a' : 'b';
    let code = '';
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt += 1) {
      const inserted = rows(await db.from('dreamer_games').insertIfAbsent({
        id, code: newCode(), status: 'waiting', tier: tierKey, banker_seat: bankerSeat,
        token_a: token, token_b: '', join_key_b: '', nick_a: nick, nick_b: '',
        round_no: 0, lucky_box: 0, final_pick: '', deal_taken: false, won_amount: 0,
        version: 1, created_at: now, touched_at: now,
      }, { onConflict: 'code' }).select('id,code'));
      if (inserted.length) code = inserted[0].code;
    }
    if (!code) fail('db_unavailable', 503);
    const ladder = shuffleLadder(tier.ladder);
    for (let no = 1; no <= tier.boxCount; no += 1) {
      rows(await db.from('dreamer_boxes').insert({
        id: crypto.randomUUID(), game_id: id, box_no: no, amount: ladder[no - 1],
        opened: false, opened_round: 0, created_at: now,
      }).select('id'));
    }
    return { code, seat: 'a', token };
  }

  // 再来一局：原对局就地重开。口令、双方席位/token、档位与角色都不变，
  // 重新洗牌金额箱、清空报价/进度。对手轮询同一个 code 就能看到新局，
  // 避免「新房口令没发过去、对手留在旧房」的脱节。
  async function restartDreamerGame(game) {
    const tier = TIERS[game.tier];
    const now = new Date().toISOString();
    // CAS 先推游戏行：双方同时点重开时只有一方生效，另一方读回权威状态幂等返回，
    // 绝不再次删箱/报价，否则会抹掉对方刚建好的新局。
    const updated = rows(await db.from('dreamer_games').update({
      status: 'playing', round_no: 1, lucky_box: 0, final_pick: '',
      deal_taken: false, won_amount: 0,
      version: game.version + 1, touched_at: now,
    }).eq('id', game.id).eq('version', game.version).select(DREAMER_GAME_PUBLIC_FIELDS));
    if (!updated.length) {
      const fresh = await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
      if (fresh.status === 'playing' && fresh.version > game.version) return fresh;
      fail('version_conflict', 409);
    }
    rows(await db.from('dreamer_boxes').delete().eq('game_id', game.id).select('id'));
    rows(await db.from('dreamer_offers').delete().eq('game_id', game.id).select('id'));
    const ladder = shuffleLadder(tier.ladder);
    for (let no = 1; no <= tier.boxCount; no += 1) {
      rows(await db.from('dreamer_boxes').insert({
        id: crypto.randomUUID(), game_id: game.id, box_no: no, amount: ladder[no - 1],
        opened: false, opened_round: 0, created_at: now,
      }).select('id'));
    }
    return updated[0];
  }

  // ===== 再来一局确认：跨游戏共用 =====
  // 一方发起即视为该方已确认；另一方接受才就地重开，拒绝/退出则发起方收到通知。
  // 不在原表加列（迁移方言不支持 ALTER），意图单独存 rematch_requests 表。
  const REMATCH_TTL_MS = 60_000;
  const gameServices = {
    tongci: {
      // 统一返回 { row, seat }，让邀请/再赛的调用方不必关心每个游戏的行字段名。
      auth: async (code, token) => {
        const { room, seat } = await authenticate(code, token);
        return { row: room, seat };
      },
      isTerminal: row => row.status === 'ended' || row.status === 'matched',
      restart: restartRoom,
      nameOf: (row, seat) => text(row[`nick_${seat}`]),
      view: (row, seat) => viewFor(row, seat),
    },
    dreamer: {
      auth: async (code, token) => {
        const { game, seat } = await authenticateDreamer(code, token);
        return { row: game, seat };
      },
      isTerminal: row => row.status === 'ended',
      restart: restartDreamerGame,
      nameOf: (row, seat) => text(row[`nick_${seat}`]),
      view: (row, seat) => dreamerViewFor(row, seat),
    },
  };
  function rematchService(game) {
    return gameServices[game === 'dreamer' ? 'dreamer' : 'tongci'];
  }

  // 清洗过期确认意图：重开/拒绝/作废后都应清掉，避免旧 pending 影响下一局。
  async function clearRematchRequests(game, code) {
    rows(await db.from('rematch_requests').delete().eq('game', game).eq('room_code', code).select('id'));
  }

  // 读取该房间当前有效的确认意图（只认未过期、未消费的 pending）。
  async function activeRematch(game, code) {
    const found = rows(await db.from('rematch_requests').select(
      'id,game,room_code,from_seat,to_seat,from_name,status,created_at,touched_at',
    ).eq('game', game).eq('room_code', code).eq('status', 'pending').order('created_at').limit(5));
    const now = Date.now();
    const fresh = found.find(request => {
      const since = Date.parse(request.touched_at ?? request.created_at ?? '');
      return Number.isFinite(since) && now - since <= REMATCH_TTL_MS;
    });
    // 过期的意图顺手清掉，避免脏数据长期堆积。
    for (const request of found) {
      if (request === fresh) continue;
      rows(await db.from('rematch_requests').delete().eq('id', request.id).select('id'));
    }
    return fresh ?? null;
  }

  // 给某席位生成它看到的再来一局状态：
  // - 发起方看到 waiting；
  // - 接收方看到 incoming（可确认/拒绝）；
  // - 对方拒绝/退出后，发起方看到 declined，直到它清掉/重新发起。
  async function rematchInfoFor(game, row, seat) {
    const pending = await activeRematch(game, row.code);
    if (pending) {
      return {
        status: pending.from_seat === seat ? 'waiting' : 'incoming',
        fromSeat: pending.from_seat,
        fromName: pending.from_name,
      };
    }
    // 最近的拒绝记录只给发起方看：按 from_seat 精确过滤，接收方不会误看到别人的拒绝。
    const declined = rows(await db.from('rematch_requests').select(
      'id,from_seat,to_seat,status,touched_at,created_at',
    ).eq('game', game).eq('room_code', row.code).eq('status', 'declined')
      .eq('from_seat', seat).order('touched_at', { ascending: false }).limit(1));
    if (declined.length) {
      return { status: 'declined', fromSeat: declined[0].from_seat, fromName: '' };
    }
    return null;
  }

  // 一方确认的落库写入：UNIQUE(game,room_code,from_seat) 保证幂等。
  async function putRematchRequest(game, row, fromSeat) {
    const now = new Date().toISOString();
    const request = {
      id: crypto.randomUUID(), game, room_code: row.code,
      from_seat: fromSeat, to_seat: fromSeat === 'a' ? 'b' : 'a',
      from_name: text(row[`nick_${fromSeat}`]) || '好友',
      status: 'pending', created_at: now, touched_at: now,
    };
    const inserted = rows(await db.from('rematch_requests').insertIfAbsent(request, {
      onConflict: 'game,room_code,from_seat',
    }).select('id,status'));
    if (inserted.length) return inserted[0];
    // 已存在：把旧行复位为 pending（可能是 declined / 过期 pending）。
    const updated = rows(await db.from('rematch_requests').update({
      status: 'pending', touched_at: now,
      from_name: request.from_name, to_seat: request.to_seat,
    }).eq('game', game).eq('room_code', row.code).eq('from_seat', fromSeat)
      .select('id,status'));
    return updated[0] ?? null;
  }

  async function markRematch(game, code, fromSeat, status) {
    rows(await db.from('rematch_requests').update({
      status, touched_at: new Date().toISOString(),
    }).eq('game', game).eq('room_code', code).eq('from_seat', fromSeat).select('id'));
  }

  function sceneDto(row) {
    return {
      id: row.id, name: row.name, addedBy: row.added_by || null,
      enabled: Boolean(row.enabled), createdAt: row.created_at ?? null,
    };
  }

  return async ctx => {
    const request = ctx.request;
    // Gateway 保留后缀但把 app 换成部署的物理函数名；Provider 可能在调用前剥掉
    // /functions/v1。两种形态都要能匹配出业务子路径。
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';
    const query = url.searchParams;

    if (path === '/api/health' && request.method === 'GET') return json({ ok: true });

    // 无密码登录：用户名即账号的唯一标识。同名直接进入（复用原凭据），不存在则新建。
    // 超过 2 小时未登录的用户在登录/心跳时被回收，回收后同名登录等同新建。
    if (path === '/api/users/login' && request.method === 'POST') {
      const body = await input(request);
      const name = text(body.name);
      if (!name || !within(name, MAX_NICK)) fail('invalid_input', 400);
      // 先回收不活跃用户：这个名字可能刚刚过期，应当作为新账号重新创建。
      await sweepStaleUsers();
      const now = new Date().toISOString();
      const existing = rows(await db.from('users').select('id,name,token').eq('name', name).limit(1));
      if (existing.length) {
        // 用户名相同即同一人：刷新活跃时间并返回原凭据，任何设备输入这个名字都是这个账号。
        await db.from('users').update({ last_seen: now }).eq('id', existing[0].id);
        return json({ name: existing[0].name, token: existing[0].token });
      }
      const token = crypto.randomUUID();
      const created = rows(await db.from('users').insertIfAbsent({
        id: crypto.randomUUID(), name, token,
        last_seen: now, created_at: now,
      }, { onConflict: 'name' }).select('id,name,token'));
      // 并发撞名：插入落空说明同一瞬间别人先注册了，按「同名直接进入」取回既有账号。
      if (!created.length) {
        const raced = rows(await db.from('users').select('id,name,token').eq('name', name).limit(1));
        if (!raced.length) fail('db_unavailable', 503);
        await db.from('users').update({ last_seen: now }).eq('id', raced[0].id);
        return json({ name: raced[0].name, token: raced[0].token });
      }
      return json({ name: created[0].name, token: created[0].token }, 201);
    }

    // 登录后的心跳+快照：每次拉取顺带刷新自己的在线时间，同时带走好友与邀请。
    if (path === '/api/me' && request.method === 'GET') {
      const me = await userByToken(text(query.get('token')));
      const now = Date.now();
      await db.from('users').update({ last_seen: new Date(now).toISOString() }).eq('id', me.id);
      // 借在线心跳顺带回收：过期房间 + 2 小时未登录的用户。线上没有 cron。
      await sweepExpired();
      await sweepStaleUsers();
      const people = rows(await db.from('users').select('name,last_seen')
        .order('created_at').limit(FRIENDS_LIMIT));
      const friends = people
        .filter(person => person.name !== me.name)
        .map(person => ({ name: person.name, online: now - new Date(person.last_seen).getTime() < ONLINE_WINDOW_MS }));
      const inviteRows = rows(await db.from('invites').select('id,room_code,game,from_name,to_name,created_at')
        .eq('to_name', me.name).order('created_at', { ascending: false }).limit(INVITES_LIMIT));
      const invites = inviteRows
        .filter(row => now - new Date(row.created_at).getTime() < INVITE_TTL_MS)
        .map(row => ({ id: row.id, roomCode: row.room_code, game: row.game || 'tongci', fromName: row.from_name }));
      return json({ name: me.name, friends, invites });
    }

    // 我在进行中的房间：首页下半部分的数据源。
    // 身份只靠昵称匹配（与全站「名字即账号、好友=全部用户」的简化模型一致），
    // 因此只返回房间口令等公开信息，席位凭据仍然只在本地 localStorage。
    if (path === '/api/me/rooms' && request.method === 'GET') {
      const me = await userByToken(text(query.get('token')));
      await sweepExpired();
      const mine = [];
      // 同词遇见：房主与加入者分开查，eq 是唯一可用的过滤方式。
      for (const [seat, field] of [['a', 'nick_a'], ['b', 'nick_b']]) {
        const found = rows(await db.from('rooms').select(ROOM_PUBLIC_FIELDS)
          .eq(field, me.name).order('touched_at', { ascending: false }).limit(20));
        for (const room of found) {
          if (room.status !== 'waiting' && room.status !== 'playing') continue;
          const opponent = seat === 'a' ? 'b' : 'a';
          mine.push({
            code: room.code, game: 'tongci', status: room.status, seat,
            myNick: room[`nick_${seat}`] || null,
            opponentNick: room[`nick_${opponent}`] || null,
            roundNo: room.current_round,
            tierName: null,
            createdAt: room.created_at ?? null,
            expiresAt: room.status === 'waiting' ? expiresAtOf(room) : null,
          });
        }
      }
      for (const [seat, field] of [['a', 'nick_a'], ['b', 'nick_b']]) {
        const found = rows(await db.from('dreamer_games').select(DREAMER_GAME_PUBLIC_FIELDS)
          .eq(field, me.name).order('touched_at', { ascending: false }).limit(20));
        for (const game of found) {
          if (game.status !== 'waiting' && game.status !== 'playing') continue;
          const opponent = seat === 'a' ? 'b' : 'a';
          mine.push({
            code: game.code, game: 'dreamer', status: game.status, seat,
            myNick: game[`nick_${seat}`] || null,
            opponentNick: game[`nick_${opponent}`] || null,
            roundNo: game.round_no,
            tierName: TIERS[game.tier]?.name ?? null,
            createdAt: game.created_at ?? null,
            expiresAt: game.status === 'waiting' ? expiresAtOf(game) : null,
          });
        }
      }
      // 新的排前面；同一个 code 在不同游戏里不会重复（显示时按 game 分开）。
      mine.sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''));
      return json({ rooms: mine.slice(0, 20) });
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      const body = await input(request);
      const nick = text(body.nick);
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      const created = await createRoom(nick);
      return json({ ...created, view: await viewFor(await loadRoom(created.code), 'a') }, 201);
    }

    if (path === '/api/rooms/join' && request.method === 'POST') {
      const body = await input(request);
      const nick = text(body.nick);
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      if (!uuid(body.joinKey)) fail('invalid_input', 400);
      const room = await loadRoom(text(body.code));
      // 加入响应丢失后的自愈：同一个 joinKey 取回原来的席位密钥。
      if (room.join_key_b === body.joinKey && room.token_b) {
        return json({ code: room.code, seat: 'b', token: room.token_b, view: await viewFor(room, 'b') });
      }
      if (room.token_b) fail('seat_taken', 409);
      const token = crypto.randomUUID();
      const updated = rows(await db.from('rooms').update({
        token_b: token, join_key_b: body.joinKey, nick_b: nick,
        status: 'playing', version: room.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', room.id).eq('version', room.version).eq('token_b', '').select(ROOM_FIELDS));
      if (!updated.length) {
        const fresh = await loadRoom(room.code);
        if (fresh.join_key_b === body.joinKey && fresh.token_b) {
          return json({ code: fresh.code, seat: 'b', token: fresh.token_b, view: await viewFor(fresh, 'b') });
        }
        fail('seat_taken', 409);
      }
      return json({ code: updated[0].code, seat: 'b', token, view: await viewFor(updated[0], 'b') }, 201);
    }

    if (path === '/api/rooms/state' && request.method === 'GET') {
      const { room, seat } = await authenticate(text(query.get('code')), text(query.get('token')));
      // 与写接口同形：所有房间响应都是 { view }，客户端只需处理一种结构。
      return json({ view: await viewFor(room, seat) });
    }

    if (path === '/api/rooms/submit' && request.method === 'POST') {
      const body = await input(request);
      const { room, seat } = await authenticate(text(body.code), text(body.token));
      const word = normalizeWord(body.word);
      if (!word.ok) fail('invalid_input', 400);
      const round = await loadRound(room);
      if (room.status !== 'playing') {
        // 提交响应丢失后的重试：若本轮其实已双方揭示，就幂等返回揭示结果，
        // 而不是让客户端收到一个需要二次解释的 409。
        if (round.sealed_a && round.sealed_b) {
          return json({ sealed: true, revealed: true, view: await viewFor(room, seat, round) });
        }
        fail('round_not_open', 409);
      }
      const now = new Date().toISOString();
      const sealed = rows(await db.from('room_rounds').update({
        [`word_${seat}`]: word.raw, [`norm_${seat}`]: word.norm,
        [`sealed_${seat}`]: true, [`submitted_at_${seat}`]: now,
      }).eq('id', round.id).eq(`sealed_${seat}`, false).select(ROUND_FIELDS));
      let current = sealed[0];
      if (!current) {
        const existing = rows(await db.from('room_rounds').select(ROUND_FIELDS).eq('id', round.id).limit(1));
        if (!existing.length) fail('db_unavailable', 503);
        current = existing[0];
        // 同一个词重复提交视为幂等成功（响应丢失后客户端重发），改词一律拒绝。
        if (current[`norm_${seat}`] !== word.norm) fail('word_locked', 409);
      }
      if (!(current.sealed_a && current.sealed_b)) {
        return json({ sealed: true, view: await viewFor(room, seat, current) });
      }
      const matched = current.norm_a === current.norm_b;
      const advanced = rows(await db.from('rooms').update({
        status: matched ? 'matched' : 'revealed',
        win_round: matched ? current.round_no : 0,
        version: room.version + 1, touched_at: now,
      }).eq('id', room.id).eq('version', room.version).eq('status', 'playing').select(ROOM_PUBLIC_FIELDS));
      // 推进失败说明另一路径已完成揭示：读权威状态，绝不重放写。
      const authoritative = advanced[0] ?? await loadRoom(room.code, ROOM_PUBLIC_FIELDS);
      return json({ sealed: true, revealed: true, view: await viewFor(authoritative, seat, current) });
    }

    if (path === '/api/rooms/next-round' && request.method === 'POST') {
      const body = await input(request);
      const { room, seat } = await authenticate(text(body.code), text(body.token));
      const round = await loadRound(room);
      const bothSealed = round.sealed_a && round.sealed_b;
      // 双方都点“下一轮”时后到的一方看到的已是新一轮：幂等返回当前视图，不写库。
      if (room.status === 'playing' && !bothSealed) return json({ view: await viewFor(room, seat) });
      if (!bothSealed) fail('round_not_open', 409);
      if (room.status === 'matched' || room.status === 'ended') fail('round_not_open', 409);
      const roundNo = room.current_round + 1;
      // 先插后推：插行成功而 CAS 失败只留下一个无害的未来轮行；反过来无法自愈。
      const next = await ensureRound(room.id, roundNo);
      // 守卫取“当前轮指针未移动”而不是 status：揭示那次状态写入丢失时 status 会滞后
      // 在 playing，用 status 做谓词会让双方都看得见揭示却再也开不了下一轮。
      const updated = rows(await db.from('rooms').update({
        current_round: roundNo, round_id: next.id, status: 'playing',
        version: room.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', room.id).eq('version', room.version).eq('round_id', room.round_id).select(ROOM_PUBLIC_FIELDS));
      const authoritative = updated[0] ?? await loadRoom(room.code, ROOM_PUBLIC_FIELDS);
      return json({ view: await viewFor(authoritative, seat) });
    }

    if (path === '/api/rooms/finish' && request.method === 'POST') {
      const body = await input(request);
      const { room, seat } = await authenticate(text(body.code), text(body.token));
      if (room.status === 'matched' || room.status === 'ended') fail('round_not_open', 409);
      const updated = rows(await db.from('rooms').update({
        status: 'ended', ended_by: seat, version: room.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', room.id).eq('version', room.version).select(ROOM_PUBLIC_FIELDS));
      const authoritative = updated[0] ?? await loadRoom(room.code, ROOM_PUBLIC_FIELDS);
      return json({ view: await viewFor(authoritative, seat) });
    }

    if (path === '/api/rooms/rematch' && request.method === 'POST') {
      const body = await input(request);
      const { room, seat } = await authenticate(text(body.code), text(body.token));
      // 只有已结束（命中 / 主动结束）的房间能再来一局；进行中的房间不该被重置。
      if (room.status !== 'ended' && room.status !== 'matched') fail('phase_wrong', 409);
      const restarted = await restartRoom(room);
      await clearRematchRequests('tongci', room.code);
      // 口令、席位和 token 都不变：对手轮询同一个 code 就能看到新的一局。
      return json({ code: restarted.code, seat, view: await viewFor(restarted, seat) });
    }

    if (path === '/api/scenes' && request.method === 'GET') {
      await authenticate(text(query.get('code')), text(query.get('token')));
      const custom = rows(await db.from('custom_scenes').select('id,name,added_by,enabled,created_at')
        .order('created_at', { ascending: false }).limit(SCENES_LIMIT));
      return json({ builtin: builtinScenes, custom: custom.map(sceneDto) });
    }

    // 邀请好友进入 waiting 中的房间：发起者必须是房间席位，目标必须是已注册用户。
    if (path === '/api/invites' && request.method === 'POST') {
      const body = await input(request);
      // game 决定去哪张表验席位：口令在两个游戏里都可能存在，不能只查同词遇见。
      // 席位校验统一走 gameServices（与再来一局共用同一张游戏服务映射）。
      const game = body.game === 'dreamer' ? 'dreamer' : 'tongci';
      const svc = rematchService(game);
      const to = text(body.to);
      if (!to || !within(to, MAX_NICK)) fail('invalid_input', 400);
      const { row, seat } = await svc.auth(text(body.code), text(body.token));
      const code = row.code;
      const nick = svc.nameOf(row, seat) || '好友';
      if (row.status !== 'waiting') fail('room_not_waiting', 409);
      if (to === nick) fail('invalid_input', 400);
      const target = rows(await db.from('users').select('id,name').eq('name', to).limit(1));
      if (!target.length) fail('not_found', 404);
      // 同一房间同一目标的未过期邀请视为幂等成功，不重复堆积。
      // 用 room_code + game 一起定位，否则两个游戏撞码时会误判成同一间房。
      const existing = rows(await db.from('invites').select('id,room_code,game,created_at')
        .eq('room_code', code).eq('game', game).limit(5));
      const fresh = existing.find(row => Date.now() - new Date(row.created_at).getTime() < INVITE_TTL_MS);
      if (fresh) return json({ invite: { id: fresh.id, roomCode: code, game, toName: to } });
      const created = {
        id: crypto.randomUUID(), room_code: code, game,
        from_name: nick, to_name: to,
        created_at: new Date().toISOString(),
      };
      rows(await db.from('invites').insert(created).select('id'));
      return json({ invite: { id: created.id, roomCode: code, game, toName: to } }, 201);
    }

    // 领取（进入房间）或忽略之后删除邀请：只删发给自己的，别人的邀请动不了。
    if (path === '/api/invites/dismiss' && request.method === 'POST') {
      const body = await input(request);
      const me = await userByToken(text(body.token));
      if (!uuid(body.id)) fail('invalid_input', 400);
      rows(await db.from('invites').delete().eq('id', body.id).eq('to_name', me.name).select('id'));
      return json({});
    }

    if (path === '/api/scenes/add' && request.method === 'POST') {
      const body = await input(request);
      const { seat } = await authenticate(text(body.code), text(body.token));
      const name = text(body.name);
      if (!name || !within(name, MAX_SCENE_NAME)) fail('invalid_input', 400);
      if (builtinSceneNames.includes(name)) fail('scene_exists', 409);
      const existing = rows(await db.from('custom_scenes').select('id,name,added_by,enabled').eq('name', name).limit(1));
      if (existing.length) {
        // 同名只是重新启用，不新建第二条。
        if (existing[0].enabled) return json({ scene: sceneDto(existing[0]) });
        const revived = rows(await db.from('custom_scenes').update({ enabled: true })
          .eq('id', existing[0].id).eq('enabled', false).select('id,name,added_by,enabled'));
        if (!revived.length) fail('version_conflict', 409);
        return json({ scene: sceneDto(revived[0]) });
      }
      const created = rows(await db.from('custom_scenes').insertIfAbsent({
        id: crypto.randomUUID(), name, added_by: seat, enabled: true, created_at: new Date().toISOString(),
      }, { onConflict: 'name' }).select('id,name,added_by,enabled'));
      if (!created.length) fail('scene_exists', 409);
      return json({ scene: sceneDto(created[0]) }, 201);
    }

    if (path === '/api/scenes/toggle' && request.method === 'POST') {
      const body = await input(request);
      await authenticate(text(body.code), text(body.token));
      if (!uuid(body.id) || typeof body.enabled !== 'boolean') fail('invalid_input', 400);
      const updated = rows(await db.from('custom_scenes').update({ enabled: body.enabled })
        .eq('id', body.id).select('id,name,added_by,enabled'));
      if (!updated.length) fail('not_found', 404);
      return json({ scene: sceneDto(updated[0]) });
    }

    // ===== 白日梦想家路由 =====

    // 建局：昵称 + 身份（player/banker）+ 档位。
    if (path === '/api/dreamer/games' && request.method === 'POST') {
      const body = await input(request);
      const nick = text(body.nick);
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      if (!isTier(body.tier)) fail('invalid_input', 400);
      if (body.role !== 'player' && body.role !== 'banker') fail('invalid_input', 400);
      const created = await createDreamerGame(nick, body.tier, body.role);
      return json({ ...created, view: await dreamerViewFor(await loadDreamerGame(created.code), 'a') }, 201);
    }

    // 加入对局：joinKey 自愈语义与同词遇见一致——响应丢失后同 joinKey 重发直接取回席位密钥。
    if (path === '/api/dreamer/games/join' && request.method === 'POST') {
      const body = await input(request);
      const nick = text(body.nick);
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      if (!uuid(body.joinKey)) fail('invalid_input', 400);
      const game = await loadDreamerGame(text(body.code));
      if (game.join_key_b === body.joinKey && game.token_b) {
        return json({ code: game.code, seat: 'b', token: game.token_b, view: await dreamerViewFor(game, 'b') });
      }
      if (game.token_b) fail('seat_taken', 409);
      const token = crypto.randomUUID();
      const updated = rows(await db.from('dreamer_games').update({
        token_b: token, join_key_b: body.joinKey, nick_b: nick,
        status: 'playing', version: game.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', game.id).eq('version', game.version).eq('token_b', '').select(DREAMER_GAME_FIELDS));
      if (!updated.length) {
        const fresh = await loadDreamerGame(game.code);
        if (fresh.join_key_b === body.joinKey && fresh.token_b) {
          return json({ code: fresh.code, seat: 'b', token: fresh.token_b, view: await dreamerViewFor(fresh, 'b') });
        }
        fail('seat_taken', 409);
      }
      return json({ code: updated[0].code, seat: 'b', token, view: await dreamerViewFor(updated[0], 'b') }, 201);
    }

    // 与同词遇见同形：所有读都是 { view }，一种结构处理到底。
    if (path === '/api/dreamer/games/state' && request.method === 'GET') {
      const { game, seat } = await authenticateDreamer(text(query.get('code')), text(query.get('token')));
      return json({ view: await dreamerViewFor(game, seat) });
    }

    // 选幸运箱：玩家专属，phase=pick_lucky，CAS 守卫 lucky_box=0。
    if (path === '/api/dreamer/pick-lucky' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (roleOf(game, seat) !== 'player') fail('role_mismatch', 403);
      if (game.status !== 'playing' || game.lucky_box) fail('phase_wrong', 409);
      const boxNo = body.boxNo;
      if (!Number.isInteger(boxNo) || boxNo < 1 || boxNo > TIERS[game.tier].boxCount) fail('invalid_input', 400);
      const updated = rows(await db.from('dreamer_games').update({
        lucky_box: boxNo, round_no: 1, version: game.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', game.id).eq('version', game.version).eq('lucky_box', 0)
        .select(DREAMER_GAME_PUBLIC_FIELDS));
      const authoritative = updated[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
      return json({ view: await dreamerViewFor(authoritative, seat) });
    }

    // 开箱：玩家专属，phase=opening。开箱只写箱子行（CAS opened=false），
    // 轮次进度从箱子行推导，避免「箱行已开但游戏行进度没推进」的双写不一致。
    if (path === '/api/dreamer/open' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (roleOf(game, seat) !== 'player') fail('role_mismatch', 403);
      if (game.status !== 'playing' || !game.lucky_box) fail('phase_wrong', 409);
      const boxNo = body.boxNo;
      if (!Number.isInteger(boxNo) || boxNo < 1 || boxNo > TIERS[game.tier].boxCount) fail('invalid_input', 400);
      const boxes = await loadBoxes(game.id);
      const offers = await loadOffers(game.id);
      if (dreamerPhase(game, boxes, offers) !== 'opening') fail('phase_wrong', 409);
      const box = boxes.find(item => item.box_no === boxNo);
      if (!box) fail('invalid_input', 404);
      // 响应丢失后的重试：本轮刚开的同一箱幂等返回当前视图。
      if (box.opened && box.opened_round === game.round_no) {
        return json({ view: await dreamerViewFor(game, seat) });
      }
      if (box.opened || box.box_no === game.lucky_box) fail('box_unavailable', 409);
      const updatedBox = rows(await db.from('dreamer_boxes').update({
        opened: true, opened_round: game.round_no,
      }).eq('id', box.id).eq('opened', false).select(DREAMER_BOX_FIELDS));
      if (!updatedBox.length) {
        const fresh = await loadBoxes(game.id);
        const committed = fresh.find(item => item.box_no === boxNo);
        if (committed && committed.opened && committed.opened_round === game.round_no) {
          return json({ view: await dreamerViewFor(game, seat) });
        }
        fail('box_unavailable', 409);
      }
      return json({ view: await dreamerViewFor(game, seat) });
    }

    // 报价：银行家专属。先插 offers 行（UNIQUE 幂等）再推游戏行版本，先插后推可自愈。
    if (path === '/api/dreamer/offer' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (roleOf(game, seat) !== 'banker') fail('role_mismatch', 403);
      const boxes = await loadBoxes(game.id);
      const offers = await loadOffers(game.id);
      const phase = dreamerPhase(game, boxes, offers);
      if (phase !== 'offer' && phase !== 'final_offer') fail('phase_wrong', 409);
      const base = baseOffer(boxes, offers.length);
      let amount = base;
      if (body.amount != null) {
        // 出价可为任意非负金额，不做区间限制；只拒绝非数字/负值/无穷。
        if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0) fail('invalid_input', 400);
        amount = roundMoney(body.amount);
      }
      const line = text(body.line ?? '');
      if (!within(line, MAX_LINE)) fail('invalid_input', 400);
      const now = new Date().toISOString();
      const inserted = rows(await db.from('dreamer_offers').insertIfAbsent({
        id: crypto.randomUUID(), game_id: game.id, round_no: game.round_no,
        base_amount: base, amount, line, decision: '', created_at: now,
      }, { onConflict: 'game_id,round_no' }).select(DREAMER_OFFER_FIELDS));
      if (!inserted.length) {
        const existing = rows(await db.from('dreamer_offers').select(DREAMER_OFFER_FIELDS)
          .eq('game_id', game.id).eq('round_no', game.round_no).limit(1));
        if (!existing.length) fail('db_unavailable', 503);
        if (existing[0].decision !== '') fail('offer_already_sent', 409);
        return json({ view: await dreamerViewFor(game, seat) });
      }
      const advanced = rows(await db.from('dreamer_games').update({
        version: game.version + 1, touched_at: now,
      }).eq('id', game.id).eq('version', game.version).eq('round_no', game.round_no)
        .select(DREAMER_GAME_PUBLIC_FIELDS));
      const authoritative = advanced[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
      return json({ view: await dreamerViewFor(authoritative, seat) });
    }

    // 玩家决定 Deal / No Deal。决定与推进分两步 CAS：重试会补上丢失的推进，不重放决定。
    if (path === '/api/dreamer/decide' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (roleOf(game, seat) !== 'player') fail('role_mismatch', 403);
      if (typeof body.deal !== 'boolean') fail('invalid_input', 400);
      const boxes = await loadBoxes(game.id);
      const offers = await loadOffers(game.id);
      const phase = dreamerPhase(game, boxes, offers);
      if (phase !== 'decide' && phase !== 'final_decide') fail('phase_wrong', 409);
      const currentOffer = offers.find(offer => offer.round_no === game.round_no);
      if (!currentOffer) fail('phase_wrong', 409);
      if (currentOffer.decision !== '' && body.deal !== (currentOffer.decision === 'deal')) {
        fail('decision_made', 409);
      }
      const decided = rows(await db.from('dreamer_offers').update({
        decision: body.deal ? 'deal' : 'no_deal',
      }).eq('id', currentOffer.id).eq('decision', '').select(DREAMER_OFFER_FIELDS));
      if (!decided.length) {
        const fresh = await loadOffers(game.id);
        const row = fresh.find(offer => offer.round_no === game.round_no);
        if (!row || row.decision === '') fail('db_unavailable', 503);
        if (body.deal !== (row.decision === 'deal')) fail('decision_made', 409);
      }
      const now = new Date().toISOString();
      if (body.deal) {
        const ended = rows(await db.from('dreamer_games').update({
          status: 'ended', deal_taken: true, won_amount: currentOffer.amount,
          version: game.version + 1, touched_at: now,
        }).eq('id', game.id).eq('version', game.version).eq('status', 'playing')
          .select(DREAMER_GAME_PUBLIC_FIELDS));
        const authoritative = ended[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
        return json({ view: await dreamerViewFor(authoritative, seat) });
      }
      if (game.round_no > TIERS[game.tier].schedule.length) {
        // 终局拒绝：不推进轮次，phase 变为 final_pick。
        const bumped = rows(await db.from('dreamer_games').update({
          version: game.version + 1, touched_at: now,
        }).eq('id', game.id).eq('version', game.version).eq('round_no', game.round_no)
          .select(DREAMER_GAME_PUBLIC_FIELDS));
        const authoritative = bumped[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
        return json({ view: await dreamerViewFor(authoritative, seat) });
      }
      const advanced = rows(await db.from('dreamer_games').update({
        round_no: game.round_no + 1, version: game.version + 1, touched_at: now,
      }).eq('id', game.id).eq('version', game.version).eq('round_no', game.round_no)
        .select(DREAMER_GAME_PUBLIC_FIELDS));
      const authoritative = advanced[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
      return json({ view: await dreamerViewFor(authoritative, seat) });
    }

    // 终局保留或交换：玩家专属，phase=final_pick。揭开全部箱子，赢得最终所持箱的金额。
    if (path === '/api/dreamer/final-pick' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (roleOf(game, seat) !== 'player') fail('role_mismatch', 403);
      if (body.choice !== 'keep' && body.choice !== 'swap') fail('invalid_input', 400);
      const boxes = await loadBoxes(game.id);
      const offers = await loadOffers(game.id);
      if (dreamerPhase(game, boxes, offers) !== 'final_pick') fail('phase_wrong', 409);
      if (game.final_pick && game.final_pick !== body.choice) fail('decision_made', 409);
      const lucky = boxes.find(box => box.box_no === game.lucky_box);
      const lastPublic = boxes.filter(box => !box.opened && box.box_no !== game.lucky_box)[0];
      if (!lucky || !lastPublic) fail('db_unavailable', 503);
      const won = body.choice === 'keep' ? lucky.amount : lastPublic.amount;
      const updated = rows(await db.from('dreamer_games').update({
        final_pick: body.choice, won_amount: won, status: 'ended',
        version: game.version + 1, touched_at: new Date().toISOString(),
      }).eq('id', game.id).eq('version', game.version).eq('status', 'playing')
        .eq('final_pick', '').select(DREAMER_GAME_PUBLIC_FIELDS));
      const authoritative = updated[0] ?? await loadDreamerGame(game.code, DREAMER_GAME_PUBLIC_FIELDS);
      return json({ view: await dreamerViewFor(authoritative, seat) });
    }

    // 再来一局：任一席位就地重开原对局（兼容旧客户端；新客户端走 /api/rematch/* 双向确认）。
    // 兼容路径仍保留「一方点击立即开局」语义，仅用于还在用旧包的客户端。
    if (path === '/api/dreamer/rematch' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      if (game.status !== 'ended') fail('phase_wrong', 409);
      const restarted = await restartDreamerGame(game);
      await clearRematchRequests('dreamer', game.code);
      return json({ code: restarted.code, seat, view: await dreamerViewFor(restarted, seat) });
    }

    // ===== 再来一局 · 双方确认（跨游戏共用） =====
    // 一方发起即算该方确认，写 pending；对方接受才就地重开，拒绝/退出则通知发起方。
    if (path === '/api/rematch/request' && request.method === 'POST') {
      const body = await input(request);
      const svc = rematchService(body.game);
      const { row, seat } = await svc.auth(text(body.code), text(body.token));
      if (!svc.isTerminal(row)) fail('phase_wrong', 409);
      const game = body.game === 'dreamer' ? 'dreamer' : 'tongci';
      // 幂等：本人已 pending 直接读回，不重复写。
      const pending = await activeRematch(game, row.code);
      if (pending && pending.from_seat === seat) {
        return json({ code: row.code, seat, view: await svc.view(row, seat) });
      }
      // 对方已发起：本方再点「再来一局」即是接受，双方确认立即开局。
      if (pending && pending.to_seat === seat) {
        await clearRematchRequests(game, row.code);
        const restarted = await svc.restart(row);
        return json({ code: restarted.code, seat, started: true, view: await svc.view(restarted, seat) });
      }
      await putRematchRequest(game, row, seat);
      return json({ code: row.code, seat, view: await svc.view(row, seat) });
    }

    if (path === '/api/rematch/respond' && request.method === 'POST') {
      const body = await input(request);
      if (typeof body.accept !== 'boolean') fail('invalid_input', 400);
      const svc = rematchService(body.game);
      const { row, seat } = await svc.auth(text(body.code), text(body.token));
      if (!svc.isTerminal(row)) fail('phase_wrong', 409);
      const game = body.game === 'dreamer' ? 'dreamer' : 'tongci';
      const pending = await activeRematch(game, row.code);
      if (!pending || pending.to_seat !== seat) fail('phase_wrong', 409);
      if (body.accept) {
        await clearRematchRequests(game, row.code);
        const restarted = await svc.restart(row);
        return json({ code: restarted.code, seat, started: true, view: await svc.view(restarted, seat) });
      }
      await markRematch(game, row.code, pending.from_seat, 'declined');
      return json({ code: row.code, seat, view: await svc.view(row, seat) });
    }

    // 退出房间/放弃再赛：把与自己相关的 pending 标记为 declined，让对方收到通知。
    // 对方已接受、正在重开时调用，可能读不到终局状态——这里只操作意图表，不校验房间相位。
    if (path === '/api/rematch/leave' && request.method === 'POST') {
      const body = await input(request);
      const svc = rematchService(body.game);
      const { row, seat } = await svc.auth(text(body.code), text(body.token));
      const game = body.game === 'dreamer' ? 'dreamer' : 'tongci';
      const pending = await activeRematch(game, row.code);
      if (pending && pending.from_seat === seat) {
        // 发起方自己取消：直接清掉，双方都回到普通终局。
        await clearRematchRequests(game, row.code);
        return json({ code: row.code, seat, view: await svc.view(row, seat) });
      }
      if (pending && pending.to_seat === seat) {
        // 接收方退出：标记拒绝，发起方轮询看到 declined。
        await markRematch(game, row.code, pending.from_seat, 'declined');
        return json({ code: row.code, seat, view: await svc.view(row, seat) });
      }
      // 没有 pending：发起方可能是想清掉「对方不来了」的提示（知道了/取消）。
      if (!pending) {
        rows(await db.from('rematch_requests').delete().eq('game', game)
          .eq('room_code', row.code).eq('from_seat', seat).select('id'));
      }
      return json({ code: row.code, seat, view: await svc.view(row, seat) });
    }

    fail('not_found', 404);
  };
}
