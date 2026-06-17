# 树星 · Tree Star Prototype

「记忆闪光点」App 关键词星球第 8 颗 —— 孤独主题。

> *树星离别的星星都很远，星球上只有一棵树。每当有人写下一个人吃饭、散步、熬过某段日子的时刻，文字就会流进树干，长成新的年轮。*

## 文件结构

```
tree-star-final/
├── index.html              主原型（树星完整体验）
├── tree-star.css           样式
├── tree-star.js            交互逻辑（约 800 行）
├── assets/
│   ├── tree-scene.png      树底图（2048×1152，Lovart 生成的稀疏夜树）
│   └── tree.png            星球预览图（介绍卡片用）
├── tools/                  开发辅助工具
│   ├── leaf-picker.html    叶位标注工具（点击树梢标 anchor，导出 JSON）
│   ├── leaf-tuner.html     字粒子字号/密度调参（8 种组合对比）
│   └── weight-preview.html 情感重量 1-5 视觉对比
└── README.md
```

## 启动

依赖：现代浏览器（Chrome / Safari / Edge 都行），无需构建。

```bash
cd tree-star-final
python3 -m http.server 8080
# 然后浏览器打开 http://localhost:8080/
```

或者用任何静态 server（`npx serve` / `live-server` 等）。

## 主要 URL

| URL | 说明 |
|---|---|
| `index.html` | 默认模式：10 个 mock 关键词 + r6 自动注入演示 |
| `index.html?leaves=full` | 满铺模式：103 个树枝末梢全部填字（演示用） |
| `index.html?leaves=none` | 空树模式：只有树底图 + 环境粒子，无字 |
| `tools/leaf-picker.html` | 点树梢标注 anchor 坐标（标完导出 JSON）|
| `tools/leaf-tuner.html` | 字粒子字号 + 密度 8 组对比 |
| `tools/weight-preview.html` | weight 1-5 视觉对比 |

## 技术架构

```
┌────────────────────────────────────────────────┐
│ 背景层：极暗绿黑夜空 (CSS)                       │
├────────────────────────────────────────────────┤
│ 树底图层：tree-scene.png (object-fit: contain)  │
├────────────────────────────────────────────────┤
│ Canvas 粒子层 (z:3, pointer-events: auto)      │
│  ├ 环境粒子：103 anchors × 14 = 1442 个发光颗粒  │
│  ├ 字粒子叶子：每个字粒子化 ≈ 50 个发光点         │
│  └ 注入飞行粒子：临时尾迹                        │
├────────────────────────────────────────────────┤
│ UI 层 (z:10+)：卡片、＋按钮、composer、详情卡    │
└────────────────────────────────────────────────┘
```

### 核心技术决策

| 维度 | 选择 | 原因 |
|---|---|---|
| 树底图 | Lovart 生成的 PNG，固定形态 | 写实纸笔感，比 L-system / SVG 手画自然 |
| 叶子 | Canvas 字粒子化（textToPoints 离屏 Canvas 扫描字像素 → 点位）| 远看像 mp4 萤火树，近看是字 |
| 字号 | 24，密度 2（tuner 选定） | 字号过大颗粒糊化、过小看不出字形 |
| 叶位 | 用户手标 103 个末梢 anchor | 自动估算无法精准对齐枝条末梢 |
| 注入动画 | 每个粒子流直接飞向目标字位（不经过中间汇聚）| 每条轨迹独立、弧度随机 |
| 性能 | 预渲染发光贴图 + drawImage 替换 shadowBlur | 帧时间减少 3-5 倍 |

### 配色（统一青绿色调）

| 用途 | RGB |
|---|---|
| 环境粒子 mint | `rgba(140, 250, 210, …)` |
| 环境粒子 cyan | `rgba(100, 240, 230, …)` |
| 字粒子 leaf | `rgba(160, 245, 215, …)` |
| 字粒子 highlight | `rgba(255, 255, 250, …)` |
| 注入飞行粒子 | `rgba(180, 255, 220, …)` |
| 背景径向光 | `#021404 → #010903` |

### 字号 / 粒子大小 与 weight 的关联

```
fontSize  = 21 + weight       // weight 1→22 / 3→24 / 5→26
particle base = 1.0 + w × 0.15 // 1→1.15 / 3→1.45 / 5→1.75
```

## 录入流程

```
用户点 ＋ 按钮
  ↓
弹出 composer
  ↓
写一段文字（如 "一个人去看了凌晨的海，连风都很轻"）
  ↓
选 weight (1-5)
  ↓
点「交给树」
  ↓
tokenize() 切词
  · Intl.Segmenter 中文分词
  · 单字否定词（不/没/无/别...）自动跟下一个词合并 → 「不开心」不丢
  · 过滤 2-4 字 + 停用词 + 去重
  ↓
为每个关键词 pickLeafSlot()（从 103 anchor 中挑空 slot，用光则回收最老 faded）
  ↓
playInjectAnimation：
  · 每个关键词一条独立粒子流
  · 从 + 按钮位置出发，沿随机弧度曲线飞向目标 slot
  · 每帧 emitBurst 撒发光粒子（尾迹）
  · 落地爆 25 粒子（凝聚感）
  · createLeaf 在该 slot 创建字粒子叶子（visibility 0→1 tween 显形）
```

## 已知未完成

- [ ] 点击叶查看记录详情卡（Canvas hit test 已实现，未充分测试）
- [ ] 主 App 入口（当前主 index.html 里树星是 locked，需挂上）
- [ ] 删除/编辑记录
- [ ] 时间轴回看
- [ ] 老词 faded 颜色淡化的统一处理（默认模式下区分新老，full 模式下统一清晰）

## 致谢

- 树底图：Lovart AI 生成（基于 mp4 风格参考）
- 字粒子化算法：离屏 Canvas getImageData 像素采样
- 动画：GSAP 3.13 (core + MotionPathPlugin)
- 中文分词：浏览器原生 Intl.Segmenter

---

*版本：v12.4*
*更新：2026-05-26*
