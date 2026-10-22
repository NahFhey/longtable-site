# Timeline contract — `site/data/timeline.json`

The one file the bot writes and the site reads. Frozen 2026-09-06 against
DESIGN.md. The bot (`bot/`) is the only writer; the site (`site/`) is a read-only
consumer. Any change to this file is a schema bump and needs both lanes.

Amended 2026-10-21 to **schema 8**: optional `raid` definitions and an ordered,
table-only fight log make the finale replayable at any selected event time.
Deploy the schema-8 reader first; the bot continues writing schema 7 when no
raid is scheduled. See `raid` below. Schemas 1–7 cannot carry the raid key.

Amended 2026-09-06 to **schema 2**: two attendee event kinds, `shout` and
`donation` (see `events[]` and §Shouts). Additive for the site: a schema-1
file with no shouts is a valid schema-2 file. The site lane ships schema-2
support before the bot emits it; there is no bot-side flag.

Amended 2026-09-17 to **schema 3**: `people[].appearance` stores an attendee's
chosen skin, outfit, hair, and DM hat, or `null` for the original variant-based
look. Deploy the site's schema-3 reader before restarting the updated bot. The
site continues to accept schemas 1 and 2, treating appearance as `null`.

Amended 2026-09-18 to **schema 4**: required `room_layout` and `tables[].pad`
freeze table locations and room geometry. Appearance remains required. Deploy the
schema-4 site reader before restarting the writer. Schemas 1–3 retain their
original index-based layout; missing historical pad assignments are not recoverable.

Amended for Milestone G to **schema 5**: public recorded dice events. The reader
accepts schemas 1–5 and must deploy before the schema-5 writer. Private state 4
migrates to 5 while preserving event identity, window, pads, and existing records.

Amended 2026-09-19 to **schema 6**: required `visitors` object with `open`
(boolean) and `people` (unique, resolvable person IDs). The Visitors Table is a
coordinator-controlled group that does not reserve pads or game seats. A visitor's
active game assignment takes precedence; outside games they move among lounge,
food, and hall areas. Movement uses event time and a stable ID-derived route seed,
not a recorded activity. Group membership has current/final snapshot fidelity,
like table rosters. Private state versions 1–5 migrate to 6, preserving all records
and adding an empty visitor group. Private thread IDs and membership-retry IDs are
excluded. Deploy the schema-6 reader first. Older archives retain their renderer.

A legacy schema-4 fake day is in `timeline.sample.json`
(generated, deterministic; 8 DMs, 12 tables, 35 players, the organiser, 14 events).

## Conventions

- **Encoding.** UTF-8 JSON, one top-level object. Field names are `snake_case`.
  Unknown fields outside `raid` are ignored by the site (forward compatibility); the bot never
  omits a required field, and writes `null` rather than leaving a key out.
- **Time is a slot offset.** Every time in the file is a number of 30-minute
  slots since `event.start`. Slot 0 = 10:00 on event day, slot 48 = 10:00 next
  day. Ranges are half-open `[from, to)`: a table `[2, 10)` runs 11:00–15:00.
  - *Planned* values (table windows, presence, signups) are **integers**.
  - *Actual* values (`/here`, `/leaving`, event `at`) may be **fractional**:
    `2.23` is 11:07. Fractions are minutes-into-slot / `slot_minutes`.
  - Values are clamped to `[0, slots]`. Nothing before the window or after it.
- **Wall-clock conversion** (site side): `event.start` (ISO 8601 with numeric
  offset) + `slot * slot_minutes` minutes. `event.tz` is the IANA zone for
  display only. Both are config on the bot; a compressed dry run changes only
  `start`, `slot_minutes` and `slots`.
- **IDs are opaque strings.** `person.id`, `table.id`, `event.id` are stable
  across publishes and are only ever used as keys and cross-references. The site
  derives nothing from an id (not the sprite, not the name). The bot chooses
  them; they need not be Discord snowflakes.
- **Order.** `people` is unordered. `tables` is in creation order (the site
  uses saved pads for schemas 4–8; legacy schemas use array indices). `events` is in `at` order. `signups` is in signup order.

## Top level

| field | type | notes |
|---|---|---|
| `schema` | int | `7` without a raid, `8` with a raid (schema 2 added shouts; schema 3 appearance; schema 4 room layout and pads; schema 5 recorded dice; schema 6 visitor group; schema 7 player choices; schema 8 raid). Site refuses unknown majors. |
| `phase` | `"live"` \| `"final"` | `final` is the +14-day publish: names trimmed to first name + initial, bot retired. Site shows a "final record" note. |
| `generated_at` | string | ISO 8601 UTC instant the bot wrote the file. Shown as "last updated". |
| `event` | object | window config, below. |
| `room_layout` | object | Required in schemas 4–8. Version and capacities fixed for this event, below. |
| `people` | array | everyone who has ever signed up, created a table, or set presence. |
| `visitors` | object | Schema 6: `open` boolean and `people` person-ID array; no copied names or Discord IDs. |
| `tables` | array | current tables. Deleted tables are gone, not tombstoned. |
| `events` | array | admin `/event` history plus attendee shouts and approved donations. |
| `raid` | object or null | Optional in schema 8 only; see the raid log contract below. |
| `practice` | object | Optional pre-doors live-feed positions, speech and timed move history; see below. |

## `raid` (schema 8)

Schema 8 permits `raid` to be absent or `null` (no raid). Schemas 1–7 must not
carry the key, even with a null value. **The bot keeps emitting schema 7 when
no raid is scheduled and emits schema 8 only when a raid exists.** Deploy the
schema-8 reader first.

Unlike the older forward-compatible objects, every raid object and log kind has
exactly its documented keys: unknown or missing fields are errors. This prevents
accidental publication of private fields. No person ids may appear anywhere in
`raid` (including strings equal to a `people[].id`), and there are no coin balance,
grant amount, actor or free-text report fields. Pushes credit only a table.
Art is the one extensible string-to-string map; its keys are logical asset roles.
All ids and names must be nonblank strings. All numeric values are finite; integer
HP and maxima are bounded by JavaScript's safe-integer maximum (2^53 − 1).

| field | type | meaning |
|---|---|---|
| `id`, `name` | string | Stable raid definition id and display name. |
| `window` | `{start, end}` | Initial scheduled integer slots, `0 <= start < end <= event.slots`. Half-open `[start,end)`. Once opened, start is fixed; runtime end edits are logged below. Before opening, scheduling edits may replace this planned window, like table schedules. |
| `art` | `{key: string}` | Logical asset ids, e.g. `boss_phase1`, `boss_phase2`, `boss_phase3`, `king`. Does not imply an asset is available. Empty map is allowed for fallbacks. |
| `legs` | array | 1–8 unique `{id, side, name, special}` definitions. `side` is `L` or `R`; `special` is null or `{id, name}`, with a unique special id. Runtime maxima are deliberately absent here. |
| `actions` | array | Unique `{id, timer, name}` definitions; `timer` is `lair` or `core`. Resolved action targets are in each strike, not a random seed. |
| `checklist` | array | Unique `{id, kind, name}` definitions; `kind` is `room`, `boss`, or `heart`, with exactly one Heart. This raid defines nine items: four rooms, four bosses and the Heart. |
| `discharges` | integer array | Nonempty, strictly decreasing percentages in 1–99; this raid uses `[75,50,25]`. Percentages refer to the King's current maximum. |
| `members` | array | Current/final snapshot of `{table, leg}`. Table resolves to `tables[].id`; leg resolves to `legs[].id` or is null (reserve). Tables are unique and non-null legs hold at most one member. Destroyed legs may retain their party until it moves. This snapshot is not the replay's initial roster. |
| `log` | array | Ordered history, described below. May be empty while scheduled. |

Definitions and the initial schedule are static. All fight state is a fold of
`log` entries with `at <= t`: phase, assignments, maxima/HP, destroyed status,
timer, checks, active party, discharges, window edits and end result. The fold
starts unopened with no HP/timer/active party/checks. Before `open`, `members`
is only a preview of the planned roster. **Do not seed replay from the final
snapshot.** `open.members` supplies the complete initial roster, including
reserves that might later be removed. Subsequent `move`/`member` entries update it.

Every entry includes these fields, in addition to its kind-specific table:

| field | type | meaning |
|---|---|---|
| `at` | number | Fractional event slot in `[0,event.slots]`, never a wall-clock timestamp. |
| `kind` | string | One of the kinds below. |
| `admin` | boolean | True for entries caused by organizer controls; false for automatic and table actions. All resulting entries of an organizer action carry true. No organizer person id is published. |

Entries must already be in nondecreasing `at` order. **Equal times preserve array
insertion order; readers must not reorder them by kind.** State is the result
after all eligible entries, including all entries at exactly `t`. At most one
`open` and one `end` are allowed. Only `admin` entries may precede `open` or follow
`end`. Admin markers alone do not change HP or timers. The engine writes each
resulting state change explicitly, even at the same time.

### `open`

| field | type | meaning |
|---|---|---|
| `legs` | array of `{leg,max,table}` | Exactly one initialization per defined leg. Positive integer `max`; initial HP equals max, standing. `table` resolves or is null. |
| `members` | array of `{table,leg}` | Complete opening roster, with the same uniqueness/reference rules as the snapshot. Leg occupants must agree with `open.legs[].table`. |

`at` must equal `raid.window.start`. Starts Phase 1. It does not implicitly start
the timer: the next equal-time entry records the resulting timer. This added
`members` field is needed to reconstruct removed reserves without reading future
log entries.

### `phase`

| field | type | meaning |
|---|---|---|
| `phase` | integer 1–3 | Resulting raid phase, distinct from the King's local HP bands. |
| `cause` | `collapse` / `forced` / `heart` | Why phase changed. Forced changes carry `admin:true`. |

Opening already means Phase 1. Collapse writes `phase:2` then a stopped timer;
Heart discovery writes the check, `phase:3`, active party, King max/HP and a
started Core timer. Those are separate entries in that order. A phase entry never
resets HP or infers a timer transition.

### `leg_hp`

| field | type | meaning |
|---|---|---|
| `leg` | leg id | Leg whose HP was reported. |
| `table` | table id or null | Reporting member; always null for an admin HP correction, non-null otherwise. |
| `hp` | integer | Resulting HP, `0 <= hp <= max` in force. Higher HP is a heal, not negative damage. |

Zero HP is followed by `leg_destroyed` after confirmation. Leaderboard damage is
only the positive drop credited to a non-null table; a heal adds no damage.

### `leg_max`

| field | type | meaning |
|---|---|---|
| `leg` | leg id | Leg being overridden. |
| `max` | positive integer | New maximum, effective immediately. |
| `hp` | integer | Full resulting HP, bounded by the new maximum. |

Requires `admin:true`. This is an override, not table damage.

### `leg_destroyed`

| field | type | meaning |
|---|---|---|
| `leg` | leg id | Marks the leg destroyed. Its latest HP must already be zero. |
| `table` | table id or null | Credited member, or null for an organizer destruction. Null requires `admin:true`. |

Assignment remains until a move/removal. The engine counts destroyed legs and
records the resulting phase/timer entries if collapse is triggered.

### `leg_revived`

| field | type | meaning |
|---|---|---|
| `leg` | leg id | Clears destroyed status. |
| `hp` | integer | Resulting HP within the current maximum. |

Requires `admin:true`. Does not restore an old assignment or rewind phase.

### `move`

| field | type | meaning |
|---|---|---|
| `table` | table id | Current member moving. |
| `from` | leg id or null | Must match its assignment in the preceding fold state. |
| `to` | leg id or null | New assignment; non-null destination must be unoccupied by another party. |

Covers destroyed-leg moves, reserve takes and organizer moves. Maxima and HP are
unchanged. A null destination means reserve.

### `member`

| field | type | meaning |
|---|---|---|
| `table` | table id | Existing table being assigned/unassigned after opening. |
| `leg` | leg id or null | Assignment being added, or the preceding assignment being removed. |
| `change` | `add` / `remove` | Add requires a new member and unoccupied destination; removal must match the preceding member/leg. |

Requires `admin:true`. A removed table may remain in earlier log entries. The
complete assignment fold must equal the current `raid.members` snapshot.

### `strike`

| field | type | meaning |
|---|---|---|
| `action` | action id | Chosen action, resolves to `actions[].id`. |
| `timer` | `lair` / `core` | Must agree with that action's definition. |
| `targets` | table-id array | Unique current members receiving full text; resolved at strike time. For an all-target action, contains every running member. For a random action, contains the chosen tables. |

Targets may be empty if nobody is running. Readers display the logged choice;
they never reroll it. The engine follows each strike with a full timer entry.

### `timer`

| field | type | meaning |
|---|---|---|
| `timer` | `lair` / `core` / null | One visible clock, or stopped. |
| `next` | number or null | Absolute fractional slot of next strike, at least `at` (it may fall after `event.slots` in the last cycle of a raid that ends with the event); null when paused/stopped. |
| `paused` | boolean | True freezes remaining minutes; false otherwise. |
| `remaining` | number or null | Frozen minutes in `[0,interval]` while paused; null otherwise. |
| `interval` | number | Full cycle length in minutes, at least 1; retained even when stopped. |
| `pushes_left` | number | Nonnegative minutes of push allowance remaining this cycle, not a personal coin balance. |
| `cause` | enum | `start`, `strike`, `push`, `pause`, `resume`, `interval`, `stop`. |

Every visible change writes the **full resulting state**. A stopped timer has
`timer:null, next:null, paused:false, remaining:null, cause:"stop"`. A running
timer has non-null `next` and null `remaining`; a paused timer has null `next`
and numeric `remaining`. Pausing/resuming is an organizer action. Intervals do
not imply deadlines; an interval edit records the actual resulting deadline.
The Nerve Conduit normally changes the next cycle only. Pushes cannot exceed the
cycle's configured allowance or raise remaining time above the full interval;
the engine enforces these definition-dependent limits.

**Worked timer example:** with `slot_minutes:30`, a timer entry at `at:40`
with `next:40.13333333333333, interval:4` shows
`max(0, (next-t)*slot_minutes)` minutes: at `t:40.1`, about **1 minute**.
A push at `40.1` is followed by a timer entry with `next:40.16666666666667`;
at `t:40.12`, this shows **1.4 minutes**. A pause entry at `40.12` records
`next:null, paused:true, remaining:1.4`; at `40.2` it still shows **1.4**.
A resume at `40.3` records `paused:false, remaining:null,
next:40.34666666666666`; at `40.32`, about **0.8 minutes** remain. Select the
latest timer entry with `at <= t` (array order breaks ties). A stopped/missing
timer renders none. Display seconds may be rounded by the UI; never derive a
strike from rounding, pushes, phase entries, or wall-clock receipt time.

### `push`

| field | type | meaning |
|---|---|---|
| `table` | table id | Member credited for the spend, never the person. |
| `minutes` | number | Minutes purchased, at least 1; normally exactly 1. |

Adds to the table's coins-spent total (one coin per minute), with no public
balance. The following timer entry records the actual new deadline/allowance.

### `check`

| field | type | meaning |
|---|---|---|
| `item` | checklist id | Resolvable checklist item. |
| `table` | table id or null | Credited member; null only for an organizer action. |
| `undo` | boolean | False sets cleared; true clears it and requires `admin:true`. |

Checks are assignments to cleared state, not toggles; an undo removes the prior
room credit. Checks can continue in Phase 3. A Heart Valve effect is recorded as
a separate `king_max` entry; Prototype Prime grants publish no amounts or people.

### `active`

| field | type | meaning |
|---|---|---|
| `table` | table id | Resulting active member party at Heart discovery, hand-off or organizer selection. |

Hand-offs never reset King HP.

### `king_max`

| field | type | meaning |
|---|---|---|
| `max` | positive integer | Resulting King maximum at Heart discovery, Heart Valve or organizer override. |
| `hp` | integer | Full resulting HP within this new maximum. |

The first entry initializes the King. The engine computes 250 × running members
at Heart discovery, including reserves; this value is then fixed until a logged
override or Valve. Valve sets `floor(old_max * .85)` and reduces current HP by
the same point difference, never below 1. This is not table damage.

### `king_hp`

| field | type | meaning |
|---|---|---|
| `table` | table id | Reporting member (the active party; an organizer correction retains that table and sets `admin:true`). |
| `hp` | integer | Resulting HP within the most recent King maximum. |

Requires a preceding `king_max`. Only positive drops while the reporting table
is active count as its King damage; admin corrections are not damage credit.

### `discharge`

| field | type | meaning |
|---|---|---|
| `threshold` | integer | One of `raid.discharges`, percent of the current maximum. |
| `targets` | table-id array | Unique current member recipients of full text, normally the active party. |

The engine emits each crossed threshold once, descending when several are
crossed together, following the HP/max entry that triggered them. The fold records
the fired set; it never recalculates past strikes after the maximum changes.

### `admin`

| field | type | meaning |
|---|---|---|
| `action` | nonblank string | Machine action identifier, e.g. `coin_grant` or `window`; no personal data or grant amount. |
| `window` | `{start,end}`, conditional | Required exactly when `action:"window"`; resulting integer window, same bounds as the header and the same start. Replaces the effective window from this entry onward. |

Requires `admin:true`. For runtime window edits the header remains the original
schedule, allowing replay before the edit. To move opening time before opening,
replace the planned header; once opened, start cannot change. Other organizer
controls use their corresponding log kind, not an extra anonymous action marker.

### `end`

| field | type | meaning |
|---|---|---|
| `result` | `won` / `unfinished` | Final outcome. An early organizer end sets `admin:true`. |

Freeze final leaderboard state. The engine writes a stopped timer immediately
before ending. Only subsequent `admin` markers are legal. The full deterministic
example is `timeline.raid.sample.json`, generated by `gen_raid_sample.py`.

### Raid validation invariants

Both validators enforce exact shapes/types, nonblank strings, reference resolution
in all nested fields, duplicate-free leg/action/checklist/special ids, 1–8 legs,
one Heart, descending thresholds, and snapshot/open roster uniqueness. They enforce
slot/window bounds, sorted log order, the single opening at the original start,
one ending, and no fight entries before opening/after ending. Every current-member
reference and target resolves in the assignment fold; removals, moves and openings
must match their preceding roster. Opening initializes every leg once; all later
HP uses the maximum currently in force; destruction requires zero HP; King HP
requires prior initialization. Organizer-only kinds (`leg_max`, `leg_revived`,
`member`, `admin`), forced phase changes, pauses/resumes and undos require
`admin:true`. Timer cause/state consistency, nullability, numeric bounds
and action/timer consistency are validated. The final roster equals `members`.
No known person id may be embedded as a string anywhere in the raid.

The validators check the published contract, not combat policy: they do not infer
running eligibility from a final table snapshot, recompute random target counts,
collapse, phase progression, active-party permissions, effect rounding, coin
allowances or discharge triggers. Those belong to the later engine. Separate
entries preserve the actual results without fabricating intermediate events.

## `practice` (optional live-feed overlay)

Before doors the live feed may carry `{ people, speech, moves }`. It is absent from
Git snapshots, samples and archives, and sample/archive viewers ignore it.

- `people`: person-ID keys mapping to `{ position: "table" | "food" | "lounge", table: <table ID> | null }`.
- `speech`: recent `{ person, text, at }` entries, unchanged.
- `moves`: oldest-first `{ person, at, destination, table }` entries. `destination`
  is `table`, `food` or `lounge`; `table` is the destination table ID for a table
  move and null otherwise. `at` uses the same UTC format and publisher clock as
  `generated_at`. Every accepted move and Roll Dice's forced table move is kept;
  repeat Get Food clicks start new visits. Malformed move entries are dropped by
  the site validator.

The move history stays in bot memory until doors, even after idle positions reset.
It reconstructs completed kitchen services and the paused caretaker tour.
The site uses wall seconds and keeps the greatest `generated_at` minus viewer
receipt time as a lower bound on the clock offset.
A snapshot newer than the previous successful live poll supplies an upper bound
of `generated_at` minus that poll's receipt time plus two seconds for PUT latency;
the site keeps the smallest upper bound, with none from the first snapshot.
Clamping zero between these bounds leaves correct clocks alone on stale loads,
corrects slow clocks from a fresh first snapshot, and corrects fast clocks after
a new snapshot follows a successful poll.
Diners queue until food is ready, then take the event's
400-second visit and return to their preceding destination (or their thread seat, planned seat or lounge).
Later moves end the visit immediately; the kitchen still finishes service.

For an old bot without timed moves, the viewer remembers the first snapshot time
at which each person appeared at food. Later polls do not restart that visit.
Changing position permits a new synthetic visit; a repeat food click without any
observable position change cannot be detected by an old-bot viewer. Bot first,
then site is the rollout order. At doors practice is discarded with no handover.

## `event`

| field | type | notes |
|---|---|---|
| `name` | string | Organizer-supplied event name. Used in signup panels and the page title. |
| `start` | string | ISO 8601 with numeric offset, e.g. `"2026-11-07T10:00:00-05:00"`. Slot 0. |
| `tz` | string | IANA zone, e.g. `"America/New_York"`. Display only. The sample's value is a placeholder; the bot writes its configured zone. |
| `slot_minutes` | int | `30` for the real event. Dry run may shrink it. |
| `slots` | int | `48` for the real event. Window length = `slots * slot_minutes`. |

## `room_layout` (schema 4)

| field | type | notes |
|---|---|---|
| `version` | int | `1`. Unknown versions are rejected. Geometry rules are below. |
| `pad_capacity` | int | Positive safe integer. Default 20. All existing table records reserve one pad, including ended tables. |
| `overflow_capacity` | int | Nonnegative safe integer. Default 120 player seats beyond local seating. |

Version 1 uses world-tile coordinates: five columns, 6×6 cells, grid origin `(4,8)`.
Pad `p` has cell origin `(4 + 6*(p%5), 8 + 6*floor(p/5))`. Amended 2026-09-25: the
room is sized by the tables in the package, not by capacity, so a small event does
not sit in an empty hall. Table rows are `max(2, ceil((P+1)/5))`, where `P` is the
highest pad in use (`-1` with no tables), with grid bottom `B = 8 + 6*rows`. The
room is 42 tiles wide. Overflow rows are `R = ceil(S/15)`, where `S` is the sum of
every table's reserved overflow seats (below); room height is
`H = B + (R ? 2 + 2*R : 0) + 6`. A new pad past the last row, or a seat-count edit,
lengthens the hall; signups never change its size. The width never changes.

Fixed landmark rectangles `(x,y,width,height)` are stage `(35,1,6,H-2)`, food
`(1,1,16,6)`, and lounge `(1,H-6,33,5)`; the entrance is `(0,9)`. Overflow seat
`i` is `(4.5 + 2*(i%15), B + 2.5 + 2*floor(i/15))`. Occupied overflow chairs
are assigned by ascending pad then signup order. Individual attendees' overflow
chairs can change when rosters change. Ten local positions include the DM, so
each table reserves `max(0, seats-9)` overflow seats. The sum must not exceed
`overflow_capacity`, even for non-overlapping table windows. This ensures every
advertised seat can be filled in the room drawn for those tables.

Creation allocates the lowest free pad. Edits and early ending retain it. Deletion
(including the existing cancellation of an upcoming table) releases only that pad;
retained records never compact. Time-based reuse and retained table history are
not part of this contract. Creation or seat-count edits exceeding capacity are
refused atomically; the reader rejects collisions and invalid capacities and keeps
its last good live snapshot.

Private state versions 1/2 migrate to version 5 once, assigning pads in the saved
array order and atomically saving before live use. Capacities come from setup
configuration, enlarged only during migration if existing tables or seat counts
require it. Subsequent restarts use the saved layout. Offline `--check` previews
migration without writing. New events take configured capacities; the event window
editor and clearing test records preserve the current room. Archive packages carry
this layout version and capacities with their saved pads. Private version 3 keeps
its pads when migrating to version 5. Version 4 introduced a random event identity
and authoritative event configuration. Neither enters the public live schema.

## Player choices (schema 7)

Schema 7 adds required `people[].movements` arrays and extends dice bounds to
1–100 dice with any integer side count from 2–1000. Deploy the schema-7 reader
before the writer; readers continue to accept legacy schemas. Private state stays
at version 6 with empty movement histories supplied for older records.

Each movement is `{at, table, destination}`: `at` is a fractional event slot,
`table` is an existing opaque table ID or null for visitors, and `destination` is
`food`, `lounge`, or `table`. A table destination requires a table ID. Entries are
in time order; equal-time entries use insertion order. At the selected time, the
latest eligible entry controls location while the person is present. A table
entry applies only to that person's current game assignment. A visitor entry
applies only between games while in the visitor group and stops at the next game.
Explicit movement takes priority over automatic spotlight and meal
movement, except that a meal outranks a choice made before that person's meal
start (`meal.at`, or later if they arrive, sit out a break or leave the stage
after it). Such a choice resumes when their meal visit ends. A food visit still
running at their meal start counts as that meal. Event breaks temporarily send attendees to the lounge. Food choices
wait at the first queue if food is not ready. From `effectiveStart = max(visitStart,
serviceReadyTime)`, phases are serving-first [0,20), serving-second [20,40), seating
[40,70), eating [70,370), and trash [370,400), in event seconds. Before readiness,
the phase is `waiting`, labelled “the food queue, waiting for food”, without a plate.
Visits then resume
the previous eligible movement or current scheduled activity. Exact meal starts,
explicit food movements and four-minute visitor beat boundaries are the service
demand candidates; the same movement, break and assignment precedence decides
which candidates apply. A new service sets out food, cooks while it is available,
then clears after 300 seconds without a diner following the last visit end.
Cleanup waits for the cook to finish a kitchen segment and reach the pickup; a
new diner before cleanup starts restarts the quiet window. Demand during cleanup
waits for the next service at cleanup end. Empty attendance requests cleanup
immediately, followed by a walk to the light switch and door. These are derived
scene states, not new records or schema fields. Reduced motion uses identical
service times. Food choices never change seat reservations or attendance. Deleting a table
removes its movement references.

Dice-form submissions record a return to the active table. Private outcomes
remain private: only the movement is saved, without expression, faces, or total.
Invalid or rate-limited rolls leave both movement and dice history unchanged.

## `people[]`

| field | type | notes |
|---|---|---|
| `id` | string | opaque, stable. Referenced by `tables[].dm`, `signups[].person`, `events[].person`. |
| `name` | string \| null | display name captured at first signup and **stored** (renames don't rewrite history). `null` iff `hidden`. In `phase: "final"` it is first name + initial. |
| `dm` | bool | holds the DM role at publish time. Rendered with the distinct DM look. |
| `hidden` | bool | `/hide` was ever used. Honoured forever. `true` ⇒ `name`, `variant`, and `appearance` are `null`; site draws the generic unnamed sprite and no nametag, and never shows the id. |
| `variant` | int \| null | unsigned 32-bit FNV-1a hash of the Discord user id string, computed once by the bot. Site maps it to a sprite (`variant % palette_size`), so the art can change without the file changing. `null` iff `hidden`. |
| `appearance` | object \| null | Required in schemas 3–8. `null` uses the existing variant-based appearance. Otherwise exactly four integer indices: `skin` 0–3, `shirt` 0–14, `hair` 0–15, `hat` 0–3, mapped by `site/characters.mjs`. The hat is rendered only when `dm` is true. Always `null` when hidden. |
| `presence.planned` | `[int, int]` \| null | event presence `[arrive, leave)`. `null` if the person never set it (e.g. a DM who only created a table — see DESIGN open item: creating a table leans toward auto-setting presence to cover it). |
| `presence.actual.here` | number \| null | slot of `/here`, fractional. |
| `presence.actual.leaving` | number \| null | slot of `/leaving`, fractional. |

Appearance changes are accepted only from the registered attendee's Discord
interaction identity. The private Discord-to-person mapping never enters this
file. Choices persist across bot restarts and role refreshes; resetting them
restores the original `variant` look. `/hide` clears choices permanently.

**Effective presence** (site rule, applied everywhere a person is drawn):
`arrive = actual.here ?? planned[0]`, `leave = actual.leaving ?? planned[1]`.
If both `planned` is `null` and `actual.here` is `null`, the person is never in
the building. A person with only `actual.here` stays until `slots`.
`/here` after `/leaving` (someone comes back) is out of scope: the bot keeps the
latest of each and the site takes the effective range as given.

## `tables[]`

| field | type | notes |
|---|---|---|
| `id` | string | opaque, stable. |
| `name` | string | 1–60 chars. |
| `system` | string | free text, default `"D&D 5e"`. |
| `pitch` | string | one line, ≤ 200 chars. |
| `seats` | int | seat cap, ≥ 1. A seat counts for the whole table window. |
| `walk_ins` | bool | walk-ins-welcome flag. Display only; does not change seat accounting. |
| `start`, `end` | int | `[start, end)` slots, `end > start`. One DM's own tables never overlap; different DMs' tables may. |
| `dm` | string | `people[].id` of the DM. Always present in `people`. |
| `created_at` | string | ISO 8601 with offset. Informational; `pad` is authoritative for grid position in schemas 4–8. |
| `signups` | array | seated players, ≤ `seats` entries. The DM is not in this list. |
| `pad` | int | Required in schemas 4–8. Unique zero-based location, `0 <= pad < room_layout.pad_capacity`. Independent of ID, array order, and table window. |

### `tables[].signups[]`

| field | type | notes |
|---|---|---|
| `person` | string | `people[].id`. Always present in `people`. A person appears at most once per table and holds no two seats whose `planned` ranges overlap. |
| `planned` | `[int, int]` | `[from, to)` within the table window. Defaults to overlap of the person's planned presence and the table window; player may override per table. |
| `actual` | `[number \| null, number \| null]` \| null | optional actual range at this table. `null` means unknown. Either end may be `null`. Bot v1 fills it from `/here` / `/leaving` clipped to `planned` when that changes the range; a future per-table check-in command would write it directly. |

**Where a person is drawn** (site rule): at slot `t`, a person inside their
effective presence is *at table X* if some signup on X covers `t` — using
`actual` where an end is non-null, else `planned` — else in the lounge. Outside
effective presence they are not drawn. Events (below) temporarily override this.

## `events[]`

| field | type | notes |
|---|---|---|
| `id` | string | opaque, stable. |
| `kind` | `"break"` \| `"meal"` \| `"announce"` \| `"spotlight"` \| `"shout"` \| `"donation"` \| `"roll"` | closed set. New kinds are a schema bump because each needs its own scene reaction. `shout` and `donation` were added in schema 2. |
| `at` | number | slot the event entered the timeline, fractional: when the admin issued it, when the person reacted, or when the table DM approved the custom message. |
| `duration` | number \| null | slots, fractional (`0.5` = 15 min). Required for `break` and `meal`; `null` for `announce`, `spotlight`, `shout`, `donation`, and `roll` (the site uses a fixed reaction length). |
| `text` | string \| null | `announce`: the message, ≤ 280 chars, required. `meal`: optional label ("Dinner"). `spotlight`: optional reason line. `shout`: the quick-reaction phrase chosen, ≤ 80 chars, required. `donation`: the DM-approved custom table message, ≤ 80 chars, required, verbatim after controls are stripped and whitespace is collapsed. `break` and `roll`: `null`. |
| `person` | string \| null | `spotlight`: the person spotlighted. `shout`: the quick reactor. `donation`: the player who submitted the custom message. All `people[].id`, required for those kinds. `roll`: the roller, required. `null` otherwise. |
| `by` | string | `people[].id` of the person whose action put this event in the timeline: the admin for the four admin kinds; the table DM for `donation`; the reacting person for `shout` or `roll` (so `by == person`). Never null. Informational. |

Scene reactions are the site's business and are listed in DESIGN.md; the file
records only what was issued and when.

### Dice (schema 5)

A `roll` additionally requires `table` (an existing opaque table ID), `visibility`
(`"public"`), and `roll` with exactly `expression`, `sides`, `faces`, `modifier`,
and `total`. `person` and `by` identify the roller and must match. `duration` and
`text` are null. Other event kinds do not carry dice fields.

The command visibility enum is `public | private`. Private outcomes are ephemeral
and are never stored, assigned event IDs, exported, or archived; no dice occurrence
marker is published (the dice form can separately save a return movement). A public payload with private visibility is invalid.

Expressions normalize to `NdS`, optionally followed by a nonzero signed modifier.
In schema 7, N is 1–100 and S is any integer from 2–1000. Earlier writers
used 1–20 dice and the standard d4/d6/d8/d10/d12/d20/d100 sizes. Modifier is an integer from −1000
to +1000. `faces` contains N integers in `[1, S]`; `total` equals their sum plus
the modifier. For example, `2d6+3`, faces `[3,4]`, modifier `3`, total `10`.
The bot generates each face once with `secrets.randbelow`; the browser never rolls.

The latest result at or before selected time is displayed per table. Equal-time
rolls retain input order. A deterministic three-second 2D toss uses selected time
and an event seed, then settles on the recorded faces. Up to six dice are drawn;
the accessible result includes every face, modifier, and total. Reduced motion
settles immediately. No system-specific critical/fumble claim is inferred.
Hiding the roller applies through the opaque person reference; text contains no
copied identity. Moderation can remove a public roll. Deleting a table also removes
its rolls under the existing final-snapshot retention model.

### Shouts (schema 2)

- A `shout` is a fixed phrase from a menu the admin configured; a `donation`
  is the legacy contract name for a free custom line a table participant typed
  and that table's DM approved. The site gives them different reactions, with
  the reviewed custom message receiving a six-second gold bubble at the stage
  microphone after its speaker walks up the side stairs. Waiting custom-message
  speakers queue below the stairs; each leaves the stage before the next speaks.
  Both are speech from the
  `person`'s sprite; a hidden `person` gets the generic unnamed sprite and no
  nametag exactly as everywhere else.
- **Pacing is the site's job.** The bot applies a per-person cooldown on
  `shout` but no global cap, and the publish debounce delivers shouts in
  batches. The site plays them in `at` order, one or a few at a time, each
  for a few seconds, and in live mode may drop the oldest unplayed ones if
  the backlog grows. Every shout and donation stays in the data for the
  replay regardless.
- Both kinds survive into the `final` record untouched: name trimming
  applies to `people[].name` only, never to `events[].text`. Custom lines
  that were never approved are not in the file in any phase.

## Invariants the bot guarantees (site may assume)

1. Every `dm`, `signups[].person`, `events[].person` resolves to a `people[].id`.
2. No two tables with the same `dm` overlap in `[start, end)`.
3. `len(signups) <= seats` on every table.
4. No person holds two signups with overlapping `planned` ranges (across tables).
5. `signups[].planned` lies within the table's `[start, end)`.
6. All slot values lie in `[0, slots]`; planned ones are integers.
7. `hidden` ⇒ `name == null && variant == null`; `!hidden` ⇒ both non-null.
8. The file is written atomically and committed whole; the site never sees a partial file.
9. Schema-8 raids obey the full Raid validation invariants above; schemas 1–7 omit `raid`.

## What the site does with it

- **Viewer time:** live-source initial viewing follows now inside
  `[start, start + window + 1h]` when `phase` is live. A user's pause, seek, or
  replay choice persists until Return to Now; refreshing never overrides it.
  Follow-now clamps at event end and does not automatically rewind. Live-source
  packages refetch while `phase` is live, even when paused or replaying: every
  30 s before the event, every 2 s from one hour before doors, and never while
  the tab is hidden. Before `start` the site shows the gathering (attendees
  placed by their sign-ups) and, in the last 24 h, the dark eve; `upcoming` is
  a viewer clock mode derived from the wall clock, not a package phase.
  Sample/archive sources never auto-follow; archive and final replay start paused.
  `phase: final` continues to mean privacy finalization, not a viewer clock mode.
- **Lifecycle:** scenery is derived from table windows and selected slots, without
  adding facts to the package. Preparation starts 20 minutes before play, ready
  starts 5 minutes before play, cleanup lasts 10 minutes after play for 30-minute
  slots. Multiply minutes by `min(1, slot_minutes/30)` for compressed events; all
  boundaries clip to `[0, slots]`. Phases are half-open. Props show only during
  ready/play; setup/cleanup additionally draws staged maps, chairs, and furniture.
  Anonymous staff and those props are derived scenery, never attendance. The accessible
  table list includes all records even when their furniture is inactive.
- **Seeking:** load `?at=<slot>` or scrub to reconstruct the same lifecycle,
  meaningful locations, and ongoing admin events. Seeking clears transient
  reactions; it never enqueues the interval skipped. Sequential reaction playback
  is bounded separately. See the site README for clock and presentation rules.
- **"Last updated"** = `generated_at` rendered in `event.tz`.
- **Table list** (canonical accessible interface) = `tables[]` with resolved DM
  and roster names; hidden people appear as "someone".


## Archive package (Milestone E)

New timelines use schema 7 without a raid, schema 8 with a raid; older frozen packages retain their original schema. A separate archive envelope (`archive.json`, format
1) records `event_id`, `preserved_at`, `fidelity: "final-schedule"`,
`presentation_version: 1`, renderer SHA-256, timeline schema, and `room_layout`.
It lives beside `index.html` and `timeline.json` at `events/<event-id>/`. Event
identity is independent of resettable person/table/event counters.

Before Start New Event clears state, the bot validates and saves a private
snapshot plus its renderer and privacy deadline. Publication waits until that
original event's end plus the configured finalization delay, or explicit final
projection. The public archive is always `phase: final`, using the same name
trimming and hidden-person projection as the live final package. Approved free
text is unchanged. Untrimmed names are removed from private pending output before
network publication; failures retry the same finalized bytes.

This package is a final-schedule replay, not a change log. It contains only facts
remaining at preservation time. Archive pages use the same frozen model/renderer,
load only the sibling package, start paused, and never poll or use sample fallback.
Moderation can redact an archived person or remove an archived reaction and queue
a replacement publication. Earlier public Git revisions are not erased.

## Archive catalog (Milestone F)

`data/events.json` is a separate format-1 envelope: `{ "format": 1, "events": [...] }`.
Each entry has `event_id` (32 lowercase hexadecimal characters), `name`, `start`
(ISO datetime with offset), `tz`, and `tables` (nonnegative saved-table count).
Identity builds the relative `events/<id>/` route; arbitrary URLs are not accepted.
Entries are unique and ordered by start descending, then identity descending.
Only complete privacy-finalized packages are indexed. Counts describe retained
tables, not lifetime games, visitors, or donations. The catalog and new archive
are committed together; index-only backfill never publishes pending private copies.


### Optional public activity history (schema 7)

`activity` defaults to `[]` when absent. Each entry has exactly `id` (32 lowercase
hex characters, unique), `at` (UTC ISO instant), `action` (the allowed action name),
`actor` (person ID or null for automatic event actions), `person` (target person ID
or null), and `table` (opaque table ID or null). Person references must resolve;
tables may have been deleted. Allowed actions are attendance (`set_presence`,
`here`, `leaving`), games (`create_table`, `edit_table`, `delete_table`, `end_table`,
`join`, `leave_table`, `unseat`), character (`set_appearance`, `hide`), visitors
(`join_visitors`, `leave_visitors`, `open_visitors`, `close_visitors`,
`remove_visitor`), movement (`move_food`, `move_lounge`, `move_table`), and event
changes (`event_window`, `remove`, `finalize`). Timestamps record when the action
occurred, including before the event starts, independently of its planned time.
Do not embed names, private outcomes, unapproved messages, or raw Discord IDs.
The browser resolves names through the current privacy projection and combines
these entries with retained public events and older movement history.

Optional event metadata: `host_name` (string, at most 100 characters, default empty)
and `host_icon_url` (string, at most 2048 characters, default empty). An icon requires
a nonempty host name and an HTTPS URL without embedded credentials. The browser
loads the icon directly; a failed image leaves the business name visible. The host
ribbon appears on the taller back wall when a host name is configured.
