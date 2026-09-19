# Longtable static hall

This directory is the complete production site. It has no build step and no
runtime service. The Discord bot is the only writer; the browser is a read-only
consumer of `data/timeline.json`.

## Run locally

From the repository root:

```sh
python3 -m http.server 8791 --directory site
```

Open <http://127.0.0.1:8791/> to exercise the production data path. Until the
bot has published `site/data/timeline.json`, that URL intentionally shows a
readable error. Open <http://127.0.0.1:8791/?sample=1> to explicitly use the
checked-in QA sample. Production never falls back to sample data.

## Test

From the repository root:

```sh
node --test site/tests/*.test.mjs
python3 bot/check_timeline.py site/data/timeline.sample.json
(cd bot && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v)
git diff --check
```

The model tests cover schema validation, half-open time rules, location and
event resolution, layout, live reconciliation, speech pacing, and privacy.
The source-security test checks that runtime timeline strings only reach the
DOM through created nodes and `textContent`, never HTML injection sinks.

## Data publication

The data contract is `data/TIMELINE.md`. `bot/longtable/publish.py` atomically
writes the production `data/timeline.json`; do not edit that generated file by
hand. The live page reads the public repository copy directly through the `live-feed`
meta setting in `index.html`, without waiting for Pages deployment. Each request
uses a fresh query key to bypass the raw-file CDN cache. It falls back to
`data/timeline.json` with a visible delay warning when the feed is unavailable.
The site fetches with `cache: "no-store"` and an eight-second timeout, validates schemas 1–7,
and retains its last good snapshot if a live refresh is unavailable or invalid.
Schema 3 adds attendee-selected appearance; older records retain their original
look. Schema 4 adds persisted pads and event room capacity. Deploy this reader
before restarting a bot that publishes schema 7.

Opaque identifiers are used only for in-memory joins. They are not displayed
or used to choose a sprite. Hidden people are rendered and described as
`someone` everywhere.

## GitHub Pages

`.github/workflows/pages.yml` uploads exactly this `site/` directory as the
Pages artifact and deploys it with GitHub's standard Pages actions. In the
repository's Pages settings, select **GitHub Actions** as the source. No build
output, server, repository ID, custom token, or secret is required.

The page is intentionally marked `noindex`; access control is out of scope.

## Great Hall doorway and camera

The September 18 upgrade implements milestones A/B/C/D/E/F/G and leaves the bot's
generated production timeline untouched. Schema 4 uses saved table pads and a
versioned room layout: deleting a table never moves retained tables, and the
entrance, stage, food, lounge, and overflow bounds stay fixed across refreshes.
Legacy schemas 1–3 keep their index-based geometry. Layout and seating helpers in
`model.mjs` reject collisions and exhausted capacity; camera transforms remain in
`camera.mjs`. Past-event discovery and anonymous setup/cleanup staff are implemented;
recorded dice are implemented; audio is a later milestone.
See `data/TIMELINE.md` for geometry, migration, and overflow reservation rules.

On desktop the hall precedes the table list. At 650px and below, the actual DOM
order becomes list, details, then an initially collapsed **Explore the Great
Hall**. Mobile replay starts paused. Selecting a card leaves its full details
available even while the hall is collapsed. Null or throwing canvas contexts do
not prevent loading, selecting, or reading tables.

Wheel/pinch zoom anchors at the pointer; captured pointer dragging pans, with a
five-pixel click-suppression threshold. Arrow keys pan the focused canvas, +/−
zoom, and Home or **Recenter** shows the room. **Fit active tables** frames active
games, the next simultaneous games, or the entrance if none remain. One relevant
game is selected automatically; two or more are framed together. Manual camera
movement or table selection persists through time changes and refreshes (subject
to room bounds). A table's frame includes its overflow seating. Canvas dimensions
follow CSS size and device pixel ratio; labels use CSS pixels and omit overlapping
labels in the overview. Full text remains available in cards and details.

### Table lifecycle and viewer time (Milestone D)

`tableLifecycle()` derives scenery from the table window and selected slot.
Normal 30-minute slots use 15 minutes of preparation, 5 minutes ready before play,
and 10 minutes of cleanup afterward. Durations scale down proportionally for
shorter slots, and clip to the event boundaries. Phases are scheduled, preparing,
ready, playing, packing up, and inactive. Tables/chairs appear during preparation;
props appear when ready and disappear during cleanup. Nothing waits for a prior
animation to finish. The list and selected-table details report the same phase.
These are schedule-derived states, not claims about cancellation or actual staff.

`clock.mjs` separates source (`live`, `sample`, or an `archive` entry point),
publication privacy phase, and viewer modes (`follow-now`, `paused`, `replay`).
During a live event, Pause or scrubbing leaves follow-now; Play replays from the
chosen time and **Return to Now** resumes wall-clock tracking. Live-source data
continues refreshing every 2 seconds while rewound, before doors, and after event
end, until the package becomes final. Refreshes retain the viewer's time and camera.
A final snapshot stops follow-now without resetting the selected time. Samples
never follow the wall clock or poll live data.

Mobile, reduced-motion, and final-record replay start paused; archive-source clocks
also start paused independently of event dates. Reduced-motion users can explicitly
play while figures snap to their destinations. Replay stops at the end; Play there
restarts from zero. A live clock remains at event end rather than jumping to zero.
Before doors, an untouched live-source preview begins following when doors open;
any explicit time choice disables that automatic switch.

Seeking clears transient speech in either direction. Sequential playback still
queues crossed reactions in order, retaining every custom message and at most the
newest 20 pending quick reactions;
rewound live refreshes mark new reactions seen without queueing them. Announcements,
spotlights, breaks, meals, table phases, and intended person locations reconstruct
from the selected time. Ambient walking/wandering and short reaction bubbles remain
presentation effects; identical decorative frames are not promised.

`?at=<slot>` opens paused at a clamped fractional event slot. Time choices update
the URL without navigation; playing checkpoints it at most once per second, and
Return to Now removes the parameter. Exact floating-point slot values are preserved
so a reload at a lifecycle boundary does not cross into another phase. The same
renderer handles fresh loads and seeks, including archive pages.

### Preserved event replay (Milestone E)

The bot creates `events/<event-id>/index.html`, a finalized `timeline.json`, and
`archive.json` metadata only after privacy finalization. The entry page declares
`data-source="archive"` and loads a frozen renderer from
`archive-assets/<sha256>/`. The loader accepts only its sibling `./timeline.json`;
archive pages never poll live data or fall back to a sample, even with `?sample=1`.
Module imports and sprite URLs resolve against the frozen renderer, while the
package URL resolves against the archive page. Both domain-root and project-prefix
Pages paths work. Archive pages begin paused regardless of wall-clock date and
suppress current-event signup links.

These are final-schedule replays: retained tables, presence, signups, and approved
events. Deleted records and overwritten changes cannot be reconstructed. Metadata
carries the schema, pad layout, presentation version, and renderer digest. Frozen
code/assets preserve the chosen renderer; browser-dependent decorative frames are
not promised identical. The Past events link opens the archive index.

The archive publisher commits only its exact event files, frozen assets, and catalog, using
the same dedicated publish checkout as live updates. Keep those generated
directories when promoting a newer website. See the bot README for private pending
storage, deadlines, retries, reset protection, and archive moderation commands.

### Past events and setup scenery (Milestone F)

`past-events.html` reads the bot-managed `data/events.json` (format 1). Each entry
contains the opaque archive identity, event name, start, time zone, and count of
saved tables. Entries link to `events/<id>/` and sort newest first. No people or
fundraising totals are inferred. Before the first publication, a missing manifest
shows an empty state; network failures and invalid manifests offer a retry.
Navigation supports both domain-root and project-prefix hosting. Older frozen
archives remain playable unchanged; newly preserved archives link back to the index.

`tableScenery` derives furniture delivery, chair placement, map unfolding, stacking,
and removal directly from the selected slot. Geometric staff follow authored aisle
routes during preparation/cleanup and never enter participant state, rosters, or
counts. Pause stops them; seek/reload reconstructs the same scene. Reduced motion
omits moving staff and snaps map unfolding while retaining the same furniture stage.
No new recorded events or history claims are introduced.

### Recorded dice (Milestone G)

Schema 5 adds validated public dice outcomes. The latest result at selected time
appears in each table card and its details, including all faces and the modifier.
The canvas draws up to six dice on a deterministic three-second toss, seeded by
event identity and driven entirely by selected time; it always settles on the
saved faces. Pausing, seeking, reloading, and archives do not reroll. Reduced motion
shows settled dice immediately. Text results work when canvas or assets fail.

Private results are never sent to the site; a roll marked private is rejected,
not rendered. A hidden roller is someone. Result text does not assume a game system
or announce critical hits. The existing schema-4 sample remains a compatibility
fixture; `dice.test.mjs`, DOM tests, and bot archive tests cover schema-5 outcomes.
Deploy this reader before the updated bot. Existing archives keep their frozen
renderer and schema. The schema-7 reader must be live before restarting the bot.

### Transitional event actions

Edit `event-config.mjs` for each event, matching both its published name and exact
start string. Unmatched events and explicit sample mode show no configured links.
Only absolute HTTPS destinations without embedded credentials are accepted; labels
are rendered as text. The current Longtable test event has a Discord link only.
Do not automatically attach a fundraiser action to every event.

Both supplied QR images are copied byte-for-byte into `assets/events/`, within the
Pages artifact. Decoding the originals on September 18 verified:

- `discord-k6GYjek53-qr.png`: `https://discord.gg/k6GYjek53`
- `extra-life-team-74917-qr.png`: `https://dd.extra-life.org/teams/74917`

The Extra Life action is documented in the configuration but not enabled for the
current test event. Desktop exposes **Show QR**; mobile keeps the direct links.
Re-decode any replacement image and compare it to the configured destination.
QR image failure leaves the direct link usable. Static props are locally drawn
geometric maps, GM screens, dice trays, and close-view accessories; no additional
art license or bot event is needed.

### Testing deployment and later launch

HTTPS was repaired on September 18 with organizer approval. Public DNS already
pointed to GitHub Pages. Removing and immediately restoring `longtable.party` in
Pages restarted certificate issuance; GitHub approved a certificate covering both
`longtable.party` and `www.longtable.party`. HTTPS was verified before enabling
enforcement. HTTP now redirects to HTTPS, and the secure site serves the deployed
test build. No DNS changes were needed.

The organizer confirmed on September 18 that the Discord server and every current
game are for testing. Keep treating this deployment as testing until the organizer
explicitly announces the launch; test names and pitches do not block deployment.
Continue editing games through the bot, never by hand in `data/timeline.json`.

To publish website changes, use a separate checkout of `NahFhey/longtable-site`,
copy `site/` except bot-managed `data/timeline.json`, `data/events.json`, `events/`,
and `archive-assets/`, run the site tests, and
push the reviewed changes to that repository’s `main` branch. Its Pages workflow
uploads exactly `site/`. Preserve the destination timeline and do not use the bot’s
dedicated publishing checkout for manual promotion. Website deployment does not
require restarting the testing bot.

Verification: all site test files pass, the sample passes `check_timeline.py`, and
all 268 bot tests pass using `bot/.venv/bin/python` (system Python lacks discord.py).
Desktop and 390px mobile browser checks covered sparse framing, table details,
mobile disclosure, labels, and the twelve-table sample without console errors.
Touch pinch/drag, failed assets, unavailable canvas, and camera bounds are also
covered by automated tests; physical touch-device testing remains a release check.

Milestone F verification: all nine site test files pass. Tests cover catalog
validation, failed-push leftovers, multiple archives, backfill, retry/idempotence,
anonymous staff, compressed windows, reduced motion, and matching scenery after
seek/reload. A local synthetic finalized archive was opened from the index in a
browser; setup and cleanup rendered with unchanged rosters and no console errors.
Deploy the updated site before restarting the bot, then run `--archives-index` to
create or backfill the catalog. With no finalized archives, the index is empty.

Milestone G verification: 268 bot tests and ten site test files pass, including
private-result exclusion, public archive moderation, schema migration, command
visibility defaults, failed saves, deterministic frames, and accessible results
without canvas. A synthetic finalized archive was checked in a browser for hidden
identity, settled faces, total, and seek/reload behavior. No live event was changed.

## Visitors (schema 6)

A Visitors Table card precedes game tables. Its roster comes from `visitors.people`,
using the same hidden-name policy as game rosters. It is a coordinator-owned group,
not a physical pad or a seat reservation. Ordinary game assignments take priority;
unseated visitors alternate between hall aisles, the lounge and food area on a
four-minute event-time rhythm. The route is deterministic on seek and refresh.
Social poses are decorative, carry no invented dialogue, and honor reduced motion.
Archives freeze this visitor roster and renderer like the rest of the snapshot.
Deploy the schema-7 reader before the writer; schemas 1–6 still render.

### Hall caretaker

A caretaker turns on the lights and sets out food during the opening minute,
then circulates between the entrance, food area and lounge. When the last
attendee leaves, the caretaker walks to the switch and dims the room; a later
arrival turns the lights back on. Staff stay on duty in an empty hall and never
count as attendees. Occupancy uses effective attendance, including recorded
arrival/departure overrides. The room remains faintly visible when dark, and
controls and table information stay readable.

This scenery follows event time, so seeking and reloading reproduce it. Reduced
motion uses stationary staff and immediate lighting changes. The canvas description
also reports the caretaker's current activity. Frozen archives keep their own
renderer; this change does not rewrite older archives or add attendance records.

### Custom messages on stage

Approved custom table messages (`donation` in the data contract) bring their
speaker to the stage microphone through the side stairs. Pending speakers form
an ordered queue below the stairs, with one figure per person even if they have
several messages. The gold bubble lasts six seconds after arrival; the speaker
then walks down the stairs before the next message starts and returns to their
current scheduled location. Quick reactions keep their four-second bubbles.
Stage visits are temporary presentation effects and do not change attendance.
Hidden speakers retain their anonymous figure and name. Reduced motion snaps
figures to each destination while preserving message order and reading time.
Seeking or returning to now clears the stage visit and waiting queue. Automatic
framing includes the stage during messages; manual camera framing remains in use.

## Player and visitor movement (schema 7)

Discord player options and visitor room buttons publish per-person movement
histories. The hall replays food, lounge, and table choices at their recorded
times, with normal walking animation. Explicit choices override automatic
spotlight/meal movement while the attendee is present and the matching
game or visitor context applies. Game assignments supersede older visitor choices.
A successful dice-form submission records a return to the game table, including
when the outcome is private. The private outcome itself is never published.
Dice support 1–100 dice with 2–1000 sides, including custom sizes.


### Live updates and activity log

The bot publishes public changes to the live-data service after a 250 ms debounce
(one second maximum), independently of Git pushes. The browser checks that service
every two seconds. Reads come from the primary database with caching disabled.
If the service fails, the browser chooses the newest available GitHub/Pages backup
and visibly reports the delay; those backups can be several minutes behind.
The visible update status separately reports the last successful check and when
the data was published, plus fallback/failure and whether the viewer is rewound. **Check for updates**
requests an immediate refresh without changing the selected time. Final records,
samples, and archives never automatically poll the live feed.

The timestamped activity log lists newest public actions first, in the event's
timezone. Rewinding limits the log to the selected moment. The first 100 entries
are shown; **Show older actions** reveals more. Movement and approved/public event
history are available from existing records. Attendance, seat changes, table edits,
visitor controls, appearance changes, and event-window changes are recorded from
this release onward. Private dice results and pending/rejected messages are excluded.
Actor names come from current public people records, so hiding someone anonymizes
their earlier entries too. Deleted games appear as “removed game”; raw Discord
identifiers, copied names, and arbitrary result messages are never stored in activity.

## Meals, lounge activities, and scheduled breaks

Food visits are derived from event time: 20 seconds at each of the two serving
tables, 30 seconds to reach a food-area chair, five minutes eating, then 30 seconds
to take the plate to the labelled trash bin. The plate empties while eating and
disappears at the bin. Afterward, the attendee resumes their last lounge/table
choice, or their current scheduled activity. A new movement, departure, or game
assignment supersedes the visit. Automatic visitor meals continue across their
four-minute wandering beats; an event meal starts one visit per attendee rather
than keeping them at the buffet for the whole event meal window.

A lone lounge attendee reads, two chat, and three to six play cards. Larger crowds
split into groups of up to four alternating cards and conversation. Speakers and
food diners are excluded from the lounge population. Activity labels, props, and
hover descriptions reflect these activities; the canvas description includes
population counts. Food stages and lounge groups reconstruct from the selected
time and roster on refresh or rewind. Reduced motion shows the same activities
without walking or eating animation.

Scheduled breaks appear in the existing timeline break events. During a break,
an anonymous staff member announces the return time from the stage, and the
announcement also appears in the accessible current-event text. Present attendees
move to the lounge, including those with explicit food/table choices; stage
speakers and spotlights retain their temporary priority. At the end, attendees
resume their current location rules. Breaks do not extend game end times.

Attendee walking uses the same event-time delta as staff, so replay speed changes
apply to both and pausing freezes ordinary travel. Stage speech remains readable
for its full display time; its temporary visit may finish while replay is paused.

## Hall music

Expanding the Great Hall plays RandomMind’s CC0 recordings “The Old Tower Inn”
and “The Bard’s Tale” in rotation. Collapsing the hall pauses the current track;
reopening resumes it. Music stays at normal speed during replay, including when
the event clock is paused. The controls offer mute, next track, and volume.
Volume starts at 50%; volume and mute preferences are saved in this browser’s
local storage (`longtable.music.v1`), shared by live pages and event archives.
If storage is unavailable, preferences last for the page session. If the browser
blocks autoplay, **Play music** enables audio with a click. No track is fetched
until playback is needed. Sources and licenses are in `assets/music/CREDITS.txt`.
New archived renderers include the module, credits, and both MP3s; older archives
retain their original renderer.
