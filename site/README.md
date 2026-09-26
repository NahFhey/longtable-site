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

The new full-day demonstration is `/?sample=50&at=0`: press Play to watch 50
fictional attendees arrive and depart over 24 event hours, with 12 games, visitors,
food, breaks, dice and stage messages; all 50 are in the hall and all 12 games
are playing at once for one fifth of the day (slots 19 to 29), after which the
tables fade in a random order. The default speed is 600×, with slower
playback for announcements and meals. Regenerate its separate schema-7 dataset
with `python3 site/data/gen_demo.py`; it leaves the legacy sample and live data
untouched. Demo pages never poll the live feed or show live donation links.

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

The public site repository, `NahFhey/longtable-site`, carries
`.github/workflows/pages.yml`, which uploads exactly this `site/` directory as
the Pages artifact and deploys it with GitHub's standard Pages actions; its
Pages settings select **GitHub Actions** as the source. No build output, server,
repository ID, custom token, or secret is required. The private project
repository has no Pages workflow (it cannot serve Pages and the workflow failed
on every push); promote changes as described under "Testing deployment and
later launch" below.

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

On desktop the hall precedes the table list. Table details and a compact,
scrollable event activity log share the sidebar beside the hall (stacked below
it at 800px and below). At 650px and below, the actual DOM order becomes list,
sidebar, then an initially collapsed **The Great Hall**.

The collapsible attendee list shows every published person once; DM takes
precedence over Player and Visitor when roles overlap. Hidden attendees remain
`someone` without a role label. This list represents event registration, not
current presence in the hall.

Mobile replay starts paused. Selecting a card leaves its full details
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
animation to finish. The list and selected-table details report the same phase
as a bare status line; before doors (the upcoming clock) every table reads
"Scheduled" rather than the slot-0 phase.
These are schedule-derived states, not claims about cancellation or actual staff.

`clock.mjs` separates source (`live`, `sample`, or an `archive` entry point),
publication privacy phase, and viewer modes (`follow-now`, `paused`, `replay`).
During a live event, Pause or scrubbing leaves follow-now; Play replays from the
chosen time and **Return to Now** resumes wall-clock tracking. Live-source data
continues refreshing while rewound, before doors, and after event end, until the
package becomes final: every 30 seconds during the sign-up window and every 2
seconds from one hour before doors. Refreshes retain the viewer's time and camera.
A final snapshot stops follow-now without resetting the selected time. Samples
never follow the wall clock or poll live data.

Mobile, reduced-motion, and final-record replay start paused; archive-source clocks
also start paused independently of event dates. Reduced-motion users can explicitly
play while figures snap to their destinations. Replay stops at the end; Play there
restarts from zero. A live clock remains at event end rather than jumping to zero.
Before doors, an untouched live-source preview begins following when doors open;
any explicit time choice disables that automatic switch.

### Before the event: the gathering and the eve

The site derives a viewer stage from the wall clock against `event.start`; the
bot publishes nothing new for it. A live-source package in `phase: "live"` has
four stages: **gathering** (until 24 hours before doors), **eve** (the last 24
hours), **day** (the existing follow-now window) and **after** (the existing
replay). Before doors, every device, including mobile and reduced motion, opens
in the `upcoming` clock mode: slot 0, watching the hall as it is now. Nothing
auto-plays.

During the gathering the hall is lit with no day-night cycle and the caretaker
walks the seeded tour at real-time pace (about half a minute per stop; reduced
motion keeps the caretaker at the first stop). Anyone with a table sign-up sits
at their earliest table (lowest `start`, then lowest table index; the DM at
seat 0, signups at their index + 1); anyone with only a planned attendance
window stands in the lounge; everyone else is outside. Actual attendance,
movements, breaks, meals, spotlights, dice and speech are ignored, and hidden
people are the usual anonymous sprites. A visitor opening the page sees
everyone already in place; walk-ins, moves and walk-outs animate only for
changes an open tab observes through polling, at walking pace.

Before doors the live feed alone may carry an optional top-level `practice`
key, `{ "people": { "<id>": { "position", "table" } }, "speech": [{ "person",
"text", "at" }] }`, for people trying the in-thread controls; the Git fallback,
archives and the sample never have it, and archive and sample pages ignore it.
A practising person stands at their practice position instead of their planned
placement: for `table`, their seat at the named table (the DM at seat 0, a
signup at its index + 1), else their planned table, else the lounge; `food` is
the food seating, eating; `lounge` is the lounge. They stay in the hall during
the eve for as long as they keep practising. Each speech entry (a quick
reaction or a public roll) is shown once as a bubble at the person, the first
time a poll carries it; a page load only records what is already there, so a
reload never replays old bubbles. While anyone is practising the page polls
every 5 seconds instead of 30.

At the start of the eve an open tab sees everyone leave over about a minute
(departures spread over 45 seconds), then the caretaker switches the lights off
at 60 seconds and walks out. After that the hall is dark and empty until doors
open, the caption reads "The hall is dark. Doors open Saturday at 10:00 AM.",
and sign-ups during the eve still count in the table cards without anyone
walking in. Doors open is a hard cut into the event-day rules.

The header shows the full event date (`Saturday, November 7, 10:00 AM`) and a
countdown ("40 days away", "3 hours away", "12 minutes away", "Doors open any
moment") under an `UPCOMING` badge; slot labels show the day whenever the event
is 24 hours or longer. The status line reads "14 gathered so far · 3 games with
signup space · Sign up on Discord" (a link outside sample and archive views),
or "Nobody has arrived yet · …" when empty, and the activity log shows
everything newest first under "Newest first · America/New_York". Play or
scrubbing runs the existing replay of the planned day on demand (`REPLAY` /
`PAUSED`, "Previewing the planned day."), and Return to Now restores the
gathering; the two placements never walk into each other. The "Now" marker is
hidden before doors because now lies outside the scrubber's range.

Polling runs every 30 seconds while the tab is visible, not at all while it is
hidden (a refresh fires on return), and every 2 seconds from one hour before
doors. `?now=<ISO-8601 or epoch ms>` overrides the wall clock for review and
tests; time keeps flowing from the override, and on the sample package it also
turns on the live-source behaviour so the stages can be seen on demand:

- `/?sample=1&now=2026-09-25T12:00:00-04:00` — the gathering
- `/?sample=1&now=2026-11-06T09:59:50-05:00` — watch the exodus begin ten seconds later (the eve starts at 10:00 AM the day before doors)
- `/?sample=1&now=2026-11-06T10:30:00-05:00` — the eve, dark and empty
- `/?sample=1&now=2026-11-07T09:59:30-05:00` — watch the doors-open handover

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
and removal directly from the selected slot. Staff use randomly selected character layers, seeded by event start and station
so their appearance stays stable across refreshes and replays. They retain their
STAFF labels and never appear in attendee lists. Staff follow authored aisle
routes during preparation/cleanup and never enter participant state, rosters, or
counts. Pause stops them; seek/reload reconstructs the same scene. Reduced motion
omits moving staff and snaps map unfolding while retaining the same furniture stage.
No new recorded events or history claims are introduced.

### Recorded dice (Milestone G)

Schema 5 adds validated public dice outcomes. The latest result at selected time
appears in each table card and its details, including all faces and the modifier;
the notice is absent until a roll exists.
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

The header always carries two links, **Discord** and **Donate**. The QR codes
are not in the header; the wall plaques carry them. Update `DISCORD_INVITE` and `DONATE_URL` in `event-config.mjs`
to change their destinations; they are shared across current events without
depending on their names or dates. Samples and archived replays suppress the
header links. Table cards and details do not repeat signup instructions.

Optional event actions in `EVENT_CONFIG` still match the event name and exact
start string. Only absolute HTTPS URLs without credentials are accepted. Labels
are rendered as text. Extra links that repeat the Discord or Donate URL are
dropped. Any supplied QR image must be verified against its configured
destination; an image failure leaves the direct link usable.

**Wall plaques.** `WALL_PLAQUES` in `event-config.mjs` lists the two plaques
drawn on the back wall of the hall: the Discord
invite and the Extra Life page, each with its label, URL and QR file under
`assets/events/`. The QR files must be decode-verified against their URL before
they are listed; `event-assets/README.md` has the command and the provenance of
each file. `discord-k6GYjek53-qr.png` is a stale invite retained only for old
printed materials; it is never displayed.

Static props are locally drawn
geometric maps, GM screens, dice trays, and close-view accessories; no additional
art license or bot event is needed.

## Kiosk mode (projector)

Open `https://longtable.party/?kiosk=1` in Chrome or Firefox on the projector
laptop and press `f` (or F11) for fullscreen. The page strips itself to a slim
bar (event name, Extra Life total, badge and clock), the doors countdown line,
and the hall scene filling the rest of the screen, with the two wall plaques and
their QR codes drawn at projector size. It needs no other setup: the same timeline,
polling and consent rules as the public page apply, and nothing new about any
attendee appears. Keep the tab in the foreground (polling and the Extra Life
total pause while the tab is hidden), plug the laptop in, and disable OS sleep;
the page also asks for a screen wake lock where the browser allows one. After
45 seconds without input a moved camera returns to the kiosk's automatic frame,
which is always the whole room from the back wall to the lounge (never the live
page's close-up of the relevant tables), and the cursor hides after 3 seconds.

`?sample=50&kiosk=1` is the dress rehearsal (the demo event in kiosk chrome);
`?kiosk=1&now=<ISO>` previews the gathering scene before doors. `?kiosk=1`
combines with `?at=` and is kept when the clock rewrites the URL.

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

Before the doors open (until a minute before the first arrival) the hall is dark
and nobody is drawn. The caretaker enters through the door, switches on the lights
in the first eight seconds, and starts rounds at the switch. No food is set out at
opening. The seeded tour visits corridors, table aisles, the food front, lounge,
stage stairs and door, with a short dwell at each stop.

A meal, eligible explicit food choice, or visitor food beat starts kitchen service
when none is running. The caretaker finishes the current straight tour segment
(or leaves a dwell immediately), walks to the kitchen at two tiles per event
second, and sets out six dishes at their natural speed of 3.4 tiles per second.
The schedule takes `SET_OUT_SECONDS` (currently 31.094117647 s). While food is out,
the caretaker cooks at seeded kitchen stations, dwelling 4–9 seconds and walking
at 1.2 tiles per second along the open floor bands. After the last visit ends and
five minutes pass without a new diner, the caretaker finishes any current kitchen
segment, returns to the pickup, and clears dishes one at a time, last placed first.
Demand during that return still cancels quiet cleanup; demand during cleanup waits
for another service starting at cleanup end, without a walk into the hall.

After service, the caretaker retraces the route to the exact tour departure point.
The tour clock counts only rounds, including the completion of an interrupted
straight segment; it pauses throughout service. If the hall empties, cleanup is
requested immediately. After cleanup and any pending service, the caretaker walks
to the switch, fades the lights over four seconds, and exits through the door.
A returning attendee brings the caretaker back from their actual closing position
or the door. After reaching the switch and relighting, rounds restart at tour clock
zero. Staff never count as attendees; occupancy uses effective attendance overrides.

Everything follows event time, so pause, seek and reload reproduce the scene.
Reduced motion pins staff at the pickup during service and the switch otherwise;
all six dishes appear at readiness and disappear at cleanup start, using the same
times as normal motion. Lights change immediately. The canvas description reports
staff activity. Frozen archives retain their own renderer.

### Custom messages on stage

Approved custom table messages (`donation` in the data contract) bring their
speaker to the stage microphone through the side stairs. Pending speakers form
an ordered queue below the stairs, with one figure per person even if they have
several messages. The gold bubble lasts six seconds after arrival at 1× and
while paused; the speaker then walks down the stairs before the next message
starts and returns to their current scheduled location. Quick reactions keep
their four-second bubbles at 1×. Faster replay divides both display times by the
effective playback speed (including the announcement and break caps), never
below one real second, so a backlog drains at about one message per second at
600× or 1800×. A speed change does not retime the message already on stage.
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
every 30 seconds during the sign-up window and every two seconds from one hour
before doors, and not at all while the tab is hidden. Reads come from the
primary database with caching disabled.
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

The 23 × 6 food corner has a flagstone kitchen with ovens, a stove, sink, prep
counter and stores. Staff carry six dishes from the kitchen to a deep wood serving
table. An orange rug holds four dining tables and two wall bars, with 20 stools
facing sideways across the tables and plates on each diner's own half. Extra
diners hold their plates in two lines down the column aisle, then along the rug's
bottom edge, clear of the hall aisle. The bin is an open barrel with no label.

Food visits are derived from event time. Before service is ready, diners wait at
the first queue with the label “the food queue, waiting for food” and no plate.
The remaining phases start at the later of the visit start and service readiness:
20 seconds at each of the two serving
points, 30 seconds to reach a food-area stool, five minutes eating, then 30 seconds
to take the plate to the bin. Diners queue along the serving table's front and
east side, reach stools along the row aisle and side lanes, and leave via the bin.
The plate empties while eating and
disappears at the bin. Afterward, the attendee resumes their last lounge/table
choice, or their current scheduled activity. A new movement, departure, or game
assignment supersedes the visit. Automatic visitor meals continue across their
four-minute wandering beats; an event meal starts one visit per attendee rather
than keeping them at the buffet for the whole event meal window. A visit ends
400 seconds after that effective start; the last such end starts the five-minute
quiet window. Serving dishes pop only when their count rises during playback,
shrink over 0.2 seconds during clearing, and appear full-size on load or seek.

A lone lounge attendee reads, two chat, and three to six play cards. Larger crowds
split into groups of up to four alternating cards and conversation. Speakers and
food diners are excluded from the lounge population. Activity labels, props, and
hover descriptions reflect these activities; the canvas description includes
population counts. Food stages and lounge groups reconstruct from the selected
time and roster on refresh or rewind. Reduced motion shows the same activities
without walking or eating animation. Reduced motion also disables breathing,
look-around, dish pops and bin squash, and keeps steam and light flicker static.

Scheduled breaks appear in the existing timeline break events. During a break,
an anonymous staff member announces the return time from the stage, and the
announcement also appears in the accessible current-event text. Present attendees
move to the lounge, including those with explicit food/table choices; stage
speakers and spotlights retain their temporary priority. At the end, attendees
resume their current location rules. Breaks do not extend game end times.

Attendee walking uses the same event-time delta as staff, so replay speed changes
apply to both and pausing freezes ordinary travel. The waddle cycle and idle
breathing and look-around use real time, independent of replay speed. A changed
destination during a corner walk retains the next forward waypoint before
rerouting, so the person does not cut back through furniture. Stage speech remains readable
for its display time, which scales with replay speed down to a one-second floor and
is unchanged at 1× and while paused; its temporary visit may finish while replay is paused.

## Hall music

A jukebox stands on the floor against the back wall of the Great Hall, two tiles
right of the host banner’s end (the food area fills the wall’s left end), under a
wooden sign that reads “Click here for music”. Music never starts until a visitor
clicks the jukebox or its sign once in that browser: the first click turns the
music on, remembers that choice, and opens a small player beside the jukebox with
the track line, **Pause music** / **Play music**, **Next track**, a volume slider
and a close button. Hovering the jukebox shows a tooltip and a pointer cursor; the
player closes with its × button, Escape, another jukebox click, or collapsing the
hall, and never widens the automatic camera frame. Once enabled, expanding the
Great Hall plays RandomMind’s CC0 recordings “The Old Tower Inn”, “The Bard’s
Tale”, “Market Day”, “Minstrel Dance” and “Rejoicing” in that order, wrapping
around, and the sign names the playing track; collapsing the hall pauses
the current track and reopening resumes it. Music stays at normal speed during
replay, including when the event clock is paused. **Pause music** turns the music
off until the next click on the jukebox or **Play music**. Dragging the volume to
0 mutes; above 0 unmutes. Volume starts at 50%; volume, mute, the last track and
the on/off choice are saved in this browser’s local storage (`longtable.music.v1`,
`{ volume, muted, track, enabled }`, older `{ volume, muted }` entries still load),
shared by live pages and event archives; whether the player is open is not saved.
If storage is unavailable, preferences last for the page session. If the browser
blocks autoplay, the sign keeps inviting a click and **Play music** enables audio.
No track is fetched until playback is needed. The jukebox, its tooltip and the
player work the same in kiosk mode, so the projector’s music can be started and
paused at the jukebox. Sources and licenses are in `assets/music/CREDITS.txt`.
New archived renderers include the module, credits, and all five MP3s; archives
frozen with the two-track or older renderers keep their original files.

The current header links to Discord and Extra Life team 74917. Its public team
amount/goal refreshes quietly every minute while the tab is visible. Extra Life
can cache its API response; the display is not a guarantee of instant donation
updates. Failed refreshes retain and label the last available amount. Samples and
archived replays do not fetch or show live fundraising totals.
