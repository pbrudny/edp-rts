# Ember Realms: game guide

Every rule of the game, in one place. This file is the game's design document: when the rules in `shared/sim.js` change, this file changes in the same commit.

New to the game? Start with the [README](../README.md) for the basics and controls.

## Contents
- [Units and counters](#units-and-counters) · [Ages](#ages) · [Walls, gates, towers](#walls-gates-towers) · [Market](#market-castle-age) · [Upgrades](#upgrades-researched-once-in-a-buildings-queue)
- [Maps](#maps) · [Formations and stances](#formations-and-stances)
- [Peaceful mode](#peaceful-mode) · [Teams](#teams) · [Multiplayer sessions](#multiplayer-sessions) · [Chat, pings, control groups](#chat-pings-control-groups)
- [AI economy](#ai-economy) · [AI attack waves](#ai-attack-waves) · [Replays and stats](#replays-and-stats)

## Units and counters
Damage = attack + bonus vs the target − armour (melee) or arrow armour (archers, crossbowmen, towers, town centres), at least 1.

| Unit | Trained at | Strong against | Weak against |
|------|-----------|----------------|--------------|
| Swordsman | Barracks | spearmen, buildings | archers, cavalry |
| Spearman | Barracks | cavalry, rams | archers, swordsmen |
| Archer | Barracks | spearmen | cavalry |
| Cavalry | Barracks | archers, rams | spearmen |
| Knight (Castle Age) | Barracks | archers, crossbowmen, rams | spearmen |
| Crossbowman (Castle Age) | Barracks | spearmen | cavalry, knights |
| Battering ram | Workshop | buildings only (arrows barely hurt it) | any melee unit |

## Ages
Everyone starts in the Village Age. "Advance to Castle Age" at the Town Centre (400 food, 200 gold, 50 s; needs a finished Barracks
and Storehouse) unlocks the Workshop (rams, upgrades), Tower, Market, Knight and Crossbowman. The AI saves up for it once it has
a small guard. In the sim: `TECHS.castle`, `ageOf(techs)`, `unlocked(s, pid, item)`; `age: 2` on a kind marks it Castle Age.

## Walls, gates, towers
- Wall: press Build Wall, then press and drag on the map. A line of up to 24 one-tile pieces (8 wood each) that the selected villagers
  build one after another (`{t:"wall", x, y, x2, y2}`). Diagonal lines still block (no corner cutting).
- Gate: 1 tile; your own and allied units walk through, enemies can't. Placing a gate on one of your wall pieces swaps it in.
- Walls and gates have 10 arrow armour (arrows barely scratch them) and don't keep a player alive.
- Breaching: soldiers path *through* enemy walls/gates at a high cost (`passCost`, `BREACH = 14`). When a wall piece is the next step,
  they attack it and then carry on, so a long detour around a wall gets cut short, while a gap or gate nearby is still preferred.
- Tower (Castle Age, 2x2, 100 wood + 100 gold): shoots enemy units within 7 tiles; Fletching improves it.

## Market (Castle Age)
Buy or sell 100 food or wood for gold. Each player has their own prices: start at 100 gold, +6 per buy, -6 per sell (30-300),
and selling pays 75%. With allies, the market can also send 100 food/wood/gold to them (20% is lost on the way). The AI sells big
surpluses and buys what it is short of.

## Upgrades (researched once, in a building's queue)
Workshop: Forging (+2 melee attack), Fletching (+1 attack/range for archers and town centres), Chain mail (+1 armour/arrow armour for soldiers).
Storehouse: Double-bit axe (+20% wood), Gold mining (+20% gold). Town Centre: Wheelbarrow (carry 15, villagers 10% faster).

## Maps
Chosen in the menu (single player, AI battle, new lobby) or by the host in the lobby (`{t:"map", map}`). Same starts and resources, different terrain:
- Lakes (default): four lakes, scattered woods.
- Open plains: no water, few small woods; armies meet in the open, wood runs short.
- Black forest: thick woods with cut paths from every town to a clearing in the middle.
- River crossing: a river splits north from south with three fords (teams start on the same bank).
`createGame({ map })`, `MAPS` in `shared/sim.js`; replays store the map. `test-army.mjs` checks that every town can reach every other one on 30 seeds per map.

## Formations and stances
- A group move (or attack-move) forms up facing the march: melee in front, ranged behind, siege and villagers at the back.
  A group that starts close together marches at the pace of its slowest unit (the order carries `gs`).
- Stances (soldiers; Z / X / C or the buttons): Aggressive (default, chase anything in sight), Defensive (chase up to 7 tiles from where the
  fight started, then walk back), Stand ground (never move to fight, only hit what is in range). Explicit attack orders ignore the stance.

## Peaceful mode
Single player option: the other villages (1-3 AIs) are allies. No one can attack anyone, vision is shared, allied AIs grow their economy
and keep only a small guard. There is no winner: the player builds as long as they like and "End game" shows the stats screen.

## Teams
Every lobby slot has a team (1-4); new players and AIs start on a free team (= free for all). The host can change anyone's team, a player
their own. Start needs at least two teams. Allies share vision, can't attack each other, get neighbouring start corners, and win together
when they are the last team standing; a defeated player keeps watching their team's vision. Single player with 2+ opponents has
"You and one ally against the rest". In the sim: `players[i].team`, `allies()` / `enemies()`, `s.winTeam`.

## Multiplayer sessions
- Invite link: the lobby shows `/?join=CODE` with a copy button; opening it fills in the code.
- The host is tracked by the server; if the host leaves the lobby, the next human becomes host (Start / Add AI / Remove).
- Rejoin: every human gets a secret session token (kept in `localStorage`). If the connection drops or the page is reloaded, the client
  rejoins automatically (`{t:"rejoin", code, token}`). The slot is held for 60 s, then the player is resigned. Other players get notices.
  While every human in a game is disconnected, the game pauses. Opening the game in a second tab moves it there (first tab closes with code 4000).
- Open games: tick "List in open games" when creating (or the checkbox in the lobby, host only). Public lobbies that aren't full or started
  are listed on the menu (`GET /api/lobbies`, refreshed every 4 s) with a Join button.
- Spectating: a running public game shows up in the open games list with a Watch button; any running game can be watched by code
  (Watch next to Join, `{t:"spectate", code, name}`). Spectators see the whole map, can use all-chat (shown as "Name (watching)"),
  never see team chat, can't give orders and can't change the speed of a game with people in it. Max 8 per game.
  Games where every player has disconnected (paused) aren't listed.
- `node test-mp.mjs ws://127.0.0.1:3000` checks all of this (plus teams, chat, pings) against a running server.

## Chat, pings, control groups
- Chat: lobby chat box; in game Enter opens chat (Shift+Enter or Tab = team only), last 6 lines fade after 15 s. Max 140 chars, 5 per 5 s.
- Pings: Alt+click (map or minimap) or G at the cursor. Allies see a pulsing flag on the map and minimap, a sound, and Space jumps there.
- Control groups (client only): Ctrl+1-9 (or Alt) sets, Shift+N adds, N selects, N twice jumps the camera. A bar above the minimap shows them.
Chat and pings are not part of replays.

## AI economy
Idle AI villagers go to the resource furthest below its share of the villagers (food 45%, wood 30%, gold 25%). The shares follow the
stockpiles: a resource above 1500 counts at 0.3x its share, above 800 at 0.6x, below 150 at 1.6x. Every 10 s, if one resource is
above 1000 while another is below 150, up to 3 gatherers of the surplus move to the short one (`REBALANCE`). At most 2 villagers work
one farm (`FARM_CAP`); the rest go to another farm with room, or to wood/gold, and more farms get built as the villagers grow.

## AI attack waves
The AI keeps its soldiers near the base and sends a wave (every soldier plus its rams, attack-move to the nearest enemy building) once
`need = min(wave size + 2 per earlier wave, 18)` soldiers wait at home (wave size: easy 10, normal 7, hard 6). After 15 game minutes
`need` is capped at wave size + 4. It also launches (at most every 30 s, with at least the base wave size) when its soldiers number
`need` even if some still have orders, when it is at the pop cap, or, after 15 minutes, when the army has not grown for 60 s.
An enemy within 14 tiles of its base comes first: then all soldiers defend instead.

## Replays and stats
The simulation is deterministic (seeded RNG, AI included), so a replay is just the seed plus every player command with its tick.
Games with at least one human and 1+ minute are saved to `$DATA_DIR/replays/<id>.json` (Docker volume `rts-data`, newest 200 kept),
listed on the menu ("Recent games", `GET /api/replays`) and watchable at `/?replay=<id>` with 1-8x speed.
Each replay stores a hash of `shared/sim.js`: after a rules change old replays are listed but can't be played back.
The end screen shows per-player stats (units trained, kills, losses, resources gathered, upgrades) and charts of army size and resources over time.
