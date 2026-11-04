# Orbis Victor

Conquer the world. The die is cast.

A local single-player conquest game built with Next.js App Router, TypeScript,
Tailwind CSS v4, Cinzel, and React Bits CRTWarp / DecryptedText. The finished
landing page is preserved; Press Play opens setup and gameplay at `/game/demo`.

## Run locally

Use **Node.js 24** (also used by the built-in test runner).

```sh
npm install
npm run dev
```

Open http://localhost:3000 and press **Play**. Choose your country and begin.
Keep the terminal open; `Ctrl+C` stops the app.

```sh
npm test        # 17 engine, NPC, persistence, access and commentary tests
npm run build   # production build, including TypeScript checks
npm start       # serve the production build locally
```

The initial installation/build needs internet access for packages and the existing
Google Fonts configuration. Cinzel is then served locally by Next.js. During play,
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

No new dependencies were added for gameplay. Tests use TypeScript and Node's
built-in test runner. No authentication, cloud database, live sharing, LLM API,
or deployment is configured. Local spectator mode disables human controls; it
is not online authentication. These integrations are intentionally deferred.

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
