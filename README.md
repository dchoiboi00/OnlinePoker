# OnlinePoker
Online multiplayer poker game with solver

## Running locally

```bash
npm install
npm start          # serves on http://localhost:3000
```

Open the URL in two browser tabs (or tabs + a private window) to play a hand:
enter a username, **Sit Down**, then **Start Hand**.

## Tests

```bash
npm test           # unit tests (engine, hand evaluator) — node:test
npm run smoke      # end-to-end browser smoke test of a full hand
```

The smoke test boots the server, drives two browser players through a full
hand with Playwright, and checks private hole cards, betting controls, and the
showdown winner. It saves screenshots to `.smoke/`. One-time browser setup:

```bash
npx playwright install chromium
```

> Note: keep this project **outside** an iCloud-synced folder (e.g. not under
> `~/Documents`). iCloud rewrites `node_modules` mid-run, which corrupts
> dependencies and breaks `npm start`/tests.
