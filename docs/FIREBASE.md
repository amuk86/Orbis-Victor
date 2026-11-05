# Firebase + Vercel migration

No production project, credentials, rules, indexes, or deployment is provisioned by
this change. All example accounts in tests are disposable emulator accounts.
Never paste service-account private keys, passwords, or ID tokens into chat or Git.

## What was reused

The existing game engine, NPC strategy, CRT components, game board, ending screens,
local persistence and analytics were retained. There was no Firebase integration.
The engine now accepts an optional event offset so the server can append globally
numbered events without reading the entire history on every move. Default local
behavior is unchanged. The Play destination now opens `/play`.

## Modes and routes

| Route | Behavior |
| --- | --- |
| `/game/demo` | Original browser-local game; no Firebase writes or sign-in needed |
| `/analytics` | Existing browser-local analytics; not global online statistics |
| `/play` | Account-owned cloud campaigns and explicit import UI |
| `/account` | Google/password sign-in, sign-up, reset and sign-out |
| `/campaign/{id}` | Public shared view; authenticated owner alone can control |

If Firebase is unconfigured, cloud screens explain what is missing and link to the
independent demo. They do not silently switch persistence modes. Configured cloud
screens report authentication, loading, disconnected/cached, conflict and save
errors. A successful move is shown as saved only after the server confirms it.

## Local emulator setup (no production credentials)

Use Node 24 and Java 21 or newer on PATH. Install dependencies with `npm ci`.
Copy `.env.example` to the ignored `.env.local` and use these emulator values:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-orbis-victor.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-orbis-victor
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app-id
NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_PROJECT_ID=demo-orbis-victor
FIREBASE_USE_EMULATORS=true
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Leave `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` empty. Run in two terminals:

```sh
npm run emulators
npm run dev
```

Use http://localhost:3000/play. Emulator UI: http://127.0.0.1:4000. Create test
accounts in the application or emulator UI. The Google popup uses the emulator's
mock sign-in page. Password reset produces an emulator link; no email is sent.
Client and server must use the same `demo-orbis-victor` project. Emulators bind only
to localhost. Server configuration rejects emulator mode on Vercel and rejects
partially enabled emulators. Never put emulator host variables in production.

To retain development data across emulator restarts, run the CLI with
`--import=.emulator-data --export-on-exit=.emulator-data` (directory is ignored).
Tests start fresh and can clear the **demo** database; do not point them at real data.
See [Firebase emulator setup](https://firebase.google.com/docs/emulator-suite/install_and_configure)
and [Auth emulator behavior](https://firebase.google.com/docs/emulator-suite/connect_auth).

## Firebase console configuration (manual)

1. Create/select your Firebase project. Register a **Web app** in Project settings.
   Copy its public web configuration into the corresponding `NEXT_PUBLIC_FIREBASE_*`
   variables. The Firebase web API key identifies the app; it is not an Admin key.
2. Create **Cloud Firestore, Standard edition, Native mode**, default database.
   Choose a region near your intended Vercel function region before adding data.
   Start with restrictive rules, not temporary public-write test rules.
3. In **Authentication → Sign-in method**, enable **Google** (set a support email)
   and **Email/Password**. Configure your password policy and email templates.
4. Under Authentication settings, add authorized domains: `localhost` for local
   real-project testing and your exact production/custom Vercel domain. Do not
   assume new projects automatically authorize localhost. Add deliberate preview
   domains only to a separate development Firebase project.
5. Obtain a server identity securely. In a conventional Vercel setup, create a
   dedicated service account and store its project ID, client email and private
   key in Vercel's server-only environment settings. Grant data read/write/delete
   access and Auth user-read permission (revocation checks), rather than Project
   Owner. Alternatively configure Application Default Credentials/workload
   identity yourself; ADC is supported, but not automatically provisioned here.
   For local real-project use, keep credential JSON outside this repository and
   use `GOOGLE_APPLICATION_CREDENTIALS`, or use ignored `.env.local` fields.
6. Review `firestore.rules` and `firestore.indexes.json`. The owner listing needs
   the composite index included in that file. Index exemptions keep board/history
   blobs out of indexes. Emulator tests do **not** prove production index readiness.
7. **Only after explicit review/authorization**, you may run the following yourself:

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

This command has not been run. Wait for the composite index to finish building.
Official setup: [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin),
[email/password auth](https://firebase.google.com/docs/auth/web/password-auth).

### Campaign saves exist but the lobby cannot list them

Individual document saves and reads can succeed while the owner listing fails:
the listing requires the composite index in `firestore.indexes.json`. A missing
or building index is now reported beside the saved-campaign list, rather than as
an empty list. In Firestore → Indexes, check the `campaigns` collection index:
`ownerId` ascending, `status` ascending, `updatedAt` descending, and document ID
descending (collection scope). Wait until it is enabled, then refresh campaigns.
Publishing the checked-in index configuration still requires explicit approval;
no index or rules are automatically published by the application.

Cloud moves wait for a server transaction before allowing the next command.
The command response now includes the confirmed board and new events, so the owner
usually needs no follow-up state fetch. Listener updates for the same revision are
ignored; other-tab revisions or missing history pages still trigger a bounded
catch-up read. Older responses cannot roll back a newer board or skip a history gap.

Human reinforcement clicks now preview immediately without a request per soldier.
Placing the final available troop automatically submits one `reinforce-all` command
containing the ordered country/amount placements, the original revision and one
request ID. The server validates the full total and ownership, applies the existing
rules and saves the board and all placement events atomically. Attack/end-turn
controls stay locked until confirmation. Failed saves retain the preview and offer
**Retry saving allocation**, reusing the same request so a lost confirmation cannot
double-place troops. **Reload saved board** discards the preview and reads the
authoritative result; it does not undo a save that already committed. Another tab's
changes block further placement until the conflict is resolved. Partial allocations
are labelled unsaved and are kept only in memory: refreshing/leaving before the
last troop loses those unsubmitted choices. Spectators see confirmed placements.

Human redistribution clicks also preview instantly. Their ordered transfers are
saved in a `transfer-batch` command after 400 ms without another transfer click;
each new click restarts the timer. Clicks made while a request is saving remain
visible and become a later batch against the confirmed revision. Before an attack
or end-turn, the client cancels the timer, drains every pending batch, and only
then submits the requested action. Input locks during that barrier, rather than
during normal background transfer saves. Every transfer event is preserved, and
the server still validates turn/phase, ownership and leaving one soldier behind.
Packets are capped at 128 moves.

A failed/unconfirmed transfer save retains both its immutable retry packet and any
later clicks. **Retry saving transfers** confirms that packet before saving the
pending suffix; an attack/end-turn that was waiting then continues once. **Reload
saved board** cancels that queued action and discards the unsaved preview; it does
not undo already committed transfers. A stale version never overwrites another
device's moves. Pending previews live only in memory: leaving/refreshing before
confirmation can lose unsubmitted clicks. Spectators see confirmed batches only.

Normal mode still runs one NPC action per request with the existing animations.
Fast-forward sends `npc-batch`: at most 64 actions using the existing strategy and
server dice, stopping earlier at a human turn, game end, or response-size budget. One transaction checks
ownership/version, saves the final board, and appends all new events to history
pages. One revision represents one committed command/batch, not one individual
NPC action. Tied battles can reach the limit and resume in another batch. Turning
fast-forward off takes effect after the current bounded request. Spectators see
the committed final board and can read every event in the batch. The owner replays
every confirmed action at 170 ms per action using compact server-generated board
changes, including dice and dispatches. The menu, hidden tab, and defeat prompt
pause playback. Controls stay locked until playback finishes. These presentation
frames are returned with the save response and are not additional database writes.
Refreshing during playback resumes from the already-saved board; it does not
replay or submit those moves again.

The latest move's **Connection timing** disclosure reports browser request time,
server processing, Auth verification, transaction time, simulation time, actions,
and transaction attempts. The response also supplies `Server-Timing` for browser
DevTools. Transaction time includes reads, retries/backoff and commit; it is not
pure database network time. Read time is available in the response JSON. Browser
request time includes token acquisition, transport and response parsing; subtracting
server time is only an approximate overhead estimate. No credentials or tokens
are included. Compare warmed requests using `npm run build` / `npm start` before
judging production speed; development route compilation adds overhead. Emulator
benchmarks compare nine single-action transactions with one equivalent batch and
are not measurements of live Firebase/Vercel latency. No production moves are
created by the test suite.

## Vercel configuration (manual; no deployment performed)

1. Import the repository into Vercel only when ready to publish. Framework preset:
   **Next.js**; Node version **24**; install `npm ci`; build `npm run build`.
   Keep the default Next.js output directory; do not use static export.
2. Add public Firebase web configuration to the intended environment **before
   building**. Next.js embeds `NEXT_PUBLIC_*` at build time; changing them requires
   a new build. Scope Preview to a separate Firebase development project.
3. Add server-only `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
   `FIREBASE_PRIVATE_KEY` privately. Preserve PEM newlines or use literal `\n`;
   the server normalizes those. Never use a `NEXT_PUBLIC_` prefix for credentials.
   Set both emulator flags false and remove `FIREBASE_AUTH_EMULATOR_HOST` and
   `FIRESTORE_EMULATOR_HOST`. Keep all private values out of source control.
4. Choose a function region close to Firestore. Routes use the **Node.js** runtime,
   not Edge. Import finalization requests up to 60 seconds; confirm the function
   duration supported by your Vercel plan. Each upload request stays below 90 KB.
5. After authorizing publication, deploy through your own Git/Vercel workflow.
   Add the final domain to Firebase Authorized domains. Test real Google OAuth,
   password reset email delivery, cross-device resume, public viewing, and owner
   controls against that environment before using it for real campaigns.

### Firebase Auth startup on Vercel

The project pins Node 24 through `package.json`. Its scoped npm override keeps
`jwks-rsa` on the CommonJS-compatible `jose` 5 release line. Without this override,
Firebase Admin 14 loads `jwks-rsa` 4, which calls `require('jose')` on an ESM-only
release. Runtimes with `require(ESM)` disabled fail at startup with
`ERR_REQUIRE_ESM`, before the API can return JSON. This can appear in the browser
as an empty-response JSON parsing error.

Keep `package-lock.json` with this override and deploy using `npm ci`. The cloud
unit suite checks Firebase Auth startup and JWKS signing-key conversion in a
subprocess with `--no-experimental-require-module`. Remove the override only after
the upstream dependency works with that check. See
[the upstream compatibility issue](https://github.com/auth0/node-jwks-rsa/issues/507).

See [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) and
[Vercel environment variables](https://vercel.com/docs/environment-variables).

## Server authority and data layout

```
campaigns/{id}                      ownerId, revision, bounded board snapshot,
                                    eventCount, historyPages, provenance, status
campaigns/{id}/history/{page}       sequence + complete JSON event batches
users/{uid}/imports/{localIdHash}   private import manifest / permanent dedupe marker
.../imports/{id}/chunks/{index}    private temporary upload chunks
```

- The browser sends **commands**, an expected revision and a request ID, never a
  playable state or dice. The server checks a Firebase ID token, including
  revocation, then independently checks ownership and validates each command.
- Human rolls, first-player selection, country selection and NPC decisions run
  on the server with a cryptographic RNG. The same existing rules/NPC functions
  are used. Client-side animation delays only schedule requests.
- A Firestore transaction reads the campaign and checks the version. Board,
  revision and new history pages commit together. Simultaneous stale commands
  return 409. An immediate retry with the same request ID is idempotent; after
  later moves, an old version conflicts and must refresh.
- Clients cannot directly write campaign/history documents, including owners.
  Server Admin SDK bypasses Firestore rules, so server validation remains
  mandatory. Rules separately allow public reads of known ready campaign URLs,
  bounded owner-only campaign queries, and no access to import staging.
- Public snapshots include the owner's opaque UID to identify controls, but no
  account email, password or private credentials. Shared IDs are not passwords:
  everyone who obtains the URL can see the board and complete dispatch history.
- Public viewers use one board snapshot listener, not a polling loop. New history
  is fetched incrementally. Initial history is the latest 20 pages; earlier pages
  remain retrievable with **Load earlier dispatches**. Nothing is discarded.
- NPC progress is the persisted phase, attack, turn and board. A signed-in owner
  tab schedules one server-validated NPC step at a time, at the existing normal/
  fast-forward speeds. When no owner tab is active, simulation pauses; returning
  or another signed-in device resumes it. This uses no unreliable background
  Vercel timer and does not imply an always-running worker.
- Deletion first marks a campaign unavailable transactionally; recursive cleanup
  removes its history. Retry partial cleanup through the owner API. Import dedupe
  markers remain, so deleting then re-importing cannot silently resurrect a copy.

The server rejects snapshots above 200 KB and individual events above 500 KB
rather than committing data too large for Firestore. Normal history pages target
60 KB. These bounds prevent oversized writes; exceptionally enormous single
battles may be rejected with the previous state intact. Full history length does
not grow the board document. See [Firestore limits](https://firebase.google.com/docs/firestore/quotas)
and [transaction semantics](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Explicit local-save import

Inspecting browser saves is local-only. Select a save and explicitly consent to
uploading its publicly viewable campaign data. No login or page-load action
silently migrates anything. Uploads use resumable, fingerprint-checked 48 KB chunks
(up to 6 MB / 50,000 events). Retry uses the same per-user/local-ID import marker.

Finalization replays the complete log through the current engine with canonical
countries and NPC decisions. It rejects a forged/inconsistent board, missing
battle history, invalid dice, changed population data, or unsupported old rules.
Only a reconstructed matching state becomes a playable cloud campaign; live
commands have no endpoint for supplying state or dice. An import's original ID
maps to one cloud campaign; it is not a merge of later offline moves.

Past local randomness cannot be authenticated: users controlled the old browser.
Imported histories are explicitly labelled **legacy local imports**, not verified
online results. Replay proves consistency, not absence of historical local cheating.
Original browser saves are **never deleted**, including after cloud confirmation.
If an old save cannot be replayed, it remains usable in the separate local demo.

Import staging is private. Successful imports clean staging chunks after commit;
if cleanup fails, retry finalization or remove those private chunks manually.
Abandoned pending imports can retain staging storage; there is no scheduled cleanup
worker in this migration. Do not delete completed dedupe manifests.

## Reads, writes and expected costs

These are operation estimates, not a currency quote. Prices vary by region, plan,
index reads and usage: use the [current Firestore billing documentation](https://firebase.google.com/docs/firestore/pricing).

| Operation | Typical billed work |
| --- | --- |
| Create campaign | 1 transaction lookup + board/history writes |
| Successful command/batch | 1 campaign transaction read + 1 board write + new bounded history-page writes |
| Pending human reinforcement clicks | no additional requests or Firestore writes until the last available troop is placed |
| Pending transfer clicks | no save request until 400 ms of idle time or an attack/end-turn flush; one board write per confirmed batch |
| Owner move confirmation | board and new events in the same HTTP response; no extra API state read in the usual case; the board listener still reads the changed revision |
| Active viewer | initial board listener read, then one board read per changed revision, plus incremental history reads and API root reads |
| Open campaign | root read + latest up to 20 history pages; board listener also reads the root |
| Older history | root read + up to 20 earlier pages per request |
| Owner list | up to 30 campaign documents per page |
| Delete | marking write + reads/deletes for each snapshot/history document |
| Legacy import | manifest/chunk reads/writes, transaction reads, history writes, and staging deletes; proportional to size |

Transactions can retry; reconnects/listeners and even empty queries can incur reads.
All spectators multiply read and network costs. Fast-forward batches reduce board
writes and transaction reads per NPC action, and pack new events into fewer history
pages. Every event is still retained. Idempotent retries read the last command's
history pages to return the same confirmed result. No full-history read is needed
for an ordinary move. No unbounded global platform scan or automatic cloud analytics is added.
Local analytics is preserved and labelled local. Configure budgets/alerts and
appropriate Vercel rate limiting before inviting a large public audience. No rate
limit or App Check enforcement is claimed by this code.

## Tests and verification boundaries

```sh
npm test                  # existing local engine/NPC/storage/analytics tests
npm run test:cloud:unit    # command authority, offsets, replay, history paging
npm run test:emulators     # starts real Auth/Firestore emulators, loads test rules
npm run build
# With both emulators AND the app configured/running on port 3103:
npm run test:cloud:http
# Optional actual browser check (Node 24 and Google Chrome required):
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:cloud:browser
```

Emulator tests cover verified/forged tokens; password signup/signin/signout/reset;
mock Google credentials; anonymous public viewing; denied direct writes;
owner-only commands/list/delete; real simultaneous transactions; saving/resuming;
private staged imports; duplicate imports; malformed imports; complete paginated history; and delete cleanup.
Batch tests cover seeded equivalence to individual actions, tied battles reaching
the cap, victory/human-turn stops, complete saved event sequences, concurrent
batches and idempotent retries. The browser test checks actual normal/fast-forward
requests, every visible NPC turn during fast-forward, menu pause/resume, lack of
follow-up owner state fetches, and refresh/resume. It uses a
temporary Chrome profile and isolated demo campaigns. Set `CHROME_BIN` if Chrome
is installed elsewhere; `ORBIS_TEST_URL` defaults to `http://localhost:3103`.
Allocation tests cover immediate previews, invalid totals/ownership, concurrent
submissions, full event history, automatic submission on the final click, locked
controls during saving, and retry after an actually committed response is lost.
They deliberately fail rather than skip when emulator hosts are missing.

Transfer tests additionally cover resetting the idle deadline, immediate preview,
clicks during an in-flight save, draining before attack/end-turn, double-clicked
end-turn, immutable retry packets after lost confirmations, concurrent commits,
and rejecting invalid late moves without partial writes.

Emulators do not verify production IAM, actual Google OAuth/domain setup, real
email delivery, deployed Firestore indexes, Vercel networking, or cross-device
production services. Those require the manual configuration and real-environment
checks above. No production credentials or deployment was used to run these tests.

## Dependency advisory status

A gRPC override to `^1.14.7` replaces the vulnerable pinned client transitive
dependency. At implementation verification, the production-only npm audit had
**0 high/critical and 6 moderate** remaining transitive advisories (glob/minimatch
and related Google client dependency chains). Development tooling has additional
moderate advisories. These are not claimed resolved; review upstream patches
before production launch. No breaking `npm audit fix --force` downgrade was used.
