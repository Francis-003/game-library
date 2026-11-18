// 同词遇见 · 业务路由。依赖注入只用于本地测试；index.ts 保留 Deno.serve。
// 席位身份由服务端比对 token 推导，绝不接受前端传来的 seat。
import { normalizeWord } from './shared/normalize.mjs';
import { builtinScenes, builtinSceneNames, pickScene } from './shared/scenes.mjs';
import {
  MAX_LINE, TIERS, isTier, baseOffer, offerWithinAdjust, remainingAmounts, shuffleLadder,
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

// 内部读取字段：token 只出现在这里，任何响应 DTO 都不转发它。
const ROOM_FIELDS = 'id,code,status,current_round,round_id,scene_text,scene_source,token_a,token_b,join_key_b,nick_a,nick_b,win_round,ended_by,version';
// 状态推进后重读用的字段，刻意不含 token。
const ROOM_PUBLIC_FIELDS = 'id,code,status,current_round,round_id,scene_text,scene_source,nick_a,nick_b,win_round,ended_by,version';
const ROUND_FIELDS = 'id,room_id,round_no,word_a,word_b,norm_a,norm_b,sealed_a,sealed_b,submitted_at_a,submitted_at_b';

// 白日梦想家：内部读取字段（含 token）；公开字段刻意不含 token。
const DREAMER_GAME_FIELDS = 'id,code,status,tier,banker_seat,token_a,token_b,join_key_b,nick_a,nick_b,round_no,lucky_box,final_pick,deal_taken,won_amount,version';
const DREAMER_GAME_PUBLIC_FIELDS = 'id,code,status,tier,banker_seat,nick_a,nick_b,round_no,lucky_box,final_pick,deal_taken,won_amount,version';

// 白日梦想家：箱子行与报价行的读取字段。
const DREAMER_BOX_FIELDS = 'id,game_id,box_no,amount,opened,opened_round';
const DREAMER_OFFER_FIELDS = 'id,game_id,round_no,base_amount,amount,line,decision';

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
    return found[0];
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
    return buildSeatView(room, round, rounds, seat);
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
    return found[0];
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
      // 参考价只在该银行家出价时下发；它本可由公开金额板与公开系数推出，下发只为省去前端复算。
      offerBase: roleOf(game, seat) === 'banker' && (phase === 'offer' || phase === 'final_offer')
        ? baseOffer(boxes, offers.length) : null,
      finalPick: game.final_pick || null,
    };
    if (revealed) {
      view.result = {
        dealt: Boolean(game.deal_taken),
        wonAmount: game.won_amount,
        luckyBox: game.lucky_box || null,
        luckyAmount: luckyBoxRow ? luckyBoxRow.amount : null,
        finalBoxNo: game.deal_taken ? null : (game.final_pick === 'swap' && restBoxes.length ? restBoxes[0].box_no : game.lucky_box),
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
    return buildDreamerView(game, boxes, offers, seat);
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

    // 无密码登录：名字即账号，先到先得。重名一律拒绝，不给冒名留口子。
    if (path === '/api/users/login' && request.method === 'POST') {
      const body = await input(request);
      const name = text(body.name);
      if (!name || !within(name, MAX_NICK)) fail('invalid_input', 400);
      const existing = rows(await db.from('users').select('id,name').eq('name', name).limit(1));
      if (existing.length) fail('name_taken', 409);
      const token = crypto.randomUUID();
      const created = rows(await db.from('users').insertIfAbsent({
        id: crypto.randomUUID(), name, token,
        last_seen: new Date().toISOString(), created_at: new Date().toISOString(),
      }, { onConflict: 'name' }).select('id,name,token'));
      // 并发撞名：插入落空说明同一瞬间别人先注册了同名的账号。
      if (!created.length) fail('name_taken', 409);
      return json({ name: created[0].name, token: created[0].token }, 201);
    }

    // 登录后的心跳+快照：每次拉取顺带刷新自己的在线时间，同时带走好友与邀请。
    if (path === '/api/me' && request.method === 'GET') {
      const me = await userByToken(text(query.get('token')));
      const now = Date.now();
      await db.from('users').update({ last_seen: new Date(now).toISOString() }).eq('id', me.id);
      const people = rows(await db.from('users').select('name,last_seen')
        .order('created_at').limit(FRIENDS_LIMIT));
      const friends = people
        .filter(person => person.name !== me.name)
        .map(person => ({ name: person.name, online: now - new Date(person.last_seen).getTime() < ONLINE_WINDOW_MS }));
      const inviteRows = rows(await db.from('invites').select('id,room_code,from_name,to_name,created_at')
        .eq('to_name', me.name).order('created_at', { ascending: false }).limit(INVITES_LIMIT));
      const invites = inviteRows
        .filter(row => now - new Date(row.created_at).getTime() < INVITE_TTL_MS)
        .map(row => ({ id: row.id, roomCode: row.room_code, fromName: row.from_name }));
      return json({ name: me.name, friends, invites });
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
      const nick = text(body.nick) || room[`nick_${seat}`] || '';
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      const created = await createRoom(nick);
      return json({ ...created, view: await viewFor(await loadRoom(created.code), 'a') }, 201);
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
      const { room, seat } = await authenticate(text(body.code), text(body.token));
      if (room.status !== 'waiting') fail('room_not_waiting', 409);
      const to = text(body.to);
      if (!to || !within(to, MAX_NICK)) fail('invalid_input', 400);
      if (to === text(room[`nick_${seat}`])) fail('invalid_input', 400);
      const target = rows(await db.from('users').select('id,name').eq('name', to).limit(1));
      if (!target.length) fail('not_found', 404);
      // 同一房间同一目标的未过期邀请视为幂等成功，不重复堆积。
      const existing = rows(await db.from('invites').select('id,created_at')
        .eq('room_code', room.code).eq('to_name', to).limit(5));
      const fresh = existing.find(row => Date.now() - new Date(row.created_at).getTime() < INVITE_TTL_MS);
      if (fresh) return json({ invite: { id: fresh.id, roomCode: room.code, toName: to } });
      const created = {
        id: crypto.randomUUID(), room_code: room.code,
        from_name: text(room[`nick_${seat}`]) || '好友', to_name: to,
        created_at: new Date().toISOString(),
      };
      rows(await db.from('invites').insert(created).select('id'));
      return json({ invite: { id: created.id, roomCode: room.code, toName: to } }, 201);
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
        if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0) fail('invalid_input', 400);
        amount = Math.round(body.amount * 100) / 100;
        if (!offerWithinAdjust(amount, base)) fail('offer_out_of_range', 400);
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

    // 再来一局：任意席位开新局，调用者成 seat a，档位与角色保持。
    if (path === '/api/dreamer/rematch' && request.method === 'POST') {
      const body = await input(request);
      const { game, seat } = await authenticateDreamer(text(body.code), text(body.token));
      const nick = text(body.nick) || game[`nick_${seat}`] || '';
      if (!within(nick, MAX_NICK)) fail('invalid_input', 400);
      const created = await createDreamerGame(nick, game.tier, roleOf(game, seat));
      return json({ ...created, view: await dreamerViewFor(await loadDreamerGame(created.code), 'a') }, 201);
    }

    fail('not_found', 404);
  };
}
