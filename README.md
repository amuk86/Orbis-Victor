# Orbis Victor
Conquer the world. The die is cast.

Local title screen built with Next.js App Router, TypeScript, Tailwind CSS v4,
Cinzel, and the unmodified React Bits CRTWarp and DecryptedText JS/CSS components.

## Run locally

Use Node.js 20.9 or newer (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` creates the production build;
`npm start` serves it. The initial build needs access to Google Fonts for Cinzel.

The Play destination is the `PLAY_HREF` constant in `src/app/page.tsx` and
currently opens a minimal `/game/demo` placeholder. No authentication, database,
gameplay, or deployment is configured.

The background requires WebGL2; unsupported browsers keep the dark page and text.
Reduced-motion preferences are handled by the React Bits components.

The title background uses army-green phosphor (`#4b5320`) over `#120f17`,
the aperture mask, curvature `0.25`, persistence `0.4`, and brightness `1.4`.
Other CRT settings use the component defaults. Mouse warping and click-to-change
are disabled, and the fixed background does not intercept pointer events.

Components installed from the official React Bits registry:
- https://reactbits.dev/r/CRTWarp-JS-CSS.json
- https://reactbits.dev/r/DecryptedText-JS-CSS.json
