/* ─────────────────────────────────────────────────────────
   树星 · 孤独 · v2 交互逻辑
   - 树底图：Lovart 生成的写实夜树 PNG（固定形态）
   - 粒子层：Canvas（环境萤火 + 注入飞行粒子）
   - 叶子层：SVG <text>（关键词，对齐 2048×1152 viewBox）
   - 动画：GSAP Timeline + MotionPath
   ───────────────────────────────────────────────────────── */

gsap.registerPlugin(MotionPathPlugin);

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ── viewBox 与坐标映射 ──
   SVG 与 PNG 都按 2048×1152 来对齐
   Canvas 用容器像素坐标，需要把 SVG 坐标 → Canvas 坐标 ── */
const VBW = 2048, VBH = 1152;

function getViewState() {
  const stage = document.querySelector('.tree-stage');
  const rect = stage.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  // contain 模式下，图片实际显示区域
  const scale = Math.min(W / VBW, H / VBH);
  const dW = VBW * scale, dH = VBH * scale;
  const ox = (W - dW) / 2, oy = (H - dH) / 2;
  return { W, H, scale, ox, oy };
}
function svgToCanvas(sx, sy) {
  const v = getViewState();
  return { x: v.ox + sx * v.scale, y: v.oy + sy * v.scale };
}

let records = []; // 运行时只存 user records（不再有示例 mock 数据）

/* localStorage 持久化 user records（统一前缀；从旧 key 迁移） */
const STORAGE_KEY = 'memory-sparks:tree-records';
(function migrate() {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const old = localStorage.getItem('tree-star-records-v1');
      if (old) localStorage.setItem(STORAGE_KEY, old);
    }
    // 清理：抹掉早期可能被存进去的示例记录（isMock 或固定 id r1~r6）
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const MOCK_IDS = new Set(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
        const cleaned = arr.filter(r => r && !r.isMock && !MOCK_IDS.has(r.id));
        if (cleaned.length !== arr.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        }
      }
    }
  } catch (_) {}
})();

function loadUserRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveUserRecords() {
  try {
    const userRecs = records.filter(r => !r.isMock);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userRecs));
  } catch (e) {
    // localStorage 可能满或被禁；静默失败
  }
  treeSyncFile(); // U盘建库（STORE-006）
}

// U盘建库（STORE-006）：树星纯文字、无媒体（mediaFields:[]）。同步进 tree/records.json + 总索引 / 插盘恢复 / 通知父级。
function treeSyncFile() {
  const s = window.MS && window.MS.mediaStore;
  if (s && s.syncRecordsFromStorage) {
    s.syncRecordsFromStorage('tree', STORAGE_KEY, {
      meta: { name: '树星', keyword: '孤独' }, mediaFields: [],
    }).catch(() => {});
  }
}
function treeRestoreFile() {
  const s = window.MS && window.MS.mediaStore;
  if (!s || !s.restoreToStorage) return Promise.resolve(false);
  return s.restoreToStorage('tree', STORAGE_KEY).then(restored => {
    if (restored) {
      try { window.parent && window.parent.postMessage({ type: 'memory-sparks:storage-changed', key: STORAGE_KEY }, '*'); } catch (_) {}
    }
    return restored;
  });
}

/* 孤独主题词库（演示用，?leaves=full 模式铺满整棵树） */
const extraKeywords = [
  // 时间
  '黄昏', '清晨', '午后', '子夜', '破晓', '暮色', '夜半', '晨光', '余晖', '深夜',
  // 场景
  '阳台', '窗台', '书桌', '地铁', '咖啡馆', '走廊', '街角', '屋檐', '月台', '楼道',
  '路灯', '海港', '山间', '林荫', '河岸', '湖边', '远方', '远山', '飞鸟',
  // 行为
  '独处', '独酌', '踱步', '闲坐', '发呆', '伫立', '凝望', '漫步', '远行', '出神',
  '晨跑', '独坐', '回望', '独立', '翻页', '自语', '独白',
  // 情感
  '怅然', '释然', '寂寥', '空无', '清净', '安静', '平静', '淡然', '温柔', '坚韧',
  '释怀', '放下', '静默', '沉思', '安然', '自洽', '寂静',
  // 自然
  '寒风', '雨声', '月光', '星光', '晚霞', '雾气', '雪夜', '晚风', '潮汐', '海风',
  '晨雾', '夜色', '风声', '雨夜', '落叶', '暖灯',
  // 物件
  '旧书', '茶杯', '台灯', '毛毯', '围巾', '相册', '信纸', '唱片', '红茶', '旧物',
  '时光', '沉淀', '余韵', '笔锋', '信箱', '旧友',
];

/* 黑名单：虚词 + 泛词 + 填充词 —— 这些一律不上树（可继续补充）*/
const STOPWORDS = new Set([
  // 虚词 / 单字（length<2 已被过滤，留作保险）
  '的','了','是','在','我','也','就','都','和','与','或','把','被','给',
  '吗','呢','吧','啊','哦','嗯','呀','哈','么','着','过','地','得',
  '一','二','三','四','五','六','七','八','九','十','你','他','她','它',
  '这','那','些','个','上','下','里','中','前','后','再','又','还',
  // 时间填充词
  '今天','昨天','明天','现在','当时','那时','这时','时候','最近','后来',
  '以后','之后','以前','之前','刚才','今晚','昨晚','今早','平时','日子',
  // 泛动词 / 状态词
  '觉得','感觉','知道','想到','看到','听到','发现','变得','成为','进行',
  '出现','存在','需要','可以','能够','认为','希望','想要','喜欢','讨厌',
  // 程度 / 语气词
  '有点','一点','一些','一下','很多','好多','非常','特别','十分','真的',
  '确实','其实','好像','似乎','大概','也许','可能','应该','估计','当然',
  '居然','竟然','反正','总之','简直','几乎','差点','刚好','正好','最为',
  // 连接 / 逻辑词
  '因为','所以','但是','不过','然后','而且','并且','虽然','如果','要是',
  '因此','于是','或者','还是','不是','就是','只是','已经','曾经','突然',
  '终于','一直','总是','经常','偶尔','有时','其中',
  // 指代 / 泛指
  '自己','我们','你们','他们','她们','这个','那个','这些','那些','这样',
  '那样','怎么','什么','怎样','哪里','这里','那里','大家','别人','咱们',
  // 泛名词
  '东西','事情','时间','地方','问题','方面','情况','样子','一个','一种',
  '一样','这种','那种','各种','所有','整个','全部','部分','方式','内容',
  // 语气词 / 口水填充
  '嗯嗯','好的','好吧','行吧','哈哈','呵呵','嘿嘿','哦哦','啊啊','哎呀',
  '知道了','怎么办','是吧','对吧','嗯哼','额额','这么','那么','一会','一会儿',
]);

/* 白名单：值得上树的词（约 500，分类便于增删）
   —— 命中词库的词「优先上树」；一条里没有任何词库词时才走 fallback 规则。 */
const WHITELIST = new Set([
  // ── 情绪 / 心境 ──
  '孤独','寂寞','想念','思念','释然','释怀','平静','安宁','踏实','满足',
  '委屈','失落','难过','难受','疲惫','疲倦','焦虑','不安','期待','盼望',
  '欢喜','感动','温暖','治愈','心安','自由','勇敢','坚定','脆弱','怀念',
  '不舍','遗憾','后悔','愧疚','笃定','怅然','释放','安心','想哭','心动',
  '心碎','心酸','心疼','欣慰','慌张','茫然','惆怅','落寞','孤单','雀跃',
  '忐忑','怯懦','倔强','豁然','平和','慵懒','倦怠','麻木','空虚','怦然',
  '悸动','眷恋','牵挂','惦记','心慌','惊喜','失望','沮丧','坦然','安然',
  '痛快','畅快','烦闷','郁结','感伤','动容','开心','快乐','高兴','伤心',
  '激动','感激','烦躁','郁闷','崩溃','愉快','喜悦','幸福','心累','治愈',
  // ── 时间 / 时刻 ──
  '凌晨','深夜','清晨','黎明','黄昏','傍晚','午后','子夜','夜晚','周末',
  '假期','平日','此刻','当下','瞬间','片刻','整夜','通宵','破晓','拂晓',
  '日出','日落','夜半','一瞬','刹那','年关','月初','月末','年初','年末',
  '岁末','年终','深夜里','大清早','工作日','节假日',
  // ── 季节 / 节气 / 节日 ──
  '春天','夏天','秋天','冬天','初春','初夏','初秋','初冬','暮春','盛夏',
  '深秋','寒冬','立春','惊蛰','清明','谷雨','立夏','夏至','小暑','大暑',
  '立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至',
  '小寒','大寒','雨季','梅雨','三月','跨年','除夕','春节','中秋','端午',
  '元宵','生日',
  // ── 自然 / 天气 / 天象 ──
  '雨天','落雨','细雨','暴雨','阵雨','小雨','落叶','枯叶','新芽','嫩芽',
  '星空','银河','流星','星辰','月光','月亮','满月','新月','弯月','晚风',
  '微风','海风','山风','凉风','浪花','潮水','海浪','云朵','浮云','晚霞',
  '朝霞','彩霞','阳光','暖阳','斜阳','余晖','雪花','初雪','飞雪','露水',
  '朝露','草木','花开','落花','樱花','桂花','梅花','荷花','萤火','星星',
  '大海','森林','山峦','溪流','瀑布','湖泊','晨雾','薄雾','彩虹','雷声',
  '闪电','台风','寒潮','月色','夜色','星光','天光','潮汐','海雾','下雨天','云海','日落','日出',
  // ── 场景 / 地点 ──
  '海边','山顶','山脚','山腰','巷口','巷子','街角','街头','路口','车站',
  '月台','站台','天台','阳台','露台','厨房','书房','卧室','客厅','公园',
  '操场','球场','教室','走廊','食堂','图书馆','咖啡馆','便利店','出租屋','老家',
  '故乡','异乡','旅途','路上','河边','湖边','江边','岸边','田野','山林',
  '树下','窗边','床头','桥上','桥下','楼下','楼顶','屋顶','顶楼','阁楼',
  '角落','门口','渡口','码头','港口','沙滩','礁石','灯塔','田埂','山路',
  '小径','林间','巷尾','广场','长椅','路灯','站牌','后巷','街尾',
  // ── 城市 / 居所 / 建筑 ──
  '城市','小城','县城','老城','街区','社区','小区','弄堂','胡同','院子',
  '庭院','天井','屋檐','围墙','篱笆','木门','铁门','楼道','电梯','台阶',
  '石阶','凉亭','寺庙','教堂','钟楼','老屋','平房','瓦房','廊桥',
  // ── 食物 / 饮品 ──
  '麻辣烫','热汤','火锅','泡面','米饭','咖啡','奶茶','啤酒','红酒','早餐',
  '午餐','晚餐','夜宵','宵夜','便当','馄饨','饺子','面条','热饭','热粥',
  '白粥','包子','馒头','烧烤','串串','关东煮','螺蛳粉','牛肉面','拌面','炒饭',
  '蛋炒饭','豆浆','油条','煎饼','糖水','甜品','蛋糕','西瓜','橘子','清茶',
  '浓茶','热可可',
  // ── 动作 / 意象 ──
  '散步','漫步','发呆','出走','远行','出发','告别','离别','重逢','独处',
  '独行','熬过','撑过','坚持','放下','出神','失眠','早起','赶路','等待',
  '守候','回望','启程','归来','流浪','漂泊','沉默','倾诉','拥抱','牵手',
  '目送','奔跑','远方','旅行','出门','归家','回家','离家','搬家','加班',
  '通勤','赶车','错过','重启','重来','醒来','入睡','入眠','逃离','躲藏',
  '仰望','俯瞰','眺望','凝视','停留','驻足','徘徊','游荡','闲逛','独白',
  '沉思','冥想','喘息','奔赴','启航',
  // ── 人生 / 抽象 ──
  '青春','成长','长大','年少','少年','年华','时光','岁月','流年','往事',
  '往昔','旧时','回忆','记忆','梦想','理想','未来','命运','缘分','初心',
  '选择','改变','转折','起点','终点','离开','重生','老去','衰老','离世',
  '诞生','转身','成年',
  // ── 关系 / 人 ──
  '家人','朋友','陌生人','旧友','故人','爱人','恋人','知己','同桌','同学',
  '室友','邻居','路人','过客','亲人','父母','母亲','父亲','外婆','奶奶',
  '爷爷','孩子','老友','旧爱','妈妈','爸爸','外公','姥姥','姥爷','闺蜜','兄弟',
  // ── 物件 / 随身 ──
  '照片','信件','书信','车票','船票','机票','钥匙','行李','背包','旧物',
  '纪念','礼物','明信片','书签','钢笔','旧书','唱片','磁带','相册','围巾',
  '毛衣','雨伞','台灯','床单','被子','闹钟','手账','便签','日记',
  // ── 身体 / 感官 ──
  '心跳','呼吸','眼泪','泪水','体温','余温','掌心','指尖','脚步','足迹',
  '背影','侧脸','笑容','眼神','目光','气息','暖意','寒意','余香','回声',
]);

/* 英文黑名单（~50，小写）：常见虚词/填充词，不上树 */
const EN_STOPWORDS = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','being',
  'to','of','in','on','at','for','with','by','from','as','it','its','this',
  'that','these','those','i','me','my','you','your','he','she','we','they',
  'them','his','her','our','not','no','do','did','does','so','if','then',
  'than','too','very','just','can','will','would','should','could','have',
  'has','had','get','got','about','up','down','out','ok','okay','yeah','well',
  'really','am','what','when','how','why','all','some','any',
]);

/* 英文白名单（~100，小写）：值得上树的英文词，命中优先（中文为主，英文少而精）*/
const EN_WHITELIST = new Set([
  'lonely','alone','solitude','quiet','silence','peace','calm','memory','dream',
  'hope','faith','love','miss','home','road','journey','travel','ocean','sea',
  'beach','wave','rain','snow','storm','wind','cloud','sky','star','moon',
  'sunset','sunrise','dawn','dusk','night','midnight','morning','winter','summer',
  'autumn','spring','coffee','tea','wine','music','song','letter','photo','window',
  'light','shadow','fire','warmth','heart','tears','smile','goodbye','hello',
  'freedom','future','past','youth','growth','change','fade','bloom','forest',
  'mountain','river','lake','bridge','station','train','airport','city','street',
  'corner','garden','candle','book','diary','ticket','wander','drift','linger',
  'breathe','heal','rest','sleep','awake','float','glow','echo','nostalgia',
  'melancholy','wonder','gentle','tender','fragile','brave','still','lost','found',
  'distance','faraway','bittersweet','tired','tonight','weekend','memories',
  'happy','sad','sunshine','rainy','snowy','cozy','warm','cold','sunny',
]);

/* 单字词库：有意义的状态 / 情绪 / 感官单字 —— 只放行库里的单字（其余单字仍过滤）
   命中即按词库优先处理。可继续增删。 */
const SINGLE_CHAR = new Set([
  '累','困','倦','痛','疼','哭','笑','慌','烦','闷','丧','爽','醉','馋','饿',
  '渴','苦','甜','酸','涩','念','想','怕','空','醒','暖','冷','凉','热','静',
  '晕','呆','急','躁','抖','颤','闲','忙','虚','醺',
]);

/* ── 叶位坐标（基于稀疏 v2 树冠，2048×1152 viewBox） ──
   稀疏 v2 树冠：主干居中、伞状向上、枝条范围 x∈[550,1500] y∈[80,560]
   叶位贴近末梢端点，不再散布到画面边缘
   ─────────────────────────────────────────────────────── */
/* v10 用户精准标注的 96 个树枝末梢点（基于稀疏 v2 树底图 viewBox 2048×1152） */
const treeBranchAnchors = [
  { x: 1335, y: 281 }, { x: 1364, y: 325 }, { x: 1447, y: 364 }, { x: 1491, y: 419 },
  { x: 1537, y: 484 }, { x: 1505, y: 538 }, { x: 1397, y: 436 }, { x: 1471, y: 472 },
  { x: 1339, y: 399 }, { x: 1292, y: 327 }, { x: 1218, y: 353 }, { x: 1261, y: 368 },
  { x: 1138, y: 439 }, { x: 1162, y: 472 }, { x: 1190, y: 509 }, { x: 1193, y: 549 },
  { x: 1099, y: 489 }, { x: 1061, y: 516 }, { x: 1071, y: 555 }, { x: 1374, y: 559 },
  { x: 1406, y: 577 }, { x: 1448, y: 614 }, { x: 1469, y: 665 }, { x: 1413, y: 679 },
  { x: 1380, y: 637 }, { x: 1272, y: 634 }, { x: 1317, y: 654 }, { x: 1258, y: 756 },
  { x: 1207, y: 778 }, { x: 1204, y: 707 }, { x: 903,  y: 821 }, { x: 855,  y: 794 },
  { x: 801,  y: 753 }, { x: 829,  y: 719 }, { x: 869,  y: 744 }, { x: 915,  y: 753 },
  { x: 915,  y: 617 }, { x: 872,  y: 578 }, { x: 884,  y: 529 }, { x: 922,  y: 566 },
  { x: 688,  y: 753 }, { x: 644,  y: 756 }, { x: 598,  y: 731 }, { x: 529,  y: 729 },
  { x: 486,  y: 686 }, { x: 540,  y: 683 }, { x: 517,  y: 615 }, { x: 486,  y: 640 },
  { x: 558,  y: 624 }, { x: 613,  y: 605 }, { x: 561,  y: 544 }, { x: 514,  y: 516 },
  { x: 529,  y: 464 }, { x: 558,  y: 485 }, { x: 619,  y: 491 }, { x: 685,  y: 535 },
  { x: 753,  y: 531 }, { x: 774,  y: 495 }, { x: 719,  y: 606 }, { x: 580,  y: 361 },
  { x: 591,  y: 414 }, { x: 642,  y: 438 }, { x: 675,  y: 473 }, { x: 727,  y: 470 },
  { x: 632,  y: 355 }, { x: 725,  y: 386 }, { x: 771,  y: 380 }, { x: 672,  y: 314 },
  { x: 685,  y: 349 }, { x: 721,  y: 318 }, { x: 697,  y: 256 }, { x: 746,  y: 254 },
  { x: 771,  y: 290 }, { x: 798,  y: 268 }, { x: 835,  y: 303 }, { x: 852,  y: 370 },
  { x: 934,  y: 444 }, { x: 895,  y: 324 }, { x: 919,  y: 349 }, { x: 960,  y: 268 },
  { x: 947,  y: 177 }, { x: 889,  y: 158 }, { x: 829,  y: 154 }, { x: 802,  y: 206 },
  { x: 839,  y: 241 }, { x: 910,  y: 222 }, { x: 1064, y: 222 }, { x: 1065, y: 275 },
  { x: 1025, y: 305 }, { x: 1037, y: 376 }, { x: 1122, y: 260 }, { x: 1159, y: 248 },
  { x: 1194, y: 259 }, { x: 1117, y: 319 }, { x: 1133, y: 358 }, { x: 1092, y: 142 },
  { x: 1062, y: 129 }, { x: 1006, y: 132 },
  // 顶部补充 7 个（用户二轮 picker 标注）
  { x: 934,  y: 177 }, { x: 980,  y: 163 }, { x: 997,  y: 84  }, { x: 1065, y: 86  },
  { x: 1089, y: 123 }, { x: 872,  y: 157 }, { x: 818,  y: 182 },
];

/* v12：注入新字直接从 103 个末梢点中随机挑空 slot —— 不再只用固定 10 个 */
const leafPositions = treeBranchAnchors;

const TREE_TOP = { x: 1024, y: 160 }; // 注入动画的汇聚点（树顶上方）

let usedLeafSlots = new Set();
let leafIndex = []; // 改成 let，便于 pickLeafSlot 回收时 filter 重赋值

// 返回 {p, i}：p = 坐标，i = anchorIdx（用于持久化位置）
function pickLeafSlot() {
  const available = leafPositions
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !usedLeafSlots.has(i));
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    usedLeafSlots.add(pick.i);
    return { p: pick.p, i: pick.i };
  }
  if (leafIndex.length === 0) return null;
  const oldest = leafIndex.shift();
  const idx = leafPositions.findIndex(p => p.x === oldest.x && p.y === oldest.y);
  return { p: { x: oldest.x, y: oldest.y }, i: idx };
}

// 用已存的 anchorIdx 直接占用固定位置（重进页面恢复用）
function claimLeafSlot(anchorIdx) {
  const p = leafPositions[anchorIdx];
  if (!p) return null;
  usedLeafSlots.add(anchorIdx);
  return { p, i: anchorIdx };
}

/* 分词：用浏览器原生 Intl.Segmenter (Chrome 87+) 做中文分词。
   每个关键词限制 2-4 字，过滤停用词。
   核心修复：单字否定词（不/没/无...）必须跟下一个词合并，保留否定语义 */
const NEGATION_SINGLE = new Set(['不', '没', '无', '别', '未', '莫', '勿', '非', '否']);

function mergeNegations(rawTokens) {
  const merged = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const cur = rawTokens[i];
    if (NEGATION_SINGLE.has(cur) && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      const combined = cur + next;
      if (combined.length <= 4) {
        merged.push(combined);
        i++; // 跳过 next（已被吸收）
        continue;
      }
    }
    merged.push(cur);
  }
  return merged;
}

function tokenize(text) {
  // v13：剥离 emoji 后再分词（emoji 不上树，但 record.text 保留原文给详情卡）
  // 覆盖 emoji 主区段：表情符号、杂项符号、Dingbats、辅助平面 emoji
  const cleanText = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '');
  const result = [];
  let rawTokens = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('zh', { granularity: 'word' });
    for (const { segment, isWordLike } of seg.segment(cleanText)) {
      const w = segment.trim();
      if (!isWordLike) continue;
      rawTokens.push(w);
    }
  } else {
    // 兜底：按标点切分，长段强切到 ≤4 字
    const segs = cleanText.split(/[\s,，。、；;！!？?\.…—－\-:：（）\(\)\[\]【】]+/u);
    for (const s of segs) {
      const t = s.trim();
      if (t.length === 0) continue;
      if (t.length <= 4) {
        rawTokens.push(t);
      } else {
        for (let i = 0; i < t.length; i += 3) {
          rawTokens.push(t.slice(i, i + 3));
        }
      }
    }
  }

  // 合并否定单字
  const tokens = mergeNegations(rawTokens);

  // 过滤：中文 2-4 字 / 英文单词 2-14 字母，各走各的黑名单，去重（英文大小写不敏感）
  for (const w of tokens) {
    // 纯数字（阿拉伯或中文数字）不上树
    if (/^[0-9]+$/.test(w) || /^[一二三四五六七八九十百千万亿零两]+$/.test(w)) continue;
    const isLatin = /^[A-Za-z]+$/.test(w);
    if (isLatin) {
      if (w.length < 2 || w.length > 14) continue;
      if (EN_STOPWORDS.has(w.toLowerCase())) continue;
    } else if (w.length === 1) {
      // 单字：只放行「单字词库」里的状态/情绪词（累/哭/暖…），其余单字一律过滤
      if (!SINGLE_CHAR.has(w)) continue;
    } else {
      if (w.length > 4) continue;
      if (STOPWORDS.has(w)) continue;
    }
    if (!result.some(x => x.toLowerCase() === w.toLowerCase())) result.push(w);
  }
  return result;
}

function weightToFontSize(weight) {
  // 仅用于 SVG 字（已弃用，v6 字粒子化用自己的字号公式）
  return 16 + (weight - 1) * 3.5;
}

/* ─────────────────────────────────────────────────────────
   v6 字粒子化（恢复）
   每个汉字 → 离屏 Canvas 渲染 → 扫描像素 → 提取点位
   叶子不再是 DOM，而是 leafIndex 里的数据对象
   每帧由 drawCanvas 重绘所有叶子的字粒子
   ───────────────────────────────────────────────────────── */
function textToPoints(char, fontSize, density) {
  const off = document.createElement('canvas');
  const pad = Math.ceil(fontSize * 0.3);
  off.width = fontSize + pad * 2;
  off.height = fontSize + pad * 2;
  const octx = off.getContext('2d');
  octx.fillStyle = 'white';
  octx.font = `500 ${fontSize}px "PingFang SC", -apple-system, sans-serif`;
  octx.textBaseline = 'middle';
  octx.textAlign = 'center';
  octx.fillText(char, off.width / 2, off.height / 2);

  const img = octx.getImageData(0, 0, off.width, off.height).data;
  const points = [];
  for (let y = 0; y < off.height; y += density) {
    for (let x = 0; x < off.width; x += density) {
      const idx = (y * off.width + x) * 4;
      if (img[idx + 3] > 100) {
        points.push({
          x: x - off.width / 2 + (Math.random() - 0.5) * 0.6,
          y: y - off.height / 2 + (Math.random() - 0.5) * 0.6,
          phase: Math.random() * Math.PI * 2
        });
      }
    }
  }
  return points;
}

function keywordToPoints(keyword, fontSize, density) {
  const points = [];
  const charSpacing = fontSize * 1.05;
  const totalWidth = (keyword.length - 1) * charSpacing;
  const startX = -totalWidth / 2;
  for (let i = 0; i < keyword.length; i++) {
    const offsetX = startX + i * charSpacing;
    const charPoints = textToPoints(keyword[i], fontSize, density);
    charPoints.forEach(p => points.push({
      x: p.x + offsetX, y: p.y, phase: p.phase
    }));
  }
  return points;
}

function createLeaf(record, keyword, pos, isFaded) {
  // v12.4：让 weight (1-5) 关联字号 + 字粒子大小
  // weight 3 = 24（tuner 锚点），1→22 / 5→26
  const w = Math.max(1, Math.min(5, record.weight || 3));
  const fontSize = isFaded ? 18 : (21 + w);
  const density = 3;  // 2→3：每个字的粒子点数砍约一半（性能优化）
  const points = keywordToPoints(keyword, fontSize, density);
  const leaf = {
    recordId: record.id, keyword, x: pos.x, y: pos.y,
    fontSize, weight: w, ageRank: record.ageRank,
    isFaded, points,
    visibility: 0,
    highlighted: false,
    breathPhase: Math.random() * Math.PI * 2,
  };
  leafIndex.push(leaf);
  return leaf;
}

function findLeafAt(canvasX, canvasY, tolerance = 60) {
  let best = null;
  let bestDist = tolerance;
  for (const leaf of leafIndex) {
    const c = svgToCanvas(leaf.x, leaf.y);
    const dx = c.x - canvasX, dy = c.y - canvasY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) { bestDist = d; best = leaf; }
  }
  return best;
}

/* 默认模式：只铺 mock records 的 keyword（10 个），其他 anchor 留给纯粒子簇 */
function seedExistingLeaves() {
  const sorted = [...records].sort((a, b) => b.ageRank - a.ageRank);
  sorted.forEach(rec => {
    if (rec.ageRank === 0) return;
    const isFadedRecord = rec.ageRank >= 4
      || (rec.ageRank >= 2 && rec.weight <= 2);
    rec.keywords.forEach((kw, ki) => {
      // 优先用上次存好的 anchorIdx，让词每次进入页面都在同一位置
      const savedIdx = rec._slotIdxs && rec._slotIdxs[ki];
      const slot = (typeof savedIdx === 'number' && leafPositions[savedIdx] && !usedLeafSlots.has(savedIdx))
        ? claimLeafSlot(savedIdx)
        : pickLeafSlot();
      if (!slot) return;
      createLeaf(rec, kw, slot.p, isFadedRecord);
    });
  });
}

/* 按（记录 id + 关键词）对账，把树上的叶子更新成与 records 一致——直接增删、不做动画。
   用于：删除 / 编辑（关键词变了）/ 列表页改动同步。首次新增的上树动画另走 playInjectAnimation。*/
function reconcileLeavesInstant() {
  const keyOf = (recId, kw) => recId + '|' + kw;
  const desired = new Set();
  records.forEach(r => (r.keywords || []).forEach(kw => desired.add(keyOf(r.id, kw))));

  // 移除：树上有、但 records 已不需要的（记录删了 / 关键词改了）→ 回收 slot
  leafIndex = leafIndex.filter(l => {
    if (desired.has(keyOf(l.recordId, l.keyword))) return true;
    const idx = leafPositions.findIndex(p => p.x === l.x && p.y === l.y);
    if (idx >= 0) usedLeafSlots.delete(idx);
    return false;
  });

  // 新增：records 需要、但树上还没有的 → 直接建叶并立即显示（无点亮动画）
  const have = new Set(leafIndex.map(l => keyOf(l.recordId, l.keyword)));
  records.forEach(r => {
    (r.keywords || []).forEach((kw, ki) => {
      if (have.has(keyOf(r.id, kw))) return;
      const savedIdx = r._slotIdxs && r._slotIdxs[ki];
      const slot = (typeof savedIdx === 'number' && leafPositions[savedIdx] && !usedLeafSlots.has(savedIdx))
        ? claimLeafSlot(savedIdx)
        : pickLeafSlot();
      if (!slot) return;
      const leaf = createLeaf(r, kw, slot.p, false);
      leaf.visibility = 1;
      have.add(keyOf(r.id, kw));
    });
  });
}

/* 铺满字模式 (?leaves=full)：所有 103 个 anchor 都填字
   v11.1：full 模式下所有字统一字号/密度/颜色，不区分新老 */
function seedFullLeaves() {
  const mockKws = [];
  for (const r of records) {
    for (const kw of r.keywords) {
      mockKws.push({ kw, record: r });
    }
  }
  const extras = [...extraKeywords].sort(() => Math.random() - 0.5);

  treeBranchAnchors.forEach((anchor, i) => {
    let kw, record;
    if (i < mockKws.length) {
      kw = mockKws[i].kw;
      record = mockKws[i].record;
    } else {
      kw = extras[(i - mockKws.length) % extras.length];
      record = { id: 'amb-' + i, weight: 3, ageRank: 0 };
    }
    // v11.1：full 模式全部 isFaded=false，所有字一样清晰
    createLeaf(record, kw, anchor, false);
    const slotIdx = leafPositions.findIndex(p => p.x === anchor.x && p.y === anchor.y);
    if (slotIdx >= 0) usedLeafSlots.add(slotIdx);
  });
}

// 找最新一条记录（用于进入演示）
function findFreshestRecord() {
  return records.find(r => r.ageRank === 0);
}

/* 调试：把树填到 N%（测满树卡顿）。?fill=90 */
function seedDebugFill(pct) {
  const n = Math.round(leafPositions.length * Math.max(0, Math.min(100, pct)) / 100);
  const kws = [...extraKeywords];
  for (let i = 0; i < n; i++) {
    const slot = pickLeafSlot();
    if (!slot) break;
    const kw = kws[i % kws.length];
    const rec = { id: 'dbg-' + i, weight: 3, ageRank: -1, keywords: [kw], text: '调试填充' };
    const leaf = createLeaf(rec, kw, slot.p, false);
    leaf.visibility = 1;
  }
  console.log('[tree debug] 已填充', n, '/', leafPositions.length, '片叶子（', pct, '%）');
}

/* 调试：实时 FPS + 叶子数 + 环境粒子数。?fps=1 */
let __fpsEl = null, __fpsLast = 0, __fpsFrames = 0;
function setupFpsMeter() {
  __fpsEl = document.createElement('div');
  __fpsEl.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;'
    + 'background:rgba(0,0,0,0.7);color:#9deec0;font:12px/1.5 monospace;'
    + 'padding:6px 10px;border-radius:8px;pointer-events:none;white-space:pre;';
  document.body.appendChild(__fpsEl);
}

/* ─────────────────────────────────────────────────────────
   Canvas 粒子系统：环境萤火 + 注入粒子
   ───────────────────────────────────────────────────────── */
const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;

function resizeCanvas() {
  const stage = document.querySelector('.tree-stage');
  const rect = stage.getBoundingClientRect();
  canvas.width = rect.width * DPR;
  canvas.height = rect.height * DPR;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

/* v10.4：缩小变暗 + 加密 —— 用户反馈 "粒子太大太亮" */
const ambientParticles = [];
function spawnAmbientParticles() {
  ambientParticles.length = 0;
  const perAnchor = 12; // 性能优化：22 → 12（环境粒子总量 2310 → 约 1260）
  for (const anchor of treeBranchAnchors) {
    for (let i = 0; i < perAnchor; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.7) * 42;
      const sx = anchor.x + Math.cos(angle) * dist;
      const sy = anchor.y + Math.sin(angle) * dist;
      ambientParticles.push({
        sx, sy,
        r: 0.7 + Math.random() * 1.3, // 1.5-4.5 → 0.7-2.0 缩小
        phase: Math.random() * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.6,
        hue: Math.random() < 0.6 ? 'mint' : 'cyan'
      });
    }
  }
}
spawnAmbientParticles();

/* 注入飞行粒子：临时粒子，由 spawnInjectionBurst 创建 */
const flyingParticles = [];

/* v12.2 性能优化：预渲染发光贴图代替 shadowBlur（快 3-5 倍）
   每个粒子绘制时直接 drawImage 这些贴图，避免每帧调用 shadowBlur */
function makeGlowSprite(colorStr, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, `rgba(${colorStr}, 1)`);
  g.addColorStop(0.25, `rgba(${colorStr}, 0.55)`);
  g.addColorStop(0.6, `rgba(${colorStr}, 0.15)`);
  g.addColorStop(1, `rgba(${colorStr}, 0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}
const SPRITES = {
  mint: makeGlowSprite('140, 250, 210'),
  cyan: makeGlowSprite('100, 240, 230'),
  leaf: makeGlowSprite('160, 245, 215'),
  leafHi: makeGlowSprite('255, 255, 250'),
  fly: makeGlowSprite('180, 255, 220'),
};

let _viewCache = null;
function refreshViewCache() { _viewCache = getViewState(); }

function drawLeafConstellation(leaf, t) {
  if (leaf.visibility <= 0) return;
  if (!_viewCache) return;
  const v = _viewCache;
  const cx = v.ox + leaf.x * v.scale;
  const cy = v.oy + leaf.y * v.scale;
  // v12.4：粒子大小关联 weight（1→1.15, 3→1.45, 5→1.75）
  const w = leaf.weight || 3;
  const base = leaf.highlighted ? 2.2 : (leaf.isFaded ? 1.0 : (1.0 + w * 0.15));
  const sprite = leaf.highlighted ? SPRITES.leafHi : SPRITES.leaf;
  // sprite 渲染尺寸（base × 4 让发光球比 shadowBlur 时代视觉一致）
  const sz = base * v.scale * 4;
  const breath = 0.7 + 0.3 * Math.sin(t * 0.0008 + leaf.breathPhase);
  for (const p of leaf.points) {
    const px = cx + p.x * v.scale;
    const py = cy + p.y * v.scale;
    const flicker = 0.6 + 0.4 * Math.sin(t * 0.003 + p.phase);
    const alpha = Math.min(1, leaf.visibility) * breath * flicker;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, px - sz/2, py - sz/2, sz, sz);
  }
  ctx.globalAlpha = 1;
}

function drawCanvas(t) {
  refreshViewCache();
  ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  if (!_viewCache) return;
  const v = _viewCache;

  // 1. 环境粒子（v12.2：预渲染贴图，drawImage 代替 shadowBlur）
  for (const p of ambientParticles) {
    const px = v.ox + p.sx * v.scale;
    const py = v.oy + p.sy * v.scale;
    const flicker = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.001 * p.speed + p.phase));
    const sprite = p.hue === 'mint' ? SPRITES.mint : SPRITES.cyan;
    const sz = p.r * v.scale * 4;
    ctx.globalAlpha = flicker * 0.75;
    ctx.drawImage(sprite, px - sz/2, py - sz/2, sz, sz);
  }
  ctx.globalAlpha = 1;

  // 2. 字粒子叶子（关键词，比环境粒子大且亮）
  for (const leaf of leafIndex) drawLeafConstellation(leaf, t);

  // 3. 注入飞行粒子（贴图）
  for (let i = flyingParticles.length - 1; i >= 0; i--) {
    const p = flyingParticles[i];
    p.life += 1;
    if (p.life > p.maxLife) { flyingParticles.splice(i, 1); continue; }
    const fade = 1 - p.life / p.maxLife;
    const sz = p.r * fade * 8;
    ctx.globalAlpha = fade * 0.95;
    ctx.drawImage(SPRITES.fly, p.x - sz/2, p.y - sz/2, sz, sz);
  }
  ctx.globalAlpha = 1;
}

// 全局 visibility 标记 + 真正停 RAF：active=false 时彻底不 schedule 下一帧
let __treeActive = true;
let __treeAnimRunning = false;
let __treeTickRunning = false;
// 录入窗口打开时暂停 canvas 渲染（光 display:none 停不了 RAF 循环，必须用标志位停 JS 重绘）
let __treeComposerOpen = false;

let __lastDraw = 0;
const ACTIVE_MS = 1000 / 32;   // 活跃时封顶 ~32fps
const IDLE_MS   = 1000 / 8;    // 闲置时降到 ~8fps（人走开了没必要满帧烧 CPU）
const IDLE_AFTER = 20000;      // 20s 无任何交互 → 进入闲置低帧
let __lastInteract = 0;
function markInteract() { try { __lastInteract = performance.now(); } catch (_) {} }
['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
  window.addEventListener(ev, markInteract, { passive: true }));
// 父 App 来的消息（切回本星/列表操作）也算一次交互，立即恢复满帧
window.addEventListener('message', markInteract);

function animateCanvas(t) {
  if (!__treeActive || __treeComposerOpen) { __treeAnimRunning = false; return; }
  // 注入动画进行中（有飞行粒子）→ 满帧绘制，让"飞向树枝"的粒子轨迹流畅清晰，
  // 不被 32fps 封顶画得稀疏断续（修复：之前防卡顿的降帧优化把这条动画弄得看不清）
  const bursting = flyingParticles.length > 0;
  // 闲置 20s 后降帧：长时间放置不再持续满帧烧 CPU（根治「越放越卡」）；有动画时不算闲置
  const idle = !bursting && (t - __lastInteract) > IDLE_AFTER;
  const frameMs = bursting ? 0 : (idle ? IDLE_MS : ACTIVE_MS);
  if (t - __lastDraw >= frameMs) {
    __lastDraw = t;
    drawCanvas(t);
    if (__fpsEl) {
      __fpsFrames++;
      if (t - __fpsLast >= 500) {
        const fps = Math.round(__fpsFrames * 1000 / (t - __fpsLast));
        __fpsEl.textContent = `${fps} FPS${idle ? '(闲置)' : ''}\n${leafIndex.length} 词 / ${leafPositions.length} 位\n环境粒子 ${ambientParticles.length}`;
        __fpsLast = t; __fpsFrames = 0;
      }
    }
  }
  requestAnimationFrame(animateCanvas);
}
function startTreeAnim() {
  if (__treeAnimRunning || __treeComposerOpen) return;
  __treeAnimRunning = true;
  requestAnimationFrame(animateCanvas);
}
function startTickFlying() {
  if (__treeTickRunning || __treeComposerOpen) return;
  __treeTickRunning = true;
  requestAnimationFrame(tickFlyingParticles);
}

window.addEventListener('message', (e) => {
  const wasActive = __treeActive;
  if (e.data?.type === 'memory-sparks:visibility') __treeActive = !!e.data.visible;
  if (e.data?.type === 'memory-sparks:list-mode') __treeActive = !e.data.enabled;
  if (!wasActive && __treeActive) { startTreeAnim(); startTickFlying(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) __treeActive = false;
});

startTreeAnim();

/* 在指定屏幕坐标爆出 N 个粒子（注入动画用） */
function emitBurst(canvasX, canvasY, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    flyingParticles.push({
      x: canvasX + (Math.random() - 0.5) * 10,
      y: canvasY + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.3,
      r: 1.5 + Math.random() * 1.5,
      life: 0,
      maxLife: 40 + Math.random() * 30
    });
  }
  startTickFlying();    // 有新粒子才启动 raf 循环
}

// 让飞行粒子按自身速度移动（独立于 GSAP）
// 没粒子时停止 raf 循环，等下次 emitBurst 再启动
function tickFlyingParticles() {
  if (!__treeActive || __treeComposerOpen || flyingParticles.length === 0) {
    __treeTickRunning = false;
    return;
  }
  for (const p of flyingParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.02;
  }
  requestAnimationFrame(tickFlyingParticles);
}

/* ─────────────────────────────────────────────────────────
   进入动画：
   - 树底图淡入 + 卡片/＋按钮浮现
   - 5 条老记录的字粒子由 visibility 0→1 错峰浮现
   - 延迟 2.8 秒后，最新 r6 走完整注入动画
   ───────────────────────────────────────────────────────── */
function playEntryAnimation(mode = 'default') {
  gsap.fromTo('.tree-image',
    { opacity: 0, scale: 0.96 },
    { opacity: 1, scale: 1, duration: 1.6, ease: 'power2.out' }
  );
  gsap.from('.intro-card', { opacity: 0, x: -30, duration: 0.9, delay: 0.3, ease: 'power2.out' });
  gsap.from('.float-add', { opacity: 0, scale: 0.6, duration: 0.6, delay: 0.6, ease: 'back.out(1.4)' });

  // 字粒子叶子 visibility 0 → 1 错峰显现
  const leaves = [...leafIndex];
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
  }
  // full 模式下 100+ 字，stagger 调小避免太慢
  const staggerStep = mode === 'full' ? 0.015 : 0.06;
  leaves.forEach((leaf, i) => {
    gsap.to(leaf, {
      visibility: 1,
      duration: 0.8,
      delay: 1.0 + i * staggerStep,
      ease: 'power2.out'
    });
  });

  // full 模式不演示注入（叶子已铺满）
  if (mode !== 'full') {
    const freshest = findFreshestRecord();
    if (freshest) {
      gsap.delayedCall(2.8, () => playInjectAnimation(freshest));
    }
  }
}

/* ─────────────────────────────────────────────────────────
   v6 注入动画：
   1. 每条关键词从＋按钮喷出连续 Canvas 粒子流
   2. 沿曲线飞到树顶汇聚成密集粒子云
   3. 粒子流散开飞向各叶位
   4. 落地后字粒子"组成字形" —— createLeaf 加入 leafIndex，
      visibility 0→1 让字粒子点亮显形
   ───────────────────────────────────────────────────────── */
function playInjectAnimation(record) {
  const slots = record.keywords.map(() => pickLeafSlot()).filter(Boolean);
  // 落地后把 anchorIdx 存进 record，下次重进页面能还原到同一位置
  if (!record._slotIdxs) record._slotIdxs = [];
  slots.forEach((slot, i) => { record._slotIdxs[i] = slot.i; });
  if (slots.length === 0) return;
  // 文字流进树、长成新叶那一刻 → 一记树枝生长音（每次注入一记）
  if (window.MS_SOUND && MS_SOUND.play) MS_SOUND.play('grow');

  // v13：每个粒子流从「左 / 右 / 上」随机方向飞入目标字位（排除从下往上）
  // 路径独立、方向随机 —— 每次注入视觉都不同，且不再统一从底部＋按钮往上冒
  const tl = gsap.timeline();

  slots.forEach((slot, i) => {
    const dest = svgToCanvas(slot.p.x, slot.p.y);
    // 起点在目标的「上半圈」：角度 180°~360°（左→上→右），sin<=0 → 起点不在目标下方
    const a = (180 + Math.random() * 180) * Math.PI / 180;
    const dist = 260 + Math.random() * 220;
    const startCanvasX = dest.x + Math.cos(a) * dist;
    const startCanvasY = dest.y + Math.sin(a) * dist;
    const t = { obj: { x: startCanvasX, y: startCanvasY } };
    // 弧顶：起点与目标之间略上凸，每条不同
    const midX = (startCanvasX + dest.x) / 2 + (Math.random() - 0.5) * 140;
    const midY = (startCanvasY + dest.y) / 2 - (40 + Math.random() * 80);
    tl.to(t.obj, {
      motionPath: {
        path: [
          { x: startCanvasX, y: startCanvasY },
          { x: midX, y: midY },
          { x: dest.x, y: dest.y }
        ],
        curviness: 1.5
      },
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: function() { emitBurst(t.obj.x, t.obj.y, 3); },
      onComplete: () => {
        for (let k = 0; k < 25; k++) {
          emitBurst(dest.x + (Math.random() - 0.5) * 25,
                    dest.y + (Math.random() - 0.5) * 25, 1);
        }
        // 防重复：若对账逻辑已经先建了这片叶子，就不再重建
        if (leafIndex.some(l => l.recordId === record.id && l.keyword === record.keywords[i])) return;
        const leaf = createLeaf(record, record.keywords[i], slot.p, false);
        gsap.to(leaf, {
          visibility: 1,
          duration: 0.9,
          ease: 'power2.out'
        });
      }
    }, 0.05 + i * 0.14); // 每个粒子流错峰 0.14s 出发
  });
}

/* ── v6 字粒子化点击：leafIndex.highlighted 标志 + drawCanvas 自动响应 ── */
function onLeafClick(recordId) {
  const record = records.find(r => r.id === recordId);
  if (!record) return;
  leafIndex.forEach(l => l.highlighted = false);
  const sameLeaves = leafIndex.filter(l => l.recordId === recordId);
  sameLeaves.forEach(l => l.highlighted = true);
  sameLeaves.forEach(l => {
    gsap.to(l, {
      visibility: 1.3,
      duration: 0.25,
      yoyo: true, repeat: 1,
      ease: 'power2.out'
    });
  });
  document.getElementById('leafDate').textContent = formatDate(record.date);
  document.getElementById('leafText').textContent = record.text;
  const kwBox = document.getElementById('leafKeywords');
  kwBox.innerHTML = '';
  record.keywords.forEach(kw => {
    const s = document.createElement('span');
    s.textContent = kw;
    kwBox.appendChild(s);
  });
  const card = document.getElementById('leafCard');
  card.classList.add('open');
  gsap.from(card, { y: 20, opacity: 0, duration: 0.4, ease: 'power2.out' });
  // 先清掉旧按钮，避免防重复机制让 click handler 还绑在上一片叶子的 closure 上
  card.querySelectorAll('.ms-card-del-btn, .ms-card-edit-btn').forEach(b => b.remove());
  // 挂统一编辑按钮（用当前 recordId 绑定）→ 进编辑窗口
  if (window.MS && MS.bindEdit) {
    MS.bindEdit({
      container: card,
      getId: () => recordId,
      label: '编辑',
      onEdit: (rid) => {
        // 没有 mock 后：records 全是 user 记录，下标即 user-records 下标
        const idx = records.findIndex(r => r.id === rid);
        card.classList.remove('open');
        leafIndex.forEach(l => l.highlighted = false);
        if (idx >= 0 && window.MS && MS.composer) MS.composer.open(idx);
      },
    });
  }
  // 挂统一删除按钮（用当前 recordId 绑定）
  if (window.MS && MS.bindDelete) {
    MS.bindDelete({
      container: card,
      getId: () => recordId,
      question: '让这片叶子飘落？',
      yes: '飘落',
      onDelete: (rid) => {
        records = records.filter(r => r.id !== rid);
        saveUserRecords();
        card.classList.remove('open');
        leafIndex.forEach(l => l.highlighted = false);
        // 复用 __msReloadAll 完成 leafIndex 对账 + 叶子更新
        if (typeof window.__msReloadAll === 'function') {
          try { window.__msReloadAll(); } catch (_) {}
        }
      },
    });
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

/* ── 写作面板 ── */
function setupComposer() {
  const addBtn = document.getElementById('addTrigger');

  // 录入界面：交给 ms-composer 统一渲染
  function _bootTreeComposer() {
    if (!window.MS || !MS.composer) { setTimeout(_bootTreeComposer, 60); return; }
    const extraHTML = `
      <div class="msc-tier-row">
        <span class="msc-extra-label">孤独的感受</span>
        <div class="msc-tier-buttons" data-msc-tier="weight">
          <button type="button" data-w="1" class="on">1</button>
          <button type="button" data-w="2">2</button>
          <button type="button" data-w="3">3</button>
          <button type="button" data-w="4">4</button>
          <button type="button" data-w="5">5</button>
        </div>
      </div>
    `;
    MS.composer.init({
      planet: 'tree',
      storageKey: STORAGE_KEY,
      capabilities: { image: false, video: false, audio: false },
      textareaPlaceholder: '一个人吃饭、散步、熬过这段日子……',
      textareaMaxLength: 150,
      extraHTML,
      extraInit: (extraEl, editingRec) => {
        const w = (editingRec?.weight && [1,2,3,4,5].includes(editingRec.weight)) ? editingRec.weight : 1;
        extraEl.querySelectorAll('[data-w]').forEach(b => {
          b.classList.toggle('on', parseInt(b.dataset.w) === w);
          b.addEventListener('click', () => {
            extraEl.querySelectorAll('[data-w]').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
          });
        });
      },
      extraGet: (extraEl) => {
        const active = extraEl.querySelector('[data-w].on');
        return { weight: active ? parseInt(active.dataset.w) : 1 };
      },
      beforeSave: (payload, editingIdx) => {
        if (editingIdx == null) {
          // 用本星 buildRecordFromText 补 keywords + ageRank + ISO date
          const built = buildRecordFromText(payload.text || '', payload.weight || 1);
          if (built) {
            payload.id = built.id;
            payload.date = built.date;
            payload.keywords = built.keywords;
            payload.ageRank = built.ageRank;
          } else {
            // 兜底：内容纯 emoji/标点、没有有效字 → 用主题默认词「独处」（不再抓原文标点片段）
            payload.keywords = ['独处'];
            payload.ageRank = -1;
            payload.date = new Date().toISOString().slice(0, 10);
          }
        } else {
          // 编辑：重算关键词（id/date/ageRank 由 composer 合并旧记录时保留）
          const kws = pickKeywords(tokenize(payload.text || ''), payload.text || '');
          payload.keywords = kws.length ? kws : ['独处'];
        }
        return payload;
      },
      onOpened: () => {
        document.body.classList.add('tree-composer-open');
        // 防卡顿：暂停 canvas 渲染循环 + 把整个场景藏起来
        // （canvas 满帧重绘 + SVG 滤镜在打字 reflow 时被反复重算 = 输入卡的根源，参照繁星错36）
        __treeComposerOpen = true;
        try { document.querySelector('main.tree-page').style.display = 'none'; } catch (_) {}
      },
      onClosed: () => {
        document.body.classList.remove('tree-composer-open');
        __treeComposerOpen = false;
        try { document.querySelector('main.tree-page').style.display = ''; } catch (_) {}
        startTreeAnim();   // 恢复 canvas 渲染
      },
      onSaved: (payload, editingIdx) => {
        // 重读 user records（不再有 mock）
        records = loadUserRecords();
        if (editingIdx == null) {
          // 首次新增：保留上树动画。onSaved 先于 onClosed（此刻场景还隐藏、渲染暂停）→ 延后到场景恢复后再放
          requestAnimationFrame(() => {
            __treeComposerOpen = false;
            startTreeAnim();
            try {
              playInjectAnimation(payload);
              // _slotIdxs 写在 payload 上，但 records 是另一份引用 → 找到对应条目同步过去再落盘
              const recInArr = records.find(r => r.id === payload.id);
              if (recInArr && payload._slotIdxs) recInArr._slotIdxs = [...payload._slotIdxs];
              saveUserRecords();
            } catch (_) {}
          });
        } else {
          // 编辑：关键词可能变了 → 直接对账更新叶子（无动画）。场景恢复由 onClosed 负责
          reconcileLeavesInstant();
          treeSyncFile(); // 编辑分支不走 saveUserRecords，单独建库（STORE-006）
        }
      },
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootTreeComposer);
  else _bootTreeComposer();

  addBtn.addEventListener('click', () => {
    if (window.MS && MS.composer) MS.composer.open();
  });

  document.getElementById('closeLeafCard').addEventListener('click', () => {
    document.getElementById('leafCard').classList.remove('open');
    leafIndex.forEach(l => l.highlighted = false);
  });
  // v6：Canvas 接收点击命中字粒子叶子
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const leaf = findLeafAt(cx, cy, 70);
    if (leaf) onLeafClick(leaf.recordId);
  });
}

/* ── 启动 ── */
document.addEventListener('DOMContentLoaded', () => {
  // 只用 user records，不再合并 MOCK_RECORDS（让用户看空状态）
  records = loadUserRecords();

  const params = new URLSearchParams(location.search);
  const leavesMode = params.get('leaves'); // null | 'none' | 'full'
  const fillPct = parseInt(params.get('fill'), 10); // 调试：把树填到 N%（测卡顿）
  if (params.get('fps')) setupFpsMeter();           // 调试：实时 FPS

  const img = document.querySelector('.tree-image');
  const init = () => {
    if (fillPct > 0) {
      seedDebugFill(fillPct);          // 调试填充（测满树卡顿）
      playEntryAnimation('none');
    } else if (leavesMode === 'full') {
      seedFullLeaves();
      playEntryAnimation('full');
    } else if (leavesMode === 'none') {
      playEntryAnimation();
    } else {
      seedExistingLeaves();
      playEntryAnimation();
    }
  };
  if (img.complete) {
    init();
  } else {
    img.addEventListener('load', init);
  }
  setupComposer();

  // 统一：hint-row 折叠 + 直接弹 composer（跟其他星统一）
  document.querySelectorAll('.hint-row').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      row.closest('.intro-card')?.classList.add('collapsed');
      document.getElementById('addTrigger')?.click();
    });
  });
  document.querySelectorAll('.intro-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('collapsed')) card.classList.remove('collapsed');
    });
  });

  // B7.2：列表页操作 → 交互页同步
  // ms-mount.js 已自动调 bridgeListMode，本星只需暴露 __msReloadAll
  // 列表 ListComposer 写入的 record 没有 keywords/ageRank，这里补齐
  // 并 diff leafIndex：新增的 record 走完整注入动画，删除的清理对应叶子
  window.__msReloadAll = function() {
    const userRecs = loadUserRecords();
    // 列表页写入的 record 可能缺 keywords/weight/ageRank，这里补齐（统一走新取词逻辑）
    userRecs.forEach(r => {
      if (!Array.isArray(r.keywords) || r.keywords.length === 0) {
        const text = r.text || '';
        let kws = pickKeywords(tokenize(text), text);
        if (kws.length === 0) kws = ['独处'];
        r.keywords = kws;
      }
      if (typeof r.weight !== 'number') r.weight = 3;
      if (typeof r.ageRank !== 'number') r.ageRank = -1;
    });
    records = userRecs;
    saveUserRecords();
    // 直接对账更新（删除 / 列表编辑 / 关键词变化），不做动画
    reconcileLeavesInstant();
  };

  // U盘建库（STORE-006）：句柄到达后（常晚于首屏）从盘恢复记录 + 重渲
  (function installTreeFsaHandle() {
    const s = window.MS && window.MS.mediaStore;
    if (s && s.installHandleListener) {
      s.installHandleListener(() => {
        treeRestoreFile().then(restored => {
          if (restored) { records = loadUserRecords(); reconcileLeavesInstant(); }
        }).catch(() => {});
      });
    }
  })();
});

/* B7.2 抽离：把文字 → 带 keywords 的 record（submit 与 onReload 共用） */
/* 按字数定「最多上几个词」：≤10字→1，≤50字→2，≤150字→3 */
function maxKeywordsByLength(text) {
  const len = [...String(text || '').trim()].length;
  if (len <= 10) return 1;
  if (len <= 50) return 2;
  return 3;
}

/* 两段式取词（数量由字数决定，见 maxKeywordsByLength）：
   ① 先看内容里有没有「词库」里的词 —— 有就只从命中词里挑，优先上树
      命中词之间排序：重复多的优先 → 较长的优先 → 首次出现顺序
   ② 一条里完全没有词库词 → fallback：偏好长词（>=3 字更像具体名词），同样按字数上限取
      （最长的；同长取重复最多/最先出现）—— 避免随便打字也乱选一堆 */
function pickKeywords(cands, text) {
  if (!cands.length) return [];
  const n = maxKeywordsByLength(text);
  const occOf = (w) => text.split(w).length - 1;
  const isHit = (w) => WHITELIST.has(w) || EN_WHITELIST.has(w.toLowerCase()) || SINGLE_CHAR.has(w);
  // 排序用的「词长」：英文按字母数会远超中文，归一成 2.5（介于 2~3 字中文之间），
  // 避免长英文单词无脑压过更具体的中文词
  const kwLen = (w) => /[A-Za-z]/.test(w) ? 2.5 : w.length;

  const withIdx = cands.map((w, i) => ({ w, i }));
  // 命中词库的词：重复多 → 较长 → 先出现
  const hits = withIdx.filter(o => isHit(o.w))
    .sort((a, b) => (occOf(b.w) - occOf(a.w)) || (kwLen(b.w) - kwLen(a.w)) || (a.i - b.i));
  // 库外的词：长词优先 → 重复多 → 先出现
  const rest = withIdx.filter(o => !isHit(o.w))
    .sort((a, b) => (kwLen(b.w) - kwLen(a.w)) || (occOf(b.w) - occOf(a.w)) || (a.i - b.i));

  // B 方案：词库词优先占位，不够再用库外最像样的词补满到字数上限
  return [...hits, ...rest].slice(0, n).map(o => o.w);
}

function buildRecordFromText(text, weight = 3) {
  let keywords = pickKeywords(tokenize(text), text);
  if (keywords.length === 0) {
    // 全是废词/单字/标点，没有有效候选 → 用主题默认词「独处」，不抓原文片段（避免垃圾上树）
    keywords = ['独处'];
  }
  return {
    id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
    date: new Date().toISOString().slice(0, 10),
    weight,
    ageRank: -1,
    text,
    keywords,
  };
}
