// 内置场景库：随 app.zip 打包，不进前端产物。前端通过 /api/scenes 读取展示。
// 场景只用于第 1 轮破冰，第 2 轮起改为纯联想猜心。

export const builtinScenes = [
  { name: '深夜便利店', category: '地点·时刻' },
  { name: '末班地铁', category: '地点·时刻' },
  { name: '清早菜市场', category: '地点·时刻' },
  { name: '医院走廊', category: '地点·时刻' },
  { name: '火车站候车厅', category: '地点·时刻' },
  { name: '老图书馆', category: '地点·时刻' },
  { name: '天台', category: '地点·时刻' },
  { name: '电梯里', category: '地点·时刻' },
  { name: '老家厨房', category: '地点·时刻' },
  { name: '雨天公交站', category: '地点·时刻' },
  { name: '自习室', category: '地点·时刻' },
  { name: '理发店', category: '地点·时刻' },
  { name: '24小时快餐店', category: '地点·时刻' },

  { name: '第一场雪', category: '自然·天气' },
  { name: '台风夜', category: '自然·天气' },
  { name: '雷阵雨', category: '自然·天气' },
  { name: '大雾', category: '自然·天气' },
  { name: '彩虹', category: '自然·天气' },
  { name: '月亮', category: '自然·天气' },
  { name: '海边', category: '自然·天气' },
  { name: '山顶', category: '自然·天气' },
  { name: '沙漠', category: '自然·天气' },
  { name: '森林', category: '自然·天气' },
  { name: '河流', category: '自然·天气' },
  { name: '星空', category: '自然·天气' },
  { name: '落叶', category: '自然·天气' },

  { name: '雨伞', category: '物品' },
  { name: '钥匙', category: '物品' },
  { name: '旧手机', category: '物品' },
  { name: '台灯', category: '物品' },
  { name: '水杯', category: '物品' },
  { name: '信封', category: '物品' },
  { name: '眼镜', category: '物品' },
  { name: '耳机', category: '物品' },
  { name: '日历', category: '物品' },
  { name: '行李箱', category: '物品' },
  { name: '吉他', category: '物品' },
  { name: '镜子', category: '物品' },
  { name: '口袋', category: '物品' },

  { name: '热汤面', category: '食物' },
  { name: '冰可乐', category: '食物' },
  { name: '火锅', category: '食物' },
  { name: '妈妈做的饭', category: '食物' },
  { name: '半夜的泡面', category: '食物' },
  { name: '柠檬', category: '食物' },
  { name: '路边摊', category: '食物' },
  { name: '奶茶', category: '食物' },
  { name: '生日蛋糕', category: '食物' },
  { name: '早餐豆浆', category: '食物' },
  { name: '烧烤摊', category: '食物' },
  { name: '一袋橘子', category: '食物' },

  { name: '初恋', category: '人·关系' },
  { name: '老朋友', category: '人·关系' },
  { name: '陌生人', category: '人·关系' },
  { name: '隔壁邻居', category: '人·关系' },
  { name: '父亲', category: '人·关系' },
  { name: '母亲', category: '人·关系' },
  { name: '同学', category: '人·关系' },
  { name: '同事', category: '人·关系' },
  { name: '室友', category: '人·关系' },
  { name: '医生', category: '人·关系' },
  { name: '司机', category: '人·关系' },
  { name: '老师', category: '人·关系' },

  { name: '想念', category: '情绪·内心' },
  { name: '紧张', category: '情绪·内心' },
  { name: '心动', category: '情绪·内心' },
  { name: '遗憾', category: '情绪·内心' },
  { name: '勇气', category: '情绪·内心' },
  { name: '孤独', category: '情绪·内心' },
  { name: '安心', category: '情绪·内心' },
  { name: '委屈', category: '情绪·内心' },
  { name: '期待', category: '情绪·内心' },
  { name: '后悔', category: '情绪·内心' },
  { name: '自由', category: '情绪·内心' },
  { name: '秘密', category: '情绪·内心' },

  { name: '毕业那天', category: '事件·时刻' },
  { name: '搬家', category: '事件·时刻' },
  { name: '一次迟到', category: '事件·时刻' },
  { name: '深夜电话', category: '事件·时刻' },
  { name: '第一次见面', category: '事件·时刻' },
  { name: '告别', category: '事件·时刻' },
  { name: '重逢', category: '事件·时刻' },
  { name: '争吵', category: '事件·时刻' },
  { name: '道歉', category: '事件·时刻' },
  { name: '表白', category: '事件·时刻' },
  { name: '一场误会', category: '事件·时刻' },
  { name: '约定', category: '事件·时刻' },

  { name: '一首老歌', category: '感官·媒介' },
  { name: '一部旧电影', category: '感官·媒介' },
  { name: '一张照片', category: '感官·媒介' },
  { name: '气味', category: '感官·媒介' },
  { name: '海风', category: '感官·媒介' },
  { name: '雨声', category: '感官·媒介' },
  { name: '猫', category: '感官·媒介' },
  { name: '狗', category: '感官·媒介' },
  { name: '一条消息', category: '感官·媒介' },
  { name: '旧电台', category: '感官·媒介' },
  { name: '一个梦', category: '感官·媒介' },
  { name: '闹钟', category: '感官·媒介' },
  { name: '窗外', category: '感官·媒介' },
];

export const builtinSceneNames = builtinScenes.map(scene => scene.name);

// crypto 而非 Math.random：抽取结果会写进房间行并成为双方共同提示，需要不可预测。
export function randomInt(max) {
  if (max <= 0) return 0;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

export function pickScene(pool) {
  if (!pool.length) return null;
  const index = randomInt(pool.length);
  return pool[index] ?? pool[0];
}
