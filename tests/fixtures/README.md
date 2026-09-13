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
| `video/frames-rgb.webm` | **Known-good WebKit fixture.** 4.00 s, 320×180, VP8, 5 fps, all-intra keyframes. 1 s each: red / green / blue / yellow |
| `video/frames-rgb.mp4` | Same pictures, H.264 (Linux WebKit may not decode; keep for Chromium / fail-closed MIME tests) |
| `video/frames-rgb.ogv` | Same pictures, Theora/Ogg (secondary genuine encode) |
| `video/corrupt.mp4` | Not a video stream — fail-closed fixture |

Raw source video is **not** persisted in the app. Extracted JPEG frames are.

The WebKit **positive** E2E uses `frames-rgb.webm` only. `VIDEO_UNSUPPORTED` / `VIDEO_DECODE_FAILED` for that file **fails** the gate.

