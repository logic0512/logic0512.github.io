/**
 * Memory Sparks · 8 颗星主题图标（用在添加按钮上 — 不再用通用 +）
 * 用法：window.MS_ICONS[planetKey] → inline SVG 字符串
 */
window.MS_ICONS = {
  // 被子星：太阳（晒被子的暗喻 — 把伤心拿出来晒）
  beizi: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4.2"/>
    <line x1="12" y1="2.3" x2="12" y2="4.5"/>
    <line x1="12" y1="19.5" x2="12" y2="21.7"/>
    <line x1="2.3" y1="12" x2="4.5" y2="12"/>
    <line x1="19.5" y1="12" x2="21.7" y2="12"/>
    <line x1="4.93" y1="4.93" x2="6.48" y2="6.48"/>
    <line x1="17.52" y1="17.52" x2="19.07" y2="19.07"/>
    <line x1="4.93" y1="19.07" x2="6.48" y2="17.52"/>
    <line x1="17.52" y1="6.48" x2="19.07" y2="4.93"/>
  </svg>`,

  // 行星：山形 + 山顶星点（hiking 主题）
  hiking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 19 L9 11 L13 15 L17 7 L21 19"/>
    <circle cx="17" cy="5.4" r="1.1" fill="currentColor" stroke="none"/>
  </svg>`,

  // 治愈星：横向站立小猫（v3 方案 F — 大头矮脚婴儿身材，有眼鼻嘴 + 尾巴上翘）
  healing: `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="12" r="4.5"/>
    <path d="M5.5 9 Q4.5 4.5 8 7.5"/>
    <path d="M12.5 9 Q13.5 4.5 10 7.5"/>
    <circle cx="7.8" cy="11.5" r="0.6" fill="currentColor" stroke="none"/>
    <circle cx="10.5" cy="11.5" r="0.6" fill="currentColor" stroke="none"/>
    <circle cx="9.15" cy="13" r="0.55" fill="currentColor" stroke="none"/>
    <path d="M8.5 13.7 Q9.1 14.2 9.8 13.7" stroke-width="1.1"/>
    <path d="M13 13 Q19 11.5 22 14 Q23 17 21 18 L15 18 Q13 17.5 13 15.5"/>
    <path d="M14.5 18 L14.5 21.5"/>
    <path d="M16.8 18 L16.8 21.5"/>
    <path d="M19 18 L19 21.5"/>
    <path d="M21 18 L21 21.5"/>
    <path d="M22 14 Q25 11.5 24 8 Q23.7 6 25.5 6.5"/>
  </svg>`,

  // 花星：花朵
  flower: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 11.8 C 9.6 8.2 9.6 4.4 12 2.8 C 14.4 4.4 14.4 8.2 12 11.8 Z"/>
    <path d="M12 11.8 C 9.6 8.2 9.6 4.4 12 2.8 C 14.4 4.4 14.4 8.2 12 11.8 Z" transform="rotate(72 12 12)"/>
    <path d="M12 11.8 C 9.6 8.2 9.6 4.4 12 2.8 C 14.4 4.4 14.4 8.2 12 11.8 Z" transform="rotate(144 12 12)"/>
    <path d="M12 11.8 C 9.6 8.2 9.6 4.4 12 2.8 C 14.4 4.4 14.4 8.2 12 11.8 Z" transform="rotate(216 12 12)"/>
    <path d="M12 11.8 C 9.6 8.2 9.6 4.4 12 2.8 C 14.4 4.4 14.4 8.2 12 11.8 Z" transform="rotate(288 12 12)"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  </svg>`,

  // 海星：漂流瓶
  sea: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="10" y="3" width="4" height="2.5" rx="0.5"/>
    <path d="M10 5.5 L10 7 L9 8 L9 19 C9 20 10 21 11 21 L13 21 C14 21 15 20 15 19 L15 8 L14 7 L14 5.5"/>
    <line x1="9.5" y1="13" x2="14.5" y2="13"/>
    <line x1="9.5" y1="16" x2="14.5" y2="16"/>
  </svg>`,

  // 繁星：五角星
  starry: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3 L14.2 9.2 L20.5 9.6 L15.6 13.8 L17.3 20 L12 16.5 L6.7 20 L8.4 13.8 L3.5 9.6 L9.8 9.2 Z"/>
  </svg>`,

  // 云星：云朵
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 17 C4.5 17 3 15.5 3 13 C3 10.8 4.8 9 7 9 C7.4 6.5 9.5 5 12 5 C14.8 5 17 7 17.3 9.8 C19.5 10 21 11.5 21 13.6 C21 15.8 19.3 17 17.3 17 Z"/>
  </svg>`,

  // 树星：叶子
  tree: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 20 C6 13 9 7 18 5 C18.5 12 16 18 9 20 C9 20 8 19 6 20 Z"/>
    <path d="M7 19 C10 16 13 12 18 6"/>
  </svg>`,
};
