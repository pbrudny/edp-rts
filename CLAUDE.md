# Ember Realms

Browser RTS. `README.md` is the design document (every rule is described there); keep it in sync with behaviour changes.

- `shared/sim.js`: all rules + AI, imported by `server.js` and `public/client.js`. Must stay deterministic (seeded RNG only, no Math.random/Date in the sim): replays and `test-replay.mjs` depend on it.
- Tests: `node test-walls.mjs`, `node test-army.mjs`, `node test-replay.mjs`; everything at once: `node loop/gates.mjs`.
- Headless bot-vs-bot metrics: `node loop/playtest.mjs`.
- Agent dev loop (producer / builder / balancer / reviewer, worktrees in `.worktrees/`): see `loop/README.md`. Backlog in `backlog/tasks.jsonl`.
- Deploy is manual (README "Run / test"): never deploy or push from the loop.
