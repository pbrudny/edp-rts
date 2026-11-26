# Ember Realms

Original browser real-time strategy game, single player (vs 1–3 AI, easy/normal/hard) and multiplayer (2–4 players by room code, free slots can be AI).
Live: https://rts.codewithpeter.com

Gather food (berries, farms), wood (trees) and gold (mines); build houses (+5 pop), barracks, storehouses (wood/gold drop-off), farms and a workshop;
train villagers, swordsmen, spearmen, archers, cavalry and battering rams; research upgrades. A player is defeated when all their buildings are destroyed.

## Peaceful mode
Single player option: the other villages (1-3 AIs) are allies. No one can attack anyone, vision is shared, allied AIs grow their economy
and keep only a small guard. There is no winner: the player builds as long as they like and "End game" shows the stats screen.

## Units and counters
Damage = attack + bonus vs the target − armour (melee) or arrow armour (archers, town centres), at least 1.

| Unit | Trained at | Strong against | Weak against |
|------|-----------|----------------|--------------|
| Swordsman | Barracks | spearmen, buildings | archers, cavalry |
| Spearman | Barracks | cavalry, rams | archers, swordsmen |
| Archer | Barracks | spearmen | cavalry |
| Cavalry | Barracks | archers, rams | spearmen |
| Battering ram | Workshop | buildings only (arrows barely hurt it) | any melee unit |

## Upgrades (researched once, in a building's queue)
Workshop: Forging (+2 melee attack), Fletching (+1 attack/range for archers and town centres), Chain mail (+1 armour/arrow armour for soldiers).
Storehouse: Double-bit axe (+20% wood), Gold mining (+20% gold). Town Centre: Wheelbarrow (carry 15, villagers 10% faster).

## Replays and stats
The simulation is deterministic (seeded RNG, AI included), so a replay is just the seed plus every player command with its tick.
Games with at least one human and 1+ minute are saved to `$DATA_DIR/replays/<id>.json` (Docker volume `rts-data`, newest 200 kept),
listed on the menu ("Recent games", `GET /api/replays`) and watchable at `/?replay=<id>` with 1-8x speed.
Each replay stores a hash of `shared/sim.js`: after a rules change old replays are listed but can't be played back.
The end screen shows per-player stats (units trained, kills, losses, resources gathered, upgrades) and charts of army size and resources over time.

## Architecture
```
browser --commands (WebSocket)--> server: room --> shared/sim.js (authoritative, 10 ticks/s) --snapshots--> browsers
                                                     \--domain events (batched REST)--> broker topic demo.rts --> event monitor
```
- `shared/sim.js`: the whole game rules (map generation, A* path finding, gathering, building, combat, AI). Imported by the server and by the client (constants, placement checks).
- `server.js`: HTTP + WebSocket (`ws`), rooms, command validation (players can only command their own entities), broker publisher.
- `public/`: Canvas renderer, input, HUD, menus.
- Events: `game_started`, `building_placed`, `building_completed`, `unit_trained`, `tech_researched`, `unit_killed`, `building_destroyed`, `attack_launched`, `player_defeated`, `game_over`.

## Controls
Left-drag select · right-click move/gather/build/attack · Q W E R build or train · A attack-move · S stop · `.` idle villager · H town centre · arrows/screen edge scroll · wheel zoom · minimap click to jump, right-click to move.

## Run / test
- Deploy: `/root/edp-rts` on steve107, `docker compose up -d --build` (clean env; `.env` has `EDP_BROKER_DEMO_PASSWORD`).
- `node test-sim.mjs normal normal` runs a headless AI-vs-AI game. `node test-replay.mjs` checks that recorded games replay identically (run it after any change to `shared/sim.js`). `test-bot.mjs` (run inside the container) plays scripted single-player and multiplayer sessions against a URL.

## Graphics (v2, 13.11)
- Renderer: PixiJS 7.4.2 (WebGL, self-hosted in `public/vendor`), isometric 2:1 view. Ground = top-down noise texture (`public/art.js`) re-projected with a matrix; fog of war = 80x80 alpha canvas projected the same way (soft edges for free).
- Sprites are original: low-poly 3D models (`baker/models.js`, Three.js r160) rendered by `baker/baker.html` from an isometric camera with shadows into atlases (`public/assets/*.png|json`). Units: 8 directions x idle/walk/attack/work/death. Each atlas has a `_mask` twin with the team-coloured parts, tinted per player at runtime.
- Re-bake: `cd baker && python3 serve.py 8767` then headless Chrome `--use-angle=swiftshader --dump-dom http://127.0.0.1:8767/baker.html`; copy `baker/out/*` to `public/assets/`.
- Fog of war is server-side (`visibility()` in `shared/sim.js`): players only receive what they can see; explored buildings stay visible.
- Sound: synthesised with Web Audio (`public/sfx.js`), no files. Watch mode: AI vs AI with speed 1-8x (`watch` message).
