# Timeline contract — `site/data/timeline.json`

The one file the bot writes and the site reads. Frozen 2026-09-06 against
DESIGN.md. The bot (`bot/`) is the only writer; the site (`site/`) is a read-only
consumer. Any change to this file is a schema bump and needs both lanes.

Amended 2026-09-06 to **schema 2**: two attendee event kinds, `shout` and
`donation` (see `events[]` and §Shouts). Additive for the site: a schema-1
file with no shouts is a valid schema-2 file. The site lane ships schema-2
support before the bot emits it; there is no bot-side flag.

A full fake day that exercises every field is in `timeline.sample.json`
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
  assigns grid positions by array index; deleting a table shifts later tables,
  accepted). `events` is in `at` order. `signups` is in signup order.

## Top level

| field | type | notes |
|---|---|---|
| `schema` | int | `2` (was `1` before the shouts amendment). Bump on any breaking change. Site refuses unknown majors. |
| `phase` | `"live"` \| `"final"` | `final` is the +14-day publish: names trimmed to first name + initial, bot retired. Site shows a "final record" note. |
| `generated_at` | string | ISO 8601 UTC instant the bot wrote the file. Shown as "last updated". |
| `event` | object | window config, below. |
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

## `people[]`

| field | type | notes |
|---|---|---|
| `id` | string | opaque, stable. Referenced by `tables[].dm`, `signups[].person`, `events[].person`. |
| `name` | string \| null | display name captured at first signup and **stored** (renames don't rewrite history). `null` iff `hidden`. In `phase: "final"` it is first name + initial. |
| `dm` | bool | holds the DM role at publish time. Rendered with the distinct DM look. |
| `hidden` | bool | `/hide` was ever used. Honoured forever. `true` ⇒ `name` and `variant` are `null`; site draws the generic unnamed sprite and no nametag, and never shows the id. |
| `variant` | int \| null | unsigned 32-bit FNV-1a hash of the Discord user id string, computed once by the bot. Site maps it to a sprite (`variant % palette_size`), so the art can change without the file changing. `null` iff `hidden`. |
| `presence.planned` | `[int, int]` \| null | event presence `[arrive, leave)`. `null` if the person never set it (e.g. a DM who only created a table — see DESIGN open item: creating a table leans toward auto-setting presence to cover it). |
| `presence.actual.here` | number \| null | slot of `/here`, fractional. |
| `presence.actual.leaving` | number \| null | slot of `/leaving`, fractional. |

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
| `created_at` | string | ISO 8601 with offset. Informational; array order is authoritative for grid position. |
| `signups` | array | seated players, ≤ `seats` entries. The DM is not in this list. |

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
| `kind` | `"break"` \| `"meal"` \| `"announce"` \| `"spotlight"` \| `"shout"` \| `"donation"` | closed set. New kinds are a schema bump because each needs its own scene reaction. `shout` and `donation` were added in schema 2. |
| `at` | number | slot the event entered the timeline, fractional: when the admin issued it, when the person reacted, or when the table DM approved the custom message. |
| `duration` | number \| null | slots, fractional (`0.5` = 15 min). Required for `break` and `meal`; `null` for `announce`, `spotlight`, `shout` and `donation` (the site uses a fixed reaction length). |
| `text` | string \| null | `announce`: the message, ≤ 280 chars, required. `meal`: optional label ("Dinner"). `spotlight`: optional reason line. `shout`: the quick-reaction phrase chosen, ≤ 80 chars, required. `donation`: the DM-approved custom table message, ≤ 80 chars, required, verbatim after controls are stripped and whitespace is collapsed. `break`: `null`. |
| `person` | string \| null | `spotlight`: the person spotlighted. `shout`: the quick reactor. `donation`: the player who submitted the custom message. All `people[].id`, required for those three kinds. `null` otherwise. |
| `by` | string | `people[].id` of the person whose action put this event in the timeline: the admin for the four admin kinds; the table DM for `donation`; the reacting person for `shout` (so `by == person`). Never null. Informational. |

Scene reactions are the site's business and are listed in DESIGN.md; the file
records only what was issued and when.

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

- **Mode:** live if the wall clock is inside `[start, start + window + 1h]`,
  else replay. Live refetches every 60 s and shows a "now" marker.
- **"Last updated"** = `generated_at` rendered in `event.tz`.
- **Table list** (text fallback below the canvas) = `tables[]` with resolved DM
  and roster names; hidden people appear as "someone".
