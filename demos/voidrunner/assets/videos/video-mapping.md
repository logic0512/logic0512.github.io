# Generated Video Mapping

Source folder: `/Users/linchengjie/Desktop/测试效果`

All source videos are `1280x720`, `24fps`, about `5.04s`.

## Mapping

| Source | Destination | Use |
| --- | --- | --- |
| `0.mp4` | `assets/seedance-shots/00-menu-idle/menu-idle.mp4` | Main menu idle, optional |
| `1.mp4` | `assets/seedance-shots/01-menu-standup/menu-standup.mp4` | Menu crouch to standing pose |
| `2.mp4` | `assets/seedance-shots/07-customization-idle/customization-idle.mp4` | Customization standing idle, optional |
| `3.mp4` | `assets/seedance-shots/02-weapon-switch-rail/weapon-switch-rail.mp4` | Weapon switch to rail lance |
| `4.mp4` | `assets/seedance-shots/03-weapon-switch-plasma/weapon-switch-plasma.mp4` | Weapon switch to plasma caster |
| `5.mp4` | `assets/seedance-shots/04-weapon-switch-arc-claw/weapon-switch-arc-claw.mp4` | Weapon switch to arc claw |
| `6.mp4` | `assets/seedance-shots/05-match-dissolve/match-dissolve.mp4` | Match dissolve into gameplay city |
| `7.mp4` | `assets/seedance-shots/06-gameplay-motion/gameplay-motion.mp4` | Archived only; removed from the main demo flow because it felt redundant when layered after match entry |
| `7.mp4` | `assets/seedance-shots/08-gameplay-aim/gameplay-aim.mp4` | Archived only; optional gameplay aim material |
| `8.mp4` | `assets/seedance-shots/09-product-demo-motion/product-demo-motion.mp4` | Archived only; removed from the main demo flow because the extra motion looked muddy after entry |
| `9.mp4` | `assets/seedance-shots/11-match-rail/match-rail.mp4` | Rail lance match entry |
| `10.mp4` | `assets/seedance-shots/13-match-arc/match-arc.mp4` | Arc claw match entry |
| `11.mp4` | `assets/seedance-shots/12-match-plasma/match-plasma.mp4` | Plasma caster match entry |
| existing `match-dissolve.mp4` | `assets/seedance-shots/10-match-default/match-default.mp4` | Default cannon match entry fallback |

## Notes

- No required clip is missing.
- Weapon-specific match entry clips are now wired by equipped weapon:
  - `default` -> `match-default.mp4`
  - `rail` -> `match-rail.mp4`
  - `plasma` -> `match-plasma.mp4`
  - `arc` -> `match-arc.mp4`
- `7.mp4` and `8.mp4` are kept as archived source material, but the main interactive page no longer calls them. The demo now uses static webpage-controlled scenes after the weapon-specific match entry videos.
- Web-only effects remain ungenerated: HUD, crosshair, scan lines, buttons, stat bars, menu hover, page transitions.
