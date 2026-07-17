# Escape Room Probability Game

A web-based 3D escape room game for learning simple probability.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Vercel Deployment

Import this GitHub repository in Vercel. Use these settings if Vercel does not auto-detect them:

- Framework preset: Vite
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

Static assets are stored in `public/assets`.

## Project Structure

- `src/` - game source code, grouped by feature.
- `public/assets/` - runtime images, audio, and 3D models.
- `dist/` - generated build output from `npm run build` and not committed.
