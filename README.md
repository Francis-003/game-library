# 游戏库

一个可以持续上新小游戏集合的站点。收录「同词遇见」和「白日梦想家」。

## 同词遇见

只有两个人玩的默契游戏。两个人各说一个词，说中同一个词就叫"遇见"。

- 第 1 轮从场景库抽一个场景，两个人各想一个相关的词。
- 词不一样就进入下一轮：不再给场景，只能看着已经出现过的词，猜对方这一轮会说什么。
- 任何人提交后，对方都看不到；两个人都提交完成才一起揭开。
- 判定按标准化后的完全相同：忽略空格、标点、全半角与英文大小写。
- 不限轮数，任意一方可以随时结束本局。

## 白日梦想家

双人开箱排雷（Deal or No Deal 玩法）。一人当玩家、一人当银行家，**双方都不知道箱子里有多少钱**。

- 建局选档位（小赌怡情 10 箱 / 标准局 16 箱 / 综艺局 22 箱）和身份，金额由后端随机洗牌，加朋友复制链接加入。
- 玩家盲选一个幸运箱全程不打开；按轮翻开公共箱，开出的金额作废并上「金额板」（剩余金额公开）。
- 每轮开完银行家出价：可自由输入任意非负金额，或一键按参考价（剩余均值 × 档位系数）打底，可附一句心理战台词；玩家 Deal 成交或 No Deal 继续。
- 只剩幸运箱 + 最后一个公共箱时，银行家发最终报价；玩家拒绝后可保留或交换，当场揭晓输赢。
- 配置真源在 `functions/shared/dreamer.mjs`；三张表 `dreamer_games` / `dreamer_boxes` / `dreamer_offers`；页面在 `src/pages/dreamer/`。

## 游戏库结构

站点采用主流 App 的底部三 Tab 布局，Tab 页显示底栏，进入游戏后为沉浸式全屏（隐藏底栏、顶部返回）：

- `#/` — 首页 Tab：继续游戏、推荐游戏、口令快速加入、在线好友速览。
- `#/games` — 游戏库 Tab，列出 `src/games.ts` 注册表里的全部游戏。
- `#/me` — 我的信息 Tab：账号、进行中的房间（来自服务端，过期房间不会显示）、退出登录。
- `#/g/<id>` — 每个游戏一个命名空间（全屏页），游戏内部页面挂在它下面（如 `#/g/tongci/r/口令`、`#/g/tongci/scenes`）。
- 全站还是「同词遇见」独占时期的旧链接（`#/r/口令`、`#/j/口令`、`#/scenes`）会自动重定向进它的命名空间。

### 上新一个游戏

页面与规则写在自己的命名空间里，跨游戏的通用功能（邀请、再来一局）不用为新游戏重写。扩展点有三处：

1. `src/games.tsx` 的 `games` 数组加一条：`id`（路由命名空间）、名称、介绍、标签、图标，
   以及 `render(subPath)` —— 把 `#/g/<id>/` 之后的路径映射到该游戏的页面。
2. `lib/gameRegistry.ts` 的 `gameRegistry` 加一条：名称、加入接口 `join(code, joinKey, nick)`
   （返回可保存的会话）与房间链接 `roomHash(code)`。邀请接受、首页口令加入、「我的房间」链接
   都从这里取，新增游戏后自动支持。
3. 后端 `functions/routes.mjs` 的 `gameServices` 映射加一条：`auth`（按 token 验席位，统一返回
   `{ row, seat }`）、`isTerminal`（哪些状态算终局）、`restart`（就地重开）、`nameOf`、`view`。
   邀请与「再来一局」的双向确认接口全部经由这张映射，不含按游戏写死的分支。

页面文件放 `src/pages/<id>/`；游戏专属规则放 `functions/shared/`。等待页用共享的
`components/InviteFriendsCard.tsx` 邀请好友；结果页用 `components/RematchPrompt.tsx` +
`hooks/useRematch.ts` 接入双方确认的再来一局，无需各自实现。

> 注意：新增游戏若需要新数据表，迁移方言仅支持 CREATE TABLE，不支持 ALTER TABLE；
> 请在新表一次建好字段，并同步在 `dev/local.mjs` 与 `.zcode-site/stage/dev-memory.mjs`
> 的列白名单里加上它，否则本地/站点内存库会报 `invalid_column_*`。

## 本地开发

```sh
npm ci
npm run dev     # 前端 + 内存假后端，两个标签页就能对玩
```

`npm run dev` 打开的地址同时提供页面和 `/functions/v1/app` 接口，数据在内存里、重启即清空。
`/__local/` 是本地故障控制台，可以注入读取失败、提交响应丢失、房间状态版本冲突。

```sh
node dev/game-local.test.mjs   # 用真实业务路由跑游戏逻辑，无需云端资源
npm run build                  # tsc --noEmit + Vite 生产构建到 dist/
```

后端是 Qoder Sites 的单个 `app` Edge Function（Deno 运行时）。本机不需要装 Deno：
业务逻辑集中在 `functions/routes.mjs`，通过依赖注入在 Node 里用假数据库执行；
`functions/index.ts` 只做线上入口装配，其 Deno 兼容性只能在部署后验证。

## 目录

- `schema.sql` — 数据库结构，经审阅后的迁移应用到云端（不进 `functions/`）
- `functions/` — 线上函数：`index.ts` 入口、`routes.mjs` 业务路由、`shared/` 归一化、内置场景库与白日梦想家配置
- `components/`、`hooks/`、`lib/` — 界面组件、轮询 hook（含 `useDreamer`）、接口与本地会话（模板约定放项目根，`@` 别名指向根目录）
- `src/` — 入口、游戏库首页与游戏注册表（`src/games.tsx`），游戏页面在 `src/pages/`（含 `dreamer/`），构建产物在 `dist/`
- `dev/` — 本地假后端与测试，不属于任何上传目录

## 部署

发布与数据库迁移通过 Qoder Sites 的工具链完成：`ensure_backend`（`databaseAccessModel: function_backend`）
→ 审阅并应用 `schema.sql` 的迁移（含 `app.users` / `app.invites` / 白日梦想家的 `app.dreamer_games` / `app.dreamer_boxes` / `app.dreamer_offers`）→ `prepare_site`（`webDirectory: dist`、`functionDirectory: functions`、
`databaseAccess: read_write`、`schemaRef`、`spa:false`）→ `publish_site`。

## 保密与身份

- 全局用户身份：无密码登录，**用户名是唯一标识**：同名登录直接进入（复用原凭据），
  新名字自动创建账号，不存在「重名被拒」。登录时服务端下发一个 token 存在浏览器
  localStorage（`tongciyujian.user.v1`），下次进入免输；登录失效时界面会要求重新输入用户名。
  超过 **2 小时未登录（未心跳）** 的用户由登录/心跳顺带回收删除，同名再登录即新建账号。
- 好友 = 全部用户，自动互为好友，无需添加。在线 = 90 秒内有心跳：前端每 10 秒拉一次
  `/api/me`，顺带刷新自己的 last_seen。开房间（waiting 态）时两个游戏都可见在线好友并
  一键邀请；被邀请人在任何页面都会看到邀请条，点「进入」即走正常加入流程。
- 再来一局是**原房间就地重开 + 双方确认**：口令、双方席位与席位 token 都不变，只重置轮次/箱子/进度。
  一方点「再来一局」即算该方确认，进入等待；对方轮询看到提示后接受才一起进入新局，拒绝/退出则
  发起方收到「对方不来了」。双方各自点一次也直接开局。意图存在共享表 `app.rematch_requests`，
  60 秒未确认自动作废，不改动原对局表。
- 邀请 2 分钟自动过期，接受或忽略都会删除邀请行。冒充风险（知道用户名即可看到其在线状态、
  可向其发邀请）是有意接受的简化模型。
- 房间内身份不变：房主与加入者各持一个由服务端生成的席位密钥（存在浏览器 localStorage），
  口令只用于找到房间，密钥不进 URL。对手的词在双方都提交之前由服务端直接不返回，
  不是前端隐藏。
