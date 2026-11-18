import type { Seat, UserAuth } from "./types";

export type Session = {
  code: string;
  seat: Seat;
  token: string;
  // 同词遇见的旧数据没有 game 字段，读取时按 tongci 处理。
  game?: string;
  // 加入者预生成的恢复凭据：席位密钥只由服务端下发，一旦“加入成功”的响应丢失，
  // 靠它才能取回原来的席位而不是被判定为第三人占位。
  joinKey: string | null;
  nick: string;
};

type Store = { active: string | null; rooms: Record<string, Session> };

const KEY = "tongciyujian.session.v1";
const EMPTY: Store = { active: null, rooms: {} };

// tongci 沿用裸 code 作键（兼容旧数据），其他游戏用 game:code 复合键防跨游戏口令碰撞。
const DEFAULT_GAME = "tongci";
function storeKey(game: string | undefined, code: string) {
  return (!game || game === DEFAULT_GAME) ? code : `${game}:${code}`;
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.rooms !== "object") return EMPTY;
    return { active: typeof parsed.active === "string" ? parsed.active : null, rooms: parsed.rooms as Record<string, Session> };
  } catch {
    return EMPTY;
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 隐私模式下写入会抛错：本次会话仍然可玩，只是刷新后需要重新输入口令。
  }
}

export function loadSession(code?: string, game = DEFAULT_GAME): Session | null {
  const store = read();
  const target = code ? storeKey(game, code) : store.active;
  if (!target) return null;
  const session = store.rooms[target];
  return session && typeof session.token === "string" ? session : null;
}

export function saveSession(session: Session) {
  const store = read();
  store.rooms[storeKey(session.game, session.code)] = session;
  store.active = storeKey(session.game, session.code);
  write(store);
}

export function activateSession(code: string, game = DEFAULT_GAME) {
  const store = read();
  const key = storeKey(game, code);
  if (store.rooms[key]) {
    store.active = key;
    write(store);
  }
}

export function forgetSession(code: string, game = DEFAULT_GAME) {
  const store = read();
  const key = storeKey(game, code);
  delete store.rooms[key];
  if (store.active === key) store.active = null;
  write(store);
}

// 「我的信息」页用的本地房间记录：只列仍有席位凭据的会话，对象键序即加入顺序。
export function listSessions(): Session[] {
  const store = read();
  return Object.values(store.rooms).filter(session => typeof session?.token === "string");
}

export function newJoinKey(): string {
  return crypto.randomUUID();
}

const NICK_KEY = "tongciyujian.nick.v1";

// 昵称不是身份凭据，只是为了让界面少问一次；席位凭据始终只有服务端下发的 token。
export function lastNick(): string {
  try {
    return localStorage.getItem(NICK_KEY)?.slice(0, 12) ?? "";
  } catch {
    return "";
  }
}

// ---- 全局用户身份：无密码登录，token 记住在本地 ----

const USER_KEY = "tongciyujian.user.v1";

export function loadUser(): UserAuth | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserAuth>;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.name !== "string" || !parsed.name || typeof parsed.token !== "string" || !parsed.token) return null;
    return { name: parsed.name, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveUser(user: UserAuth) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // 隐私模式下保存失败：本次会话仍可用，刷新后需重新输入用户名。
  }
}

export function clearUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // 忽略清理失败。
  }
}
