# Agent dev loop

A multi-agent loop that plays the game headless, finds problems, plans small tasks, implements them in git worktrees, verifies them and reviews them. Plain Node, no dependencies. Agents run through `claude -p --agent <name>` (subscription), defined in `.claude/agents/`.

```
          playtest.mjs (bot vs bot, worker threads)
                 │ reports/playtest-*.json (metrics + flags)
                 ▼
 triage ──► producer ──► backlog/tasks.jsonl ──► you: approve design changes
                                   │ todo
                                   ▼
 run ───► worktree .worktrees/T00N (branch loop/T00N)
            builder (or balancer for type=balance)
              │  ▲ gate failures fed back, max 3 rounds
              ▼  │
            gates.mjs: syntax · rule tests · determinism replay · smoke matches + perf · server boot
              ▼
            reviewer ── blocked: notes back to builder (max 2 review rounds)
              ▼ approved
            commit on loop/T00N ──► status "ready" ──► merge (you, or --auto-merge)
```

## Commands

```bash
node loop/playtest.mjs [--games 48] [--minutes 25] [--out FILE]   # metrics only, no LLM (~17 s for 50 games)
node loop/gates.mjs [--json]                                      # all hard gates (~20 s)

node loop/orchestrator.mjs status
node loop/orchestrator.mjs triage [-n 3] [--note "focus on the AI economy"]
node loop/orchestrator.mjs approve T004            # design-changing tasks start as awaiting-approval
node loop/orchestrator.mjs run                     # do the top todo task (priority, then id)
node loop/orchestrator.mjs run --task T002
node loop/orchestrator.mjs run --triage --max-tasks 3 --auto-merge   # one full unattended cycle
node loop/orchestrator.mjs merge T002              # merge a ready branch into the current branch
node loop/orchestrator.mjs retry T002 | reject T002 | clean T002
```

Task statuses: `awaiting-approval` → `todo` → `in-progress` → `ready` → `merged`; side exits `blocked` (agent says the spec is wrong), `failed` (gates still red after 3 rounds, or an error), `review-failed`, `rejected`.

## Playtest metrics and flags

Matchups: normal/hard mirrors 1v1, a normal 4-player FFA (40 min), and two ladders (hard vs normal, normal vs easy), spread over all four maps with fixed seeds, so the same code gives the same report.

| Flag | Meaning |
|------|---------|
| `stalemate` | more than 20% of games in a matchup had no winner in time |
| `seat-unfair` | in a mirror, start seats win at very different rates |
| `difficulty-order` | the stronger AI wins less than 65% |
| `unit-unused` / `unit-dominant` | a military unit is under 3% / over 45% of everything trained |
| `perf` / `perf-spike` | average tick over 10 ms in a game / a single tick over 50 ms (the server ticks every 100 ms) |

Thresholds are `T` in `playtest.mjs`.

## Safety rails

- Agents never push, deploy or touch `loop/`, `.claude/`, `backlog/` or Docker files (prompts + reviewer checks). Deploying stays manual.
- Tools per agent are allow-listed in `orchestrator.mjs` (`TOOLS`); producer and reviewer are read-only.
- Anything that changes the game design waits for `approve`. Balance changes are numbers only, at most ±25% per value.
- The loop stops after 2 tasks in a row that need a human. Each run writes a log to `loop/runs/<time>.jsonl` (agent outputs, costs, gate results).
- `merge` refuses to run with uncommitted changes and re-runs the gates on the merged branch.
- Changing `shared/sim.js` changes its hash, so replays saved before the change are listed but can't be played back (see README "Replays and stats").
