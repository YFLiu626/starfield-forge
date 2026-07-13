# Image Starfield Motion

Image-driven 3D starfield video generator. It uses a matched image pair:

- Starless image: nebula/background layer.
- Stars image: the only star source. Star positions, colors, and brightness come from this image.

The app extracts real stars from the stars image, assigns them to depth layers, and renders motion over the uploaded starless background. It can export PNG frames or WebM videos.

## Features

- Real star extraction from the uploaded stars-only image.
- Starless-image background with independent motion.
- Depth layers, bright-star foreground weighting, star size, and star brightness controls.
- Star motion modes: zoom in, zoom out, 8-way drift, floating drift, orbit.
- 8 direction choices for star movement: up, down, left, right, and four diagonals.
- Background motion modes: directional, free drift, zoom pulse, orbit, fixed.
- Background zoom-in and zoom-out motion modes.
- Background direction, speed, amplitude, zoom, and brightness controls.
- Chinese/English UI switch.
- Export size presets, duration, FPS, and WebM/MP4 format controls.

## Use

```bash
npm install
npm run dev
```

Production build and static preview:

```bash
npm run build
npm run serve
```

Default URL: `http://127.0.0.1:5173/`.
