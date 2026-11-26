# Ember Realms

Original browser real-time strategy game, single player (vs 1–3 AI, easy/normal/hard) and multiplayer (2–4 players by room code, free slots can be AI).
Live: https://rts.codewithpeter.com

Gather food (berries, farms), wood (trees) and gold (mines); build houses (+5 pop), barracks, storehouses (wood/gold drop-off) and farms;
train villagers, swordsmen and archers. A player is defeated when all their buildings are destroyed.

## Architecture
```
browser --commands (WebSocket)--> server: room --> shared/sim.js (authoritative, 10 ticks/s) --snapshots--> browsers
                                                     \--domain events (batched REST)--> broker topic demo.rts --> event monitor
```
- `shared/sim.js`: the whole game rules (map generation, A* path finding, gathering, building, combat, AI). Imported by the server and by the client (constants, placement checks).
- `server.js`: HTTP + WebSocket (`ws`), rooms, command validation (players can only command their own entities), broker publisher.
- `public/`: Canvas renderer, input, HUD, menus.
- Events: `game_started`, `building_placed`, `building_completed`, `unit_trained`, `unit_killed`, `building_destroyed`, `attack_launched`, `player_defeated`, `game_over`.

## Controls
Left-drag select · right-click move/gather/build/attack · Q W E R build or train · A attack-move · S stop · `.` idle villager · H town centre · arrows/screen edge scroll · wheel zoom · minimap click to jump, right-click to move.

## Run / test
- Deploy: `/root/edp-rts` on steve107, `docker compose up -d --build` (clean env; `.env` has `EDP_BROKER_DEMO_PASSWORD`).
- `node test-sim.mjs normal normal` runs a headless AI-vs-AI game. `test-bot.mjs` (run inside the container) plays scripted single-player and multiplayer sessions against a URL.

## Graphics (v2, 13.11)
- Renderer: PixiJS 7.4.2 (WebGL, self-hosted in `public/vendor`), isometric 2:1 view. Ground = top-down noise texture (`public/art.js`) re-projected with a matrix; fog of war = 80x80 alpha canvas projected the same way (soft edges for free).
- Sprites are original: low-poly 3D models (`baker/models.js`, Three.js r160) rendered by `baker/baker.html` from an isometric camera with shadows into atlases (`public/assets/*.png|json`). Units: 8 directions x idle/walk/attack/work/death. Each atlas has a `_mask` twin with the team-coloured parts, tinted per player at runtime.
- Re-bake: `cd baker && python3 serve.py 8767` then headless Chrome `--use-angle=swiftshader --dump-dom http://127.0.0.1:8767/baker.html`; copy `baker/out/*` to `public/assets/`.
- Fog of war is server-side (`visibility()` in `shared/sim.js`): players only receive what they can see; explored buildings stay visible.
- Sound: synthesised with Web Audio (`public/sfx.js`), no files. Watch mode: AI vs AI with speed 1-8x (`watch` message).
