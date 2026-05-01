# Taxonomy doc — items NOT added in v18.1

Per your answer, I added items I could confidently match to existing categories.
This is what's still pending. Items grouped by what's blocking them.

## Items that need a NEW category to be created first

| Item | Doc count | Suggested category | Notes |
|---|---|---|---|
| Meths bottles | 16 | `cat_chemicals` (new) | "16 red meths bottles in cage" — fuel/cleaning |
| Brooms | 7 (2 yellow + 4 red + 1 floor) | `cat_cleaning` (new) | RC cleaning kit |
| Dustpans, soap | several | `cat_cleaning` | Same |
| Ratchets | 18 | `cat_ratchets` (new) | Under RC climbing wall |
| Alpine sleeping bags | 50 | `cat_sleeping_bags` (new) | Under RC climbing wall |
| Ski jackets | ? | `cat_ski_jackets` (new, sized_pool) | Need size breakdown |
| Compression bags | ? | `cat_compression_bags` (new) | Quantity? |
| Ski arm bands | ? | `cat_ski_arm_bands` (new) | Quantity? |
| Snow flags | ? | `cat_snow_flags` (new) | Quantity? avalanche-related |
| Thermal pants | ? | `cat_thermal_pants` (new, sized_pool/bucket) | Doc says XS/S/M/L/XL — need counts |
| Thermal tops | ? | `cat_thermal_tops` (new, sized_pool/bucket) | Same |
| Caving pants | ? | `cat_caving_pants` (new) | "Spare caving pants" — quantity? |
| Spare shorts | ? | `cat_spare_shorts` (new) | Quantity? |
| Spare active tops | ? | `cat_spare_active_tops` (new) | Quantity? |
| Towels | ? | `cat_towels` (new) | Quantity? |
| Poopshoots | ? | `cat_poopshoots` (new) | Quantity? |
| Flashlights | ? | `cat_flashlights` (new) | Quantity? |
| Bottles | ? | `cat_water_bottles` (new) | Quantity? |
| Cutlery / plates / bowls / cups | ? | `cat_kitchenware` (new) | Quantity per item type? |
| Floats (kayaking) | ? | `cat_kayak_floats` (new) | In tertiary container |
| Through bags | ? | `throwlines` exists (16 rows) — maybe duplicate? | "Through bags" likely = throwbags |

## Items that fit existing categories — need YOU to provide counts

| Item | Existing category | Doc reference | What's needed |
|---|---|---|---|
| Tents (named) | `tents` (currently 0 rows) | Sololite, Ridgeback, Wurley, Bush Buck, Hemisphere, Nissen Hut, Catalyst, PK Katmandhu, Mineret 5 | Count of each, location, expiry |
| Mountain boots | `boots_mountain` (3 bucket rows) | "Mountain boots" in clothes room | Size breakdown |
| Cave boots / Tramping boots | `boots_hiking`? or new cats? | "Cave boots, Tramping boots" | Decide: same cat or split |
| Backpacks | `backpacks` (3 bucket rows) | "Packs" in clothes room | Size breakdown |
| Socks | `socks` (1 row) | "Socks" | Count |
| Gloves | `gloves` (1 bucket row) | "Gloves" | Size breakdown |
| Hats | `hats` (2 rows) | "Hats" | Count |
| Sun hats | `hats`? or new cat? | "Sun hats" | Count + decide if separate cat |
| Rafting PFDs | `pfds_rafting` (2 rows) | "Container 1: Rafting PFDs sizes xs-xl" | Per-size counts |
| Rafting helmets (1-size) | `helmets_rafting` (0 rows) | "Container 1: Helmets 1 size" | Total count |
| Tertiary rafting helmets | `helmets_rafting` or `helmets_tech_rafting` | "Tertiary rafting helmets s/m/l" | Decide which cat + size counts |
| Tertiary PFDs | `pfds_tech` (1 row) | "Tertiary pfds s/m/l" | Per-size counts |
| Spray skirts | `spray_skirts` (41 individual rows) | "Spray skirts s/m/l" | Already covered as individuals — confirm |
| Kayak repair kits | `cat_kayak_repair_kits` (0 rows) | Tertiary container | Count |
| Roll mats | `cat_roll_mats` (1 bucket row) | "Unknown amount" — RC | Confirm count when known |
| Biolites | `biolites` (1 row) | "10 biolites in clothes room" | Currently 1 — should be 10 |
| Eddys | `cat_eddy` (0 rows) | "8 back climbing wall ropes, eddys..." | Count? |
| Rigging plates | `cat_rigging_plates` (2 rows) | None mentioned | OK as-is |
| Energy absorbers | `cat_energy_absorber` (3 rows) | None mentioned | OK as-is |

## Adjustments to existing buckets — quick fixes

| Category | Action |
|---|---|
| `biolites` | Bump existing row's pool count from 1 to 10 (or convert to 10 individual rows) |
| `cat_winter_gloves` | Doc says 50 total — current bucket sums to ~5. Need size breakdown to update properly |

## Pool T lists (to build separately)

Doc mentions 3 "Pool T lists" each containing:
- 6 twist-lock D carabiners
- 1 pulley
- 2 slings
- 2 harnesses
- 1 static rope

Plus per-list extras (set 1: 1 carabiner, set 2: 5 carabiners, set 3: 4 carabiners).
**These are LISTS of existing gear** — you'll build them in the app once you've
identified which specific carabiners/slings/etc go in each. Not done in this migration.

## Climbing wall stash

Doc: "8 back climbing wall ropes, eddys, triple lock carabiner, twist lock d
carabiner, prusik, top pulleys gearders, 2x spanner lock Carabiners"

This reads as a single grouped stash. Best handled as one Climbing Wall list
once individual gear rows exist. Rough mapping:
- 8 ropes → `dynamic_ropes` (already added 4 climbing wall ropes — bump to 8?)
- eddys → `cat_eddy`
- carabiners → `carabiners` / `cat_alloy_carabiners` / `cat_steel_carabiners`
- prusik → `prusiks`
- pulleys/girders → no current category
