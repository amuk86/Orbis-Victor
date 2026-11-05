# Orbis Victor

Conquer the world. The die is cast.

**Version 1 is live — [Play Orbis Victor](https://orbis-victor.vercel.app/).**

A single-player conquest game with separate local-demo and Firebase cloud modes, built with Next.js App Router, TypeScript,
Tailwind CSS v4, Cinzel, and React Bits CRTWarp / DecryptedText. The finished
landing page is preserved; Press Play opens `/play`. The independent local game remains at `/game/demo`.

**Firebase Authentication, Firestore, emulators and Vercel setup:**
[Read the migration guide](docs/FIREBASE.md). Copy `.env.example` to ignored
`.env.local` to configure cloud services for local development.

## Run locally

Use **Node.js 24** (also used by the built-in test runner).

```sh
npm install
npm run dev
```

For the credential-free local demo, open http://localhost:3000/game/demo.
For configured cloud play, open https://orbis-victor.vercel.app/ or press **Play**.
Keep the terminal open; `Ctrl+C` stops the app.

```sh
npm test        # 25 rules, analytics, persistence, access and commentary tests
npm run build   # production build, including TypeScript checks
npm start       # serve the production build locally
```

The initial installation/build needs internet access for packages and the existing
Google Fonts configuration. Cinzel is then served locally by Next.js. In local-demo play,
only optional flag images use the network; a three-stripe flag appears offline.
Population data for all 195 countries is bundled; see [data/README.md](data/README.md).

## Playing

- Round one: choose your move without reinforcements. From round two, click your
  countries to place all available reinforcements (two per country owned).
- Select your base, then an enemy, then **Roll dice**. Keep rolling until conquest,
  defeat, or **Stop attack**. Stopping ends your turn. You have one attack per turn.
- Outside combat, select your country, then click another of yours to transfer one
  soldier. Click your selected base again to deselect. Every country retains one.
- **End turn** passes to the next surviving commander. **Fast-forward** shortens NPC
  delays sixfold while retaining every decision, roll, and justification.
- Gold **Y** identifies your command; other commanders have unique letter badges.
  Filters dim cards without moving them. Commanders show countries / total soldiers.
- **Menu** pauses NPCs and offers a field manual, spectator mode, or saved campaigns.
  Small screens use two board columns, collapsible panels, and pinned controls.

## Local saves and boundaries

Every successful move saves to this browser's localStorage, including active
battles, fixed board positions, turn order, and the full append-only event log.
Multiple campaigns are independent. Continue one from setup, or begin another.
Clearing browser/site storage deletes saves. A storage failure displays a warning;
play can continue in the open tab. Invalid saved campaigns are ignored safely.

The game engine is pure TypeScript: `transition(state, action, rng)` returns a new
state and events. RNG is injectable for tests. `nextNpcAction` returns one decision
with a reason; React schedules each step. Rendering pauses when the tab is hidden.
`CampaignStore` isolates persistence; `PlayAccess` isolates the local owner check.
`getCommentary` is an async, local template service for later replacement.

The local demo still needs no authentication or cloud connection. Cloud play now
uses Firebase Authentication, Admin-verified commands, Firestore transactions,
separate history pages, and public campaign links. New dependencies are Firebase
client/Admin SDKs, the server-only guard, and emulator/security-rule test tools.
Production credentials, provider setup, rules/index publication and Vercel
deployment remain manual. LLM commentary is still local templates.

## Rule interpretations

- Conquest installs `max(2, floor(original soldier value / 2))` as the conquered
  country's new garrison. It does not deduct from the attacking country. This is
  centralized and documented in `conquestGarrison` in `src/game/engine.ts`.
- A successful or repelled attack consumes the one attack. Transfers remain
  possible before ending the turn; a deliberate stop ends it immediately.
- A round advances when the fixed, initially randomized turn order wraps.
  Eliminated commanders are skipped.
- Human elimination is a loss immediately. You can then watch the remaining war.
  NPCs follow the prescribed conservative scoring strategy; no hidden difficulty
  adjustment or forced winner is used.

## Source map

| Files | Purpose |
| --- | --- |
| `src/app/game/demo/page.tsx` | Campaign route and metadata |
| `src/app/game/demo/GameClient.tsx` | Setup, controls, battle, NPC scheduling, saved campaigns |
| `src/app/game/demo/game.css` | Scoped CRT console styling and responsive layouts |
| `src/app/game/demo/OutcomeScreen.tsx`, `outcome-quotes.ts` | Full-screen green victory / blood-red defeat and attributed PDF quotations |
| `src/game/engine.ts` | Pure rules, population table, state and event types |
| `src/game/npc.ts` | Shared NPC strategy and reasons |
| `src/game/commentary.ts` | Async local battle commentary |
| `src/game/storage.ts` | Replaceable local save adapter and validation |
| `src/game/access.ts` | Local owner/spectator capability boundary |
| `src/game/analytics.ts`, `src/app/analytics/` | Event-derived player and local platform statistics |
| `data/countries.json`, `data/README.md` | 195-country population snapshot and attribution |
| `tests/*.test.cjs` | Rules, full campaign simulations, saves and access tests |
| `package.json`, `.gitignore` | Test command and ignored compiled test output |

The original React Bits component sources remain unmodified:
- https://reactbits.dev/r/CRTWarp-JS-CSS.json
- https://reactbits.dev/r/DecryptedText-JS-CSS.json

Victory reuses the landing page’s green CRT settings; defeat uses blood-red
phosphor. Ending quotes come from `Gothic_War_Quotes_Latin_and_English.pdf`,
with author/work attribution and the supplied English translations for Latin.
Each campaign keeps its selected ending quote when reloaded.

## Player and platform analytics

Open **View analytics** from setup, **Player & platform analytics** from the game
menu, or the analytics link on an ending screen. Direct route: `/analytics`.

- **Your performance:** saved campaigns, wins/losses, completed-outcome win rate,
  attacks, captures, eliminations, casualties, dice distribution and country results.
- **Platform overview:** activity across every human/NPC commander in all valid
  saves in this browser, including battle rounds, dice, casualties and NPC decisions.
- **Campaign details:** current holdings, armies and combat statistics for each
  commander. The archive lets you choose which campaign to inspect.

No telemetry is sent. Statistics are calculated from the existing saved event logs
and current board, without changing gameplay. A resumed save is counted once.
Player defeat counts when the last country falls; the NPC war can remain ongoing.
Win rate excludes unresolved player outcomes. Captures include recaptures, and
dice statistics include attacking and defending. One battle round counts once
for platform totals; individual dice count both sides.

This is a **local platform overview**, not cross-user or cross-device analytics.
Deleting a campaign removes it from the figures, and clearing site storage clears
all data. Refresh reloads saves; changes made in another tab also refresh the
dashboard automatically. Invalid saves are excluded. No dependencies were added.
