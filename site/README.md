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
hand. The site fetches it with `cache: "no-store"`, validates schemas 1, 2, and 3,
and retains its last good snapshot if a live refresh is unavailable or invalid.
Schema 3 adds attendee-selected appearance; older records retain their original
look. Deploy this reader before restarting a bot that publishes schema 3.

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

The September 18 upgrade starts with milestones A/B. It reuses the current
schema 1/2/3 reader and leaves the bot's generated timeline untouched. Stable
pads, fixed room geometry, lifecycle animation, archives, dice, and audio remain
later milestones. Camera coordinates and bounds are pure helpers in
`camera.mjs`; the room still uses the existing index-based layout.

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

On September 18, GitHub Pages reported `cname: longtable.party`, HTTPS enforcement
false, and no issued certificate in its API response. A verified HTTPS request
failed with a hostname mismatch. The health endpoint returned no diagnosis.
DNS/certificate remediation remains an operational release task; adding a CNAME
file alone is not an established fix. No Pages configuration or DNS was changed.

The organizer confirmed on September 18 that the Discord server and every current
game are for testing. Keep treating this deployment as testing until the organizer
explicitly announces the launch; test names and pitches do not block deployment.
Continue editing games through the bot, never by hand in `data/timeline.json`.

To publish website changes, use a separate checkout of `NahFhey/longtable-site`,
copy `site/` except its bot-managed `data/timeline.json`, run the site tests, and
push the reviewed changes to that repository’s `main` branch. Its Pages workflow
uploads exactly `site/`. Preserve the destination timeline and do not use the bot’s
dedicated publishing checkout for manual promotion. Website deployment does not
require restarting the testing bot.

Verification: all site test files pass, the sample passes `check_timeline.py`, and
all 231 bot tests pass using `bot/.venv/bin/python` (system Python lacks discord.py).
Desktop and 390px mobile browser checks covered sparse framing, table details,
mobile disclosure, labels, and the twelve-table sample without console errors.
Touch pinch/drag, failed assets, unavailable canvas, and camera bounds are also
covered by automated tests; physical touch-device testing remains a release check.
