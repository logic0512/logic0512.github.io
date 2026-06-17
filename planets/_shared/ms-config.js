/**
 * Memory Sparks · 8 颗星配置
 * 故事 + 配色全部来自官方设计系统 design-system.html，禁止编造
 */
window.MS_PLANETS = {
  beizi: {
    orbit: '01',
    name: '被子星',
    keyword: '悲伤',
    accent: '#5a88b0',
    story: '被子星的人喜欢躲在被子里释放情绪，每当难受的时候，他们会在被子里大哭一场，直到被子浸湿，情绪也就彻底释放了。所以我们常常看见这颗星球的人在晒被子，奇怪的是，他们看起来都不太心事重重。',
    emptyHint: '把这件事挂出来晾晒',
    addTitle: '挂出来晾晒',
    img: '../../assets/planets/beizi.png',
    video: '../../assets/planets/videos/beizi.webm',  // 介绍卡圆球用抠像视频（无声循环）
    // 声音设计（§0.6）：三层
    //   背景层 = 温柔暖风（午后晾晒）
    //   hang   = 挂被子那一刻一记（衣物落下）
    //   drip   = 单颗水滴，被子湿→晾干期间「渐疏」播放（由 index.html 按晾干时间线排）
    sound: {
      // 替换：原氛围删除，新背景乐作为唯一背景（音量可按耳朵微调）
      src: '/assets/sounds/beizi-music.m4a',
      volume: 0.45, fadeIn: 2.6, fadeOut: 1.0, xfade: 3.0,
      oneShots: {
        hang: { src: '/assets/sounds/beizi-hang.mp3', volume: 0.5 },
        // 单颗水滴：每颗水珠「落地」那一下触发一记（由 index.html 挂在下落动画上）
        drip: { src: '/assets/sounds/beizi-drip.mp3', volume: 0.4 },
      },
      // 「添加」由挂被子声代表，跳过合成反馈；删除/更新仍给极轻合成音
    },
    palette: {
      bg:     'rgba(255,255,255,0.58)',
      border: 'rgba(90,136,176,0.22)',
      text:   'rgba(30,55,80,0.92)',
      mute:   'rgba(30,55,80,0.55)',
      shadow: 'rgba(42,80,120,0.16)',
      fabBg:  'rgba(255,255,255,0.7)',
      fabBorder: 'rgba(90,136,176,0.48)',
      fabIcon: 'rgba(30,55,80,0.85)',
    },
  },
  hiking: {
    orbit: '02',
    name: '行星',
    keyword: 'hike',
    accent: '#b4dc82',
    story: '行星上充满了不断延伸的山脊、森林、溪流和小径。这里的人生活在自然当中，早已把身心与自然相融，他们专注于脚下的路途，没有城市的喧嚣烦扰，也没有电子屏幕来碎片化他们的时间。他们会为每一次在自然里的发现而雀跃，为遇见的每个生命而赞叹。',
    emptyHint: '带回一张路上的照片',
    addTitle: '带回照片',
    img: '../../assets/planets/hiking.png',
    video: '../../assets/planets/videos/hiking.webm',
    // 声音设计（§0.6）：纯背景层（无交互音）= 风穿叶为主 + 远处溪流
    // 混音比例来自混音台（用户 2026-06-02）：风 0.15 / 溪 0.06(lp3950) 已烘进文件，volume=masterVol
    sound: {
      // 替换：原氛围删除，新背景乐作为唯一背景（音量可按耳朵微调）
      src: '/assets/sounds/hiking-music.m4a',
      volume: 0.45, fadeIn: 1.2, fadeOut: 1.2, xfade: 3.0,
    },
    // iframe 真实版（深绿玻璃卡，适配森林场景），不是 design-system 的浅白
    palette: {
      bg:     'rgba(8,25,12,0.55)',
      border: 'rgba(180,220,130,0.22)',
      text:   'rgba(230,250,215,0.95)',
      mute:   'rgba(230,250,215,0.60)',
      shadow: 'rgba(0,0,0,0.42)',
      fabBg:  'rgba(8,25,12,0.7)',
      fabBorder: 'rgba(180,220,130,0.48)',
      fabIcon: 'rgba(230,250,215,0.90)',
    },
  },
  healing: {
    orbit: '03',
    name: '治愈星',
    keyword: '治愈',
    accent: '#a06848',
    story: '治愈星的环境和人之间，有一种很微妙的关系。这个星球上没有医院，因为美好的感受会变成一个个看得见的光点，每当有人受伤，这些光点就会照到他身上，把他治愈。',
    emptyHint: '留下一个让你好起来的瞬间',
    addTitle: '放进美好时刻',
    img: '../../assets/planets/healing.png',
    video: '../../assets/planets/videos/healing.webm',
    // 声音设计（§0.6）：纯背景层（无交互音）= 空灵合成器 pad「绽放」（被微光环绕）
    sound: {
      // FLAC 无损 + 已烘进自交叉淡化 → 无缝循环，修掉 mp3 在接缝处「断一下」的问题
      src: '/assets/sounds/healing-ambience.flac',
      volume: 0.28, fadeIn: 1.0, fadeOut: 1.4, xfade: 4.0,
    },
    palette: {
      // 介绍卡固定中性浅奶米（取 SCENE_PALETTE 3 层 base 平均），跟 gentle/companion/inspire 都协调
      // 注：text 用 rgba 而不是 rgb，避免 ms-mount.js 的 _toRgbaLow 正则把 rgb(96,70,56) 错处理成 rgb(96,70,0)
      bg:     'rgba(248,240,230,0.82)',
      border: 'rgba(120,90,70,0.24)',
      text:   'rgba(96,70,56,1)',
      mute:   'rgba(96,70,56,0.55)',
      shadow: 'rgba(112,78,66,0.22)',
      fabBg:  'rgba(248,240,230,0.82)',
      fabBorder: 'rgba(120,90,70,0.32)',
      fabIcon: 'rgba(96,70,56,0.92)',
    },
  },
  flower: {
    orbit: '04',
    name: '花星',
    keyword: '爱',
    accent: '#c03870',
    story: '花星的花很神奇，被采下后只要重新种回土地，就会继续绽放，不会枯萎。花星人喜欢用互赠鲜花来表达爱意，再把这些花种在土地上保留下来。久而久之，每个人都有了自己专属的花园，他们会用自己的花园，向别人展示自己有多幸福。',
    emptyHint: '试试把爱变成花园',
    addTitle: '种下爱意',
    img: '../../assets/planets/flower.png',
    video: '../../assets/planets/videos/flower.webm',
    // 声音设计（§0.6）：野外开阔草地的柔风（Soft Wind），音量压得很低；种花一刻一记植物生长音
    sound: {
      // 融合：原氛围本就≈静音(0.02)保留 + 叠新背景乐
      src: '/assets/sounds/flower-ambience.flac',
      volume: 0.02, fadeIn: 1.2, fadeOut: 1.2, xfade: 3.0,
      oneShots: { bloom: { src: '/assets/sounds/flower-bloom.mp3', volume: 0.7 } },
      music: { src: '/assets/sounds/flower-music.m4a', volume: 0.45, fadeIn: 1.2, xfade: 3.0 },
    },
    palette: {
      bg:     'rgba(255,248,252,0.68)',
      border: 'rgba(192,56,112,0.22)',
      text:   'rgba(88,10,38,0.92)',
      mute:   'rgba(88,10,38,0.55)',
      shadow: 'rgba(140,20,60,0.15)',
      fabBg:  'rgba(255,248,252,0.78)',
      fabBorder: 'rgba(192,56,112,0.48)',
      fabIcon: 'rgba(88,10,38,0.85)',
    },
  },
  sea: {
    orbit: '05',
    name: '海星',
    keyword: '烦恼',
    accent: '#198ed0',
    story: '海星的海很厉害，它不仅能调节星球的气候，还能调节海星人的情绪。每当他们愤怒、烦恼、郁闷的时候，就会跑去海边大声倾诉，海洋从不拒绝任何人，会用海浪把他们吐出来的情绪一一带走。',
    emptyHint: '向大海倾诉',
    addTitle: '写下烦恼',
    img: '../../assets/planets/sea.png',
    video: '../../assets/planets/videos/sea.webm',
    // 声音设计（§0.6）：两层结构
    //   背景层 = 海的体量声/白噪音（无拍打），持续循环
    //   交互层 = 写下烦恼、海水冲洗沙滩那一刻叠加一记冲沙（playWash 触发）
    sound: {
      // 背景层 = 用户自备音乐（托斯卡纳艳阳下，2026-06-04 换入，经测试页确认）；交互层保留海浪冲沙
      src: '/assets/sounds/sea-ambience.flac',  // 背景层：托斯卡纳艳阳下（无缝循环）
      volume: 0.4,    // 背景音量（测试页默认值）
      fadeIn: 2.6,    // 进星球淡入秒数
      fadeOut: 1.0,   // 退出淡出秒数
      xfade: 3.0,     // 循环交叉淡化秒数
      // 交互层：海浪冲沙（候选2），写下烦恼/海水涌起那一刻触发 —— 保留（不影响音乐）
      wash: { src: '/assets/sounds/sea-wash-2.mp3', volume: 0.34, rate: 1, trim: 0.15, fadeIn: 0.2, fadeOut: 0.65 },
    },
    palette: {
      bg:     'rgba(251,245,230,0.76)',
      border: 'rgba(25,142,208,0.22)',
      text:   'rgba(10,45,75,0.92)',
      mute:   'rgba(10,45,75,0.55)',
      shadow: 'rgba(10,50,80,0.18)',
      fabBg:  'rgba(251,245,230,0.78)',
      fabBorder: 'rgba(25,142,208,0.48)',
      fabIcon: 'rgba(10,45,75,0.85)',
    },
  },
  starry: {
    orbit: '06',
    name: '繁星',
    keyword: '成就',
    accent: '#f0d870',
    story: '繁星的天空很低，星球周围有很多星星，但这些星星并不是我们所理解的卫星。它们是从繁星里“长”出来的——繁星人拥有制造星星的能力，会把自己的成就和收获变成一颗颗星星。星星彼此串联，久而久之，就为繁星绕出了一圈独特的星环。',
    emptyHint: '把这份收获，变成一颗星',
    addTitle: '记下闪光时刻',
    img: '../../assets/planets/starry.png',
    video: '../../assets/planets/videos/starry.webm',
    // 声音设计（§0.6）：夏夜篝火望星空 = 篝火噼啪(极淡) + 夜风；新星落位一记小风铃叮响
    // 混音来自调音台（用户 2026-06-02）：篝火 0.07 + 夜风(lp4800) 0.26 已烘进文件，volume=masterVol
    sound: {
      // 替换：原氛围删除，新背景乐作为唯一背景（音量可按耳朵微调）
      src: '/assets/sounds/starry-music.m4a',
      volume: 0.45, fadeIn: 1.5, fadeOut: 1.4, xfade: 3.0,
      oneShots: { twinkle: { src: '/assets/sounds/starry-twinkle.mp3', volume: 0.55 } },
    },
    palette: {
      bg:     'rgba(5,12,28,0.55)',
      border: 'rgba(240,216,112,0.18)',
      text:   'rgba(215,205,180,0.95)',
      mute:   'rgba(215,205,180,0.55)',
      shadow: 'rgba(0,0,0,0.48)',
      fabBg:  'rgba(5,12,28,0.7)',
      fabBorder: 'rgba(240,216,112,0.50)',
      fabIcon: 'rgba(240,216,112,0.95)',
    },
  },
  cloud: {
    orbit: '07',
    name: '云星',
    keyword: '自由',
    accent: '#7888c0',
    story: '云星上的重力很轻，人不会被大地束缚，可以在空中任意来去。这里的云也很特别，它们不会化成雨落下来，反而成了云星人珍藏宝物的地方。他们把自己最珍贵的东西都藏进云里，云朵便载着这些珍宝，跟着主人自由自在地四处漂泊。',
    emptyHint: '挑一样珍贵的，藏进云里',
    addTitle: '放进云里',
    img: '../../assets/planets/cloud.png',
    video: '../../assets/planets/videos/cloud.webm',
    // 声音设计（§0.6）：安静飘浮、几乎无声的高空软气息；新云飘入一记极轻羽毛软音
    sound: {
      // 融合：原氛围降到 20% + 叠新背景乐
      src: '/assets/sounds/cloud-ambience.flac',
      volume: 0.20, fadeIn: 2.0, fadeOut: 1.6, xfade: 4.0,
      oneShots: { drift: { src: '/assets/sounds/cloud-drift.mp3', volume: 0.4 } },
      music: { src: '/assets/sounds/cloud-music.mp3', volume: 0.45, fadeIn: 2.0, xfade: 4.0 },
    },
    // iframe 真实版（浅紫雾玻璃，更通透），不是 design-system 的米白
    palette: {
      bg:     'rgba(245,240,252,0.48)',
      border: 'rgba(120,130,200,0.32)',
      text:   'rgba(40,30,80,0.92)',
      mute:   'rgba(40,30,80,0.55)',
      shadow: 'rgba(50,40,100,0.15)',
      fabBg:  'rgba(245,240,252,0.7)',
      fabBorder: 'rgba(120,130,200,0.48)',
      fabIcon: 'rgba(40,30,80,0.85)',
    },
  },
  tree: {
    orbit: '08',
    name: '树星',
    keyword: '孤独',
    accent: '#9db898',
    story: '树星是离其他行星最远的星球。星球上只有一棵巨大的树，它不仅从荒凉贫瘠的土地里获取养分，还会把太空中路过的各种气息吸收转化成自己的能量。在这棵树身上，我们看到的不只是孤独，还有它想尽办法开枝散叶的那股生命力。',
    emptyHint: '写下这段独处',
    addTitle: '写下独处',
    img: '../../assets/planets/tree.png',
    video: '../../assets/planets/videos/tree.webm',
    // 声音设计（§0.6）：宇宙静谧体现孤独 = 纯空旷深空气流（月风，无旋律）；文字长成新叶一记树枝生长音
    sound: {
      // 融合：原氛围降到 25% + 叠新背景乐
      src: '/assets/sounds/tree-ambience.flac',
      volume: 0.25, fadeIn: 2.4, fadeOut: 1.6, xfade: 4.0,
      oneShots: { grow: { src: '/assets/sounds/tree-growth.mp3', volume: 0.6 } },
      music: { src: '/assets/sounds/tree-music.m4a', volume: 0.45, fadeIn: 2.4, xfade: 4.0 },
    },
    palette: {
      bg:     'rgba(2,12,4,0.58)',
      border: 'rgba(157,184,152,0.18)',
      text:   'rgba(185,205,180,0.95)',
      mute:   'rgba(185,205,180,0.55)',
      shadow: 'rgba(0,0,0,0.52)',
      fabBg:  'rgba(2,12,4,0.7)',
      fabBorder: 'rgba(157,184,152,0.48)',
      fabIcon: 'rgba(185,205,180,0.92)',
    },
  },
};
