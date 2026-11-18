import type { ReactNode } from "react";
import { activateSession } from "@/lib/session";
import { GameHome } from "./pages/tongci/GameHome";
import { RoomPage } from "./pages/RoomPage";
import { ScenesPage } from "./pages/ScenesPage";
import { DreamerHome } from "./pages/dreamer/DreamerHome";
import { DreamerRoom } from "./pages/dreamer/DreamerRoom";

// 游戏注册表：游戏库首页和 #/g/<id> 路由都由这里驱动。
// 上新一个游戏时：把它的页面加进 src/pages/，再往下面数组里加一条记录即可。
export type GameDefinition = {
  // 路由命名空间，游戏的所有页面都挂在 #/g/<id>/ 之下。
  id: string;
  name: string;
  tagline: string;
  meta: string;
  emoji: string;
  // subPath 是 "#/g/<id>" 之后的部分（已去掉首尾斜杠），空字符串是游戏入口页。
  // 返回 null 表示游戏内部不认识这个路径。
  render: (subPath: string) => ReactNode;
};

export const games: GameDefinition[] = [
  {
    id: "tongci",
    name: "同词遇见",
    tagline: "只有两个人玩的默契游戏：各自说一个词，说中同一个词，就算遇见。",
    meta: "双人 · 文字 · 默契",
    emoji: "💬",
    render: (subPath) => {
      const room = subPath.match(/^(?:r|j)\/([A-Za-z0-9]{6})$/i);
      if (room) return <RoomPage key={room[1].toUpperCase()} code={room[1].toUpperCase()} />;
      if (subPath === "scenes") return <ScenesPage />;
      if (!subPath) {
        return (
          <GameHome
            onEntered={session => {
              activateSession(session.code);
              window.location.hash = `#/g/tongci/r/${session.code}`;
            }}
          />
        );
      }
      return null;
    },
  },
  {
    id: "dreamer",
    name: "白日梦想家",
    tagline: "双人开箱排雷：盲选幸运箱，一轮轮开箱压价，见好就收还是赌到底？",
    meta: "双人 · 开箱 · 心理战",
    emoji: "🎁",
    render: (subPath) => {
      const room = subPath.match(/^r\/([A-Za-z0-9]{6})$/i);
      if (room) return <DreamerRoom key={room[1].toUpperCase()} code={room[1].toUpperCase()} />;
      if (!subPath) return <DreamerHome />;
      return null;
    },
  },
];

export function findGame(id: string): GameDefinition | undefined {
  return games.find(game => game.id === id);
}
