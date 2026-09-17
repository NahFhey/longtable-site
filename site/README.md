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
hand. The site fetches it with `cache: "no-store"`, validates schema 1 or 2,
and retains its last good snapshot if a live refresh is unavailable or invalid.

Opaque identifiers are used only for in-memory joins. They are not displayed
or used to choose a sprite. Hidden people are rendered and described as
`someone` everywhere.

## GitHub Pages

`.github/workflows/pages.yml` uploads exactly this `site/` directory as the
Pages artifact and deploys it with GitHub's standard Pages actions. In the
repository's Pages settings, select **GitHub Actions** as the source. No build
output, server, repository ID, custom token, or secret is required.

The page is intentionally marked `noindex`; access control is out of scope.
