import { api } from "@/lib/api";
import { newJoinKey, type Session } from "@/lib/session";

// 跨游戏共享元数据与操作的单一来源。新增游戏时在这里加一条，邀请接受、
// 快速加入、房间链接、再来一局等通用功能就自动支持，不再为每款游戏写分支。
export type GameId = "tongci" | "dreamer";

export type GameDescriptor = {
  id: GameId;
  name: string;
  // 加入房间：各游戏立席位、下发凭据的接口不同，统一成返回可保存的会话。
  join: (code: string, joinKey: string, nick: string) => Promise<Session>;
  // 房间在 hash 路由里的地址。
  roomHash: (code: string) => string;
};

export const gameRegistry: Record<GameId, GameDescriptor> = {
  tongci: {
    id: "tongci",
    name: "同词遇见",
    join: async (code, joinKey, nick) => {
      const result = await api.joinRoom(code, joinKey, nick);
      return { code: result.code, seat: result.seat, token: result.token, joinKey, nick, game: "tongci" };
    },
    roomHash: code => `#/g/tongci/r/${code}`,
  },
  dreamer: {
    id: "dreamer",
    name: "白日梦想家",
    join: async (code, joinKey, nick) => {
      const result = await api.dreamerJoin(code, joinKey, nick);
      return { code: result.code, seat: result.seat, token: result.token, joinKey, nick, game: "dreamer" };
    },
    roomHash: code => `#/g/dreamer/r/${code}`,
  },
};

export const GAME_IDS = Object.keys(gameRegistry) as GameId[];

// 服务端/老数据里缺省的 game 一律按同词遇见处理，与历史行为一致。
export function asGameId(value: string | undefined | null): GameId {
  return value === "dreamer" ? "dreamer" : "tongci";
}

export function gameName(value: string | undefined | null): string {
  return gameRegistry[asGameId(value)].name;
}

// 按口令依次尝试各游戏加入（首页只有一个口令输入框，不知道属于哪款游戏）。
// 返回 null 表示所有游戏里都没有这个口令。
export async function joinAnyGame(code: string, nick: string): Promise<Session | null> {
  for (const id of GAME_IDS) {
    try {
      return await gameRegistry[id].join(code, newJoinKey(), nick);
    } catch (error) {
      // 只有 not_found 才试下一个游戏；席位已满、网络错误等要如实抛出。
      if (error instanceof Error && (error as { code?: string }).code === "not_found") continue;
      throw error;
    }
  }
  return null;
}
