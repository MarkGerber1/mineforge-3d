# Deterministic Reality fixtures

Used by oracle + WebKit E2E. No user private media.

## Photo

| File | Size |
|---|---|
| `photo/south.jpg` | 1024×512 JPEG wall stand-in |
| `photo/portrait.jpg` | 32×64 |
| `photo/landscape.jpg` | 64×32 |

## Video

| File | Notes |
|---|---|
| `video/frames-rgb.mp4` | 4.00 s, 320×180, H.264, 5 fps, 4 colour segments (red/green/blue/yellow) |
| `video/frames-rgb.webm` | Same pictures, VP8 |
| `video/corrupt.mp4` | Not a video stream — fail-closed fixture |

Raw source video is **not** persisted in the app. Extracted JPEG frames are.
