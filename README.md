# OiS Fitting Lab

An interactive ship-fitting tool for [Objects in Space](https://store.steampowered.com/app/496300/Objects_in_Space/).
Pick a hull and a goal (stealth runner, combat corvette, explorer and others) and it fits modules and parts, shows the
efficiency, power, emissions and price maths, reads your own save to show every part and its wear, and switches between
the base game and the bugfix patcher's behaviour.

**Live page:** `https://Voidless7125.github.io/ois-fitting-lab/`

## Use it

Open `index.html` in a browser. It is one self-contained file: no install, no server, nothing uploaded (a save you load
is read in your browser only). Fonts come from Google Fonts and fall back to system fonts when offline.

## Where the data comes from

`game-data/` holds the game's own text files, copied from the game's `assets` folder:

| Files | Used for |
| --- | --- |
| `components.txt`, `compinterfaces.txt` | Parts, their efficiency/power/emission modifiers, and each module's slot chains |
| `modules_*.txt` | Every purchasable module |
| `modules_npc.txt` | Three NPC-only modules offered as "NPC kit": AP-RCS1, RM-SNS, Probe Sensor |
| `playableships.txt`, `arakaki.txt`, `harriswilson.txt`, `ventarii.txt`, `otherships.txt` | Hull slot layouts and values |

The module files are the **fixed** versions from the bugfix patcher's data fixes (the originals have module configurations
that do not match their slots). Everything else is as shipped.

## Rebuild after changing the data

```
python3 tools/build.py        # Python 3.8+, standard library only
node tools/test_core.js       # optional: checks the maths (Node 16+)
```

`build.py` reads `game-data/`, writes `data/data.json`, and assembles `src/` plus the data into `index.html`.
To update for a new game version, replace the files in `game-data/` and rebuild.

## Layout

```
index.html        the built app (this is what GitHub Pages serves)
src/core.js       data model, efficiency/chain maths, scoring, auto-fit
src/ui.js         interface, save-file reader
src/style.css
src/template.html
game-data/        the game's text files
data/data.json    extracted data (generated)
tools/            build.py, test_core.js
```

## Notes

- Formulas come from the decompiled game and its executable, not from observation in a running game.
- Reads version 12 saves (game 1.0.x) only.
- Game data and names belong to Flat Earth Games. This project is an unofficial fan tool.
