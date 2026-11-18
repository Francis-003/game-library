// 词标准化：判定只看归一化结果，原词仅用于展示。
// 与 src/lib/normalize.ts 是同一套规则的两份实现（打包边界不共享代码），
// 由 dev/normalize-cases.json 同时驱动两侧断言，防止漂移。

const MAX_CODEPOINTS = 100;

// NFKC 之后再移除所有标点、符号、空白与控制类字符：中文标点、全角符号、emoji
// 一并去掉，避免“遇见。”与“遇见”被判为不同。
export function normalizeWord(value) {
  if (typeof value !== 'string') return { raw: '', norm: '', ok: false };
  const raw = value.trim();
  if (!raw || Array.from(raw).length > MAX_CODEPOINTS) return { raw, norm: '', ok: false };
  const norm = raw.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, '');
  return { raw, norm, ok: norm.length > 0 };
}
