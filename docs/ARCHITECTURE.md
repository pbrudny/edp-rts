# Ember Realms: architecture

How the game is built, for developers and for Event Driven Programming students who want to read or extend it.

## Architecture
```
browser --commands (WebSocket)--> server: room --> shared/sim.js (authoritative, 10 ticks/s) --snapshots--> browsers
                                                     \--domain events (batched REST)--> broker topic demo.rts --> event monitor
```
- `shared/sim.js`: the whole game rules (map generation, A* path finding, gathering, building, combat, AI). Imported by the server and by the client (constants, placement checks).
- `server.js`: HTTP + WebSocket (`ws`), rooms, command validation (players can only command their own entities), broker publisher.
- `public/`: Canvas renderer, input, HUD, menus.
- Events: `game_started`, `building_placed`, `building_completed`, `unit_trained`, `tech_researched`, `unit_killed`, `building_destroyed`, `attack_launched`, `player_defeated`, `game_over`.

## Graphics
- Renderer: PixiJS 7.4.2 (WebGL, self-hosted in `public/vendor`), isometric 2:1 view. Ground = top-down noise texture (`public/art.js`) re-projected with a matrix; fog of war = 80x80 alpha canvas projected the same way (soft edges for free).
- Sprites are original: low-poly 3D models (`baker/models.js`, Three.js r160) rendered by `baker/baker.html` from an isometric camera with shadows into atlases (`public/assets/*.png|json`). Units: 8 directions x idle/walk/attack/work/death. Each atlas has a `_mask` twin with the team-coloured parts, tinted per player at runtime.
- Re-bake: `cd baker && python3 serve.py 8767` then headless Chrome `--use-angle=swiftshader --dump-dom http://127.0.0.1:8767/baker.html`; copy `baker/out/*` to `public/assets/`.
- Fog of war is server-side (`visibility()` in `shared/sim.js`): players only receive what they can see; explored buildings stay visible.
- Sound: synthesised with Web Audio (`public/sfx.js`), no files. Watch mode: AI vs AI with speed 1-8x (`watch` message).

## Tests
- `node test-sim.mjs normal normal` runs a headless AI-vs-AI game.
- `node test-walls.mjs` checks walls, gates, breaching, ages and the market.
- `node test-army.mjs` checks maps, formations, stances and path finding.
- `node test-replay.mjs` checks that recorded games replay identically (run it after any change to `shared/sim.js`).
- `node test-mp.mjs ws://127.0.0.1:3000` checks multiplayer sessions, teams, chat and pings against a running server.
- `test-bot.mjs` (run inside the container) plays scripted single-player and multiplayer sessions against a URL.
- `node loop/gates.mjs` runs all automatic checks at once.

## Deploy
- `/root/edp-rts` on steve107, `docker compose up -d --build` (clean env; `.env` has `EDP_BROKER_DEMO_PASSWORD`).
- Without `BROKER_URL` the server runs fine and simply doesn't publish events.
