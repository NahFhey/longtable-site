# Timeline contract — `site/data/timeline.json`

The one file the bot writes and the site reads. Frozen 2026-09-06 against
DESIGN.md. The bot (`bot/`) is the only writer; the site (`site/`) is a read-only
consumer. Any change to this file is a schema bump and needs both lanes.

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

A legacy schema-4 fake day is in `timeline.sample.json`
(generated, deterministic; 8 DMs, 12 tables, 35 players, the organiser, 14 events).

## Conventions

- **Encoding.** UTF-8 JSON, one top-level object. Field names are `snake_case`.
  Unknown fields are ignored by the site (forward compatibility); the bot never
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
  uses saved pads for schemas 4–5; legacy schemas use array indices). `events` is in `at` order. `signups` is in signup order.

## Top level

| field | type | notes |
|---|---|---|
| `schema` | int | `5` (schema 2 added shouts; schema 3 appearance; schema 4 room layout and pads; schema 5 recorded dice). Site refuses unknown majors. |
| `phase` | `"live"` \| `"final"` | `final` is the +14-day publish: names trimmed to first name + initial, bot retired. Site shows a "final record" note. |
| `generated_at` | string | ISO 8601 UTC instant the bot wrote the file. Shown as "last updated". |
| `event` | object | window config, below. |
| `room_layout` | object | Required in schemas 4–5. Version and capacities fixed for this event, below. |
| `people` | array | everyone who has ever signed up, created a table, or set presence. |
| `tables` | array | current tables. Deleted tables are gone, not tombstoned. |
| `events` | array | admin `/event` history plus attendee shouts and approved donations. |

## `event`

| field | type | notes |
|---|---|---|
| `name` | string | `"Longtable"`. Page title. |
| `start` | string | ISO 8601 with numeric offset, e.g. `"2026-11-07T10:00:00-05:00"`. Slot 0. |
| `tz` | string | IANA zone, e.g. `"America/New_York"`. Display only. The sample's value is a placeholder; the bot writes its configured zone. |
| `slot_minutes` | int | `30` for the real event. Dry run may shrink it. |
| `slots` | int | `48` for the real event. Window length = `slots * slot_minutes`. |

## `room_layout` (schema 4)

| field | type | notes |
|---|---|---|
| `version` | int | `1`. Unknown versions are rejected. Geometry rules below are immutable for this version. |
| `pad_capacity` | int | Positive safe integer. Default 20. All existing table records reserve one pad, including ended tables. |
| `overflow_capacity` | int | Nonnegative safe integer. Default 120 player seats beyond local seating. |

Version 1 uses world-tile coordinates: ten columns, 6×6 cells, grid origin `(4,8)`.
Pad `p` has cell origin `(4 + 6*(p%10), 8 + 6*floor(p/10))`. Table rows are
`max(2, ceil(pad_capacity/10))`, with grid bottom `B = 8 + 6*rows`. The room is
72 tiles wide. Overflow rows are `R = ceil(overflow_capacity/30)`; room height
is `H = B + (R ? 2 + 2*R : 0) + 6`. No dimensions depend on table count or signups.

Fixed landmark rectangles `(x,y,width,height)` are stage `(65,1,6,H-2)`, food
`(1,1,16,6)`, and lounge `(1,H-6,63,5)`; the entrance is `(0,9)`. Overflow seat
`i` is `(4.5 + 2*(i%30), B + 2.5 + 2*floor(i/30))`. Occupied overflow chairs
are assigned by ascending pad then signup order. Their area is fixed; individual
attendees' overflow chairs can change when rosters change. Ten local positions
include the DM, so each table reserves `max(0, seats-9)` overflow seats. The sum
must not exceed `overflow_capacity`, even for non-overlapping table windows.
This ensures every advertised seat can be filled without growing the room.

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

## `people[]`

| field | type | notes |
|---|---|---|
| `id` | string | opaque, stable. Referenced by `tables[].dm`, `signups[].person`, `events[].person`. |
| `name` | string \| null | display name captured at first signup and **stored** (renames don't rewrite history). `null` iff `hidden`. In `phase: "final"` it is first name + initial. |
| `dm` | bool | holds the DM role at publish time. Rendered with the distinct DM look. |
| `hidden` | bool | `/hide` was ever used. Honoured forever. `true` ⇒ `name`, `variant`, and `appearance` are `null`; site draws the generic unnamed sprite and no nametag, and never shows the id. |
| `variant` | int \| null | unsigned 32-bit FNV-1a hash of the Discord user id string, computed once by the bot. Site maps it to a sprite (`variant % palette_size`), so the art can change without the file changing. `null` iff `hidden`. |
| `appearance` | object \| null | Required in schemas 3–5. `null` uses the existing variant-based appearance. Otherwise exactly four integer indices: `skin` 0–3, `shirt` 0–14, `hair` 0–15, `hat` 0–3, mapped by `site/characters.mjs`. The hat is rendered only when `dm` is true. Always `null` when hidden. |
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
| `created_at` | string | ISO 8601 with offset. Informational; `pad` is authoritative for grid position in schemas 4–5. |
| `signups` | array | seated players, ≤ `seats` entries. The DM is not in this list. |
| `pad` | int | Required in schemas 4–5. Unique zero-based location, `0 <= pad < room_layout.pad_capacity`. Independent of ID, array order, and table window. |

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
and are never stored, assigned event IDs, exported, or archived; no occurrence
marker is published. A public payload with private visibility is invalid.

Expressions normalize to `NdS`, optionally followed by a nonzero signed modifier.
N is 1–20; S is one of 4, 6, 8, 10, 12, 20, 100. Modifier is an integer from −1000
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
  the reviewed custom message receiving the gold bubble. Both are speech from the
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

## What the site does with it

- **Viewer time:** live-source initial viewing follows now inside
  `[start, start + window + 1h]` when `phase` is live. A user's pause, seek, or
  replay choice persists until Return to Now; refreshing never overrides it.
  Follow-now clamps at event end and does not automatically rewind. Live-source
  packages refetch every 60 s while `phase` is live, even when paused or replaying.
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

New timelines use schema 5; older frozen packages retain their original schema. A separate archive envelope (`archive.json`, format
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
