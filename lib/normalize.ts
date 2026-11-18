// 判定规则只有 functions/shared/normalize.mjs 这一份实现：前端 import 同一文件，
// 从源头上排除“两边规则漂移”。构建由 Vite 完成，打包器不需要解析这个跨目录导入。
export { normalizeWord } from "../functions/shared/normalize.mjs";
