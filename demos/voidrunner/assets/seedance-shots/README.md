# Seedance Video Shot Pack

This folder is organized by video shot. Each subfolder contains the reference images for that shot and a `prompt.md` with the exact Seedance direction.

## Core Rule

You only need to generate clips that make the character / scene feel like a moving fake 3D game. Do not generate webpage UI, HUD overlays, menus, scan lines, button animations, or text panels unless a specific folder says otherwise. Those will be built later in the webpage.

## Complete Video List

| Folder | Video | Priority | Purpose |
| --- | --- | --- | --- |
| `00-menu-idle` | `menu-idle.mp4` | Optional | Main menu character breathing / tiny idle motion |
| `01-menu-standup` | `menu-standup.mp4` | Required | Menu crouch transitions into customization standing pose |
| `07-customization-idle` | `customization-idle.mp4` | Optional | Standing character idle loop in equipment screen |
| `02-weapon-switch-rail` | `weapon-switch-rail.mp4` | Required | Default cannon transforms into rail lance |
| `03-weapon-switch-plasma` | `weapon-switch-plasma.mp4` | Required | Default cannon transforms into plasma caster |
| `04-weapon-switch-arc-claw` | `weapon-switch-arc-claw.mp4` | Required | Default cannon transforms into arc claw |
| `05-match-dissolve` | `match-dissolve.mp4` | Required | Character dissolves from white studio into gameplay city |
| `06-gameplay-motion` | `gameplay-motion.mp4` | Required | Third-person rainy street idle / walking feel |
| `08-gameplay-aim` | `gameplay-aim.mp4` | Optional | Character raises weapon / aiming anticipation |
| `09-product-demo-motion` | `product-demo-motion.mp4` | Optional / later | Product capability animation if you want Seedance to handle this part |
| `10-match-default` | `match-default.mp4` | Wired | Default cannon match entry |
| `11-match-rail` | `match-rail.mp4` | Wired | Rail lance match entry |
| `12-match-plasma` | `match-plasma.mp4` | Wired | Plasma caster match entry |
| `13-match-arc` | `match-arc.mp4` | Wired | Arc claw match entry |
| `_web-effects-not-video` | none | Do not generate | Effects I will make in webpage: HUD, UI, button glow, scan lines |

## Suggested Work Order

Generate these first:

1. `01-menu-standup`
2. `02-weapon-switch-rail`
3. `03-weapon-switch-plasma`
4. `04-weapon-switch-arc-claw`
5. `05-match-dissolve`
6. `06-gameplay-motion`

Only generate optional clips if the core six look good.

## Output Settings

- Ratio: 16:9
- Resolution: 1920x1080 if available
- FPS: 24 or 30
- Duration: follow each folder's `prompt.md`
- Style: premium AAA sci-fi game cinematic, fake 3D render/gameplay feel
- Keep character identity consistent: white spiky hair, black biomechanical armor, red optic, exposed cables, hunched posture
