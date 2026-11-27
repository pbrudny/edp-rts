# Ember Realms

Browser RTS. `docs/GAME-GUIDE.md` is the design document (every rule is described there); keep it in sync with behaviour changes. `README.md` is the friendly front page (basics, controls, screenshots); update it only when something it mentions changes. Technical details: `docs/ARCHITECTURE.md`.

- `shared/sim.js`: all rules + AI, imported by `server.js` and `public/client.js`. Must stay deterministic (seeded RNG only, no Math.random/Date in the sim): replays and `test-replay.mjs` depend on it.
- Tests: `node test-walls.mjs`, `node test-army.mjs`, `node test-replay.mjs`; everything at once: `node loop/gates.mjs`.
- Headless bot-vs-bot metrics: `node loop/playtest.mjs`.
- Agent dev loop (producer / builder / balancer / reviewer, worktrees in `.worktrees/`): see `loop/README.md`. Backlog in `backlog/tasks.jsonl`.
- Deploy is manual (`docs/ARCHITECTURE.md`, Deploy): never deploy or push from the loop.
