#!/usr/bin/env python3
"""Generate site/data/timeline.sample.json — a full fake Longtable day.
Deterministic (seeded). Mirrors the contract in site/data/TIMELINE.md."""
import json, random
random.seed(20261107)

def fnv1a(s):
    h = 0x811c9dc5
    for b in s.encode():
        h ^= b; h = (h * 0x01000193) & 0xffffffff
    return h

people = {}
def person(id, name, dm=False, hidden=False, planned=None, here=None, leaving=None):
    people[id] = {
        "id": id, "name": None if hidden else name, "dm": dm, "hidden": hidden,
        "variant": None if hidden else fnv1a(id),
        "presence": {"planned": planned, "actual": {"here": here, "leaving": leaving}},
    }

# --- DMs (8). Presence covers their tables plus some hanging about.
person("u_mara",  "Mara Okonkwo",  dm=True, planned=[0, 22], here=0.4)
person("u_theo",  "Theo Lindqvist", dm=True, planned=[1, 32], here=1.1, leaving=31.6)
person("u_priya", "Priya Raman",   dm=True, planned=[3, 31])
person("u_jonah", "Jonah Beck",    dm=True, planned=[8, 18], here=8.3)   # comes back for Dawn Patrol via actual? no: second presence not modelled; he stays late
people["u_jonah"]["presence"]["planned"] = [8, 48]
person("u_wen",   "Wen Zhao",      dm=True, planned=[12, 24], here=12.9, leaving=23.2)
person("u_sol",   "Sol Ferreira",  dm=True, planned=[16, 26])
person("u_ilse",  "Ilse Vandermeer", dm=True, planned=[28, 38], here=28.6)
person("u_rafa",  "Rafa Domínguez", dm=True, planned=[40, 48], here=40.2)

# --- Players (35). Presence archetypes in slots (0 = 10:00, 48 = 10:00 next day).
names = [
 "Ada Whitlock","Bram Castellano","Cleo Marsh","Dev Anand","Esme Larkin","Finn O'Dwyer",
 "Greta Holm","Hugo Batista","Ines Ferrer","Jules Moreau","Kit Yamamoto","Lena Sørensen",
 "Milo Petrov","Nadia Haddad","Oisín Byrne","Pip Talbot","Quinn Delacroix","Rosa Ibáñez",
 "Sam Kowalski","Tess Nakamura","Umar Siddiqui","Vera Lindgren","Wyatt Boone","Xiu Lan",
 "Yara Mansour","Zeke Halloran","Abel Nkemelu","Bea Fontaine","Cass Reyes","Dara Quigley",
 "Eli Strand","Freya Voss","Gus Mercer","Hana Kobayashi","Ivo Tremblay",
]
archetypes = [  # (arrive, leave) planned
    (0,10),(0,12),(1,14),(1,20),(2,24),(2,10),(2,16),(3,22),(4,12),(4,26),
    (0,48),(0,48),(1,48),(2,48),(6,30),(8,20),(10,24),(12,26),(12,32),(14,30),
    (16,24),(16,36),(18,34),(20,48),(22,40),(24,44),(26,36),(28,48),(30,48),(34,48),
    (36,48),(38,48),(40,48),(42,48),(4,8),
]
for i, (n, (a, l)) in enumerate(zip(names, archetypes)):
    uid = "u_" + n.split()[0].lower().replace("ó","o").replace("í","i")
    person(uid, n, planned=[a, l])
# a couple of hidden people
people["u_kit"]["hidden"] = True;  people["u_kit"]["name"] = None;  people["u_kit"]["variant"] = None
people["u_cass"]["hidden"] = True; people["u_cass"]["name"] = None; people["u_cass"]["variant"] = None
# actual overrides (/here and /leaving), fractional slots = real times
actuals = {
 "u_ada": (0.8, None), "u_bram": (1.3, 11.4), "u_cleo": (None, 13.5), "u_dev": (2.2, None),
 "u_esme": (2.9, 22.7), "u_finn": (1.6, None), "u_greta": (3.4, None), "u_hugo": (4.7, 12.1),
 "u_ines": (5.1, 11.9), "u_ada": (0.8, 9.6), "u_lena": (1.2, None), "u_milo": (3.1, None),
 "u_nadia": (6.4, 29.2), "u_oisin": (8.2, 19.5), "u_pip": (10.5, None), "u_quinn": (12.4, 25.8),
 "u_rosa": (12.2, None), "u_sam": (14.6, 29.1), "u_tess": (16.3, None), "u_umar": (16.9, 35.2),
 "u_vera": (18.4, None), "u_wyatt": (20.7, None), "u_xiu": (22.5, 39.4), "u_yara": (24.3, None),
 "u_zeke": (27.1, 35.8), "u_abel": (28.4, None), "u_kit": (1.5, None),
}
for uid, (h, lv) in actuals.items():
    people[uid]["presence"]["actual"] = {"here": h, "leaving": lv}

# --- Tables (12), in creation order. start/end are integer slots, [start, end).
tables_src = [
 ("t01","The Sunken Keep","D&D 5e","Level-3 dungeon crawl beneath a drowned chapel. Pregens provided.",5,True,2,10,"u_mara"),
 ("t02","Duskvol Heist","Blades in the Dark","One score, one crew, one very angry Spirit Warden.",4,False,2,8,"u_theo"),
 ("t03","Goblin Market","D&D 5e","Low-level, high-chaos. Bring a goblin voice.",6,True,4,12,"u_priya"),
 ("t04","Dead Planet","Mothership","Sci-fi horror on a derelict. You will not all make it.",4,False,10,16,"u_jonah"),
 ("t05","Dragon Heist, Ch. 1","D&D 5e","Waterdeep intro chapter, level 1, new players welcome.",5,True,12,20,"u_mara"),
 ("t06","Strahd Must Die Tonight","D&D 5e","Level-10 one-shot: storm Ravenloft in four hours.",6,False,14,22,"u_wen"),
 ("t07","Summer of '87","Kids on Bikes","Small-town weirdness, no prep needed, rules taught at the table.",5,True,18,24,"u_sol"),
 ("t08","The Long Night","D&D 5e","Survival horror at level 5. Lights off, candles on.",5,False,22,30,"u_theo"),
 ("t09","Midnight Munchkin","Munchkin (board)","Backstabbing card game for the sleepless. Drop in, drop out.",6,True,26,30,"u_priya"),
 ("t10","Graveyard Shift","Call of Cthulhu 7e","Investigators at 1 AM. Sanity not guaranteed.",4,False,30,36,"u_ilse"),
 ("t11","Dawn Patrol","D&D 5e","Level-2 skirmish for early risers and never-sleepers.",5,True,38,46,"u_jonah"),
 ("t12","Breakfast Brawl","Pathfinder 2e","Arena one-shot with pancakes. Pregens provided.",6,True,42,48,"u_rafa"),
]
def eff(p):
    pl = p["presence"]["planned"]; ac = p["presence"]["actual"]
    return (ac["here"] if ac["here"] is not None else pl[0], ac["leaving"] if ac["leaving"] is not None else pl[1])

seats_held = {uid: [] for uid in people}  # list of (from,to) per person
tables = []
for (tid, name, system, pitch, seats, walk, start, end, dm) in tables_src:
    signups = []
    cands = [uid for uid, p in people.items() if not p["dm"]]
    random.shuffle(cands)
    if tid == "t06": cands.remove("u_esme"); cands.insert(0, "u_esme")   # spotlight subject sits at Strahd
    target = seats - {"t03": 2, "t05": 1, "t07": 3, "t09": 2, "t11": 1, "t12": 3}.get(tid, 0)
    for uid in cands:
        if len(signups) >= target: break
        p = people[uid]; a, l = p["presence"]["planned"]
        f, t = max(a, start), min(l, end)
        if t - f < 2: continue                 # needs at least an hour of overlap
        if any(not (t <= x or f >= y) for (x, y) in seats_held[uid]): continue
        actual = None
        if uid in actuals and random.random() < 0.5:
            h, lv = actuals[uid]
            af = max(h, f) if h is not None else None
            at = min(lv, t) if lv is not None else None
            if af is not None or at is not None: actual = [af, at]
        signups.append({"person": uid, "planned": [f, t], "actual": actual})
        seats_held[uid].append((f, t))
    tables.append({
        "id": tid, "name": name, "system": system, "pitch": pitch, "seats": seats,
        "walk_ins": walk, "start": start, "end": end, "dm": dm,
        "created_at": f"2026-10-{10 + len(tables)*1:02d}T18:{len(tables)*4:02d}:00-05:00",
        "signups": signups,
    })

events = [
 {"id": "e01", "kind": "announce", "at": 0.9,  "duration": None, "text": "Doors are open. Grab a lanyard at the desk and find your DM on the board.", "person": None, "by": "u_admin"},
 {"id": "e02", "kind": "break",    "at": 8.0,  "duration": 1.0,  "text": None, "person": None, "by": "u_admin"},
 {"id": "e03", "kind": "meal",     "at": 16.0, "duration": 2.0,  "text": "Dinner", "person": None, "by": "u_admin"},
 {"id": "e04", "kind": "spotlight","at": 20.3, "duration": None, "text": "Esme rolled three nat 20s in a row and killed Strahd with a spoon.", "person": "u_esme", "by": "u_admin"},
 {"id": "e05", "kind": "announce", "at": 27.8, "duration": None, "text": "Quiet hours from midnight. Sleepers are in the back room; keep the cheering to the hall.", "person": None, "by": "u_admin"},
 {"id": "e06", "kind": "break",    "at": 30.0, "duration": 0.5,  "text": None, "person": None, "by": "u_admin"},
]

# The organiser is captured like anyone else; admin-kind events and approved
# donations carry their person id in `by`. Hidden shouts retain no name.
person("u_admin", "Devin", planned=[0, 48], here=0.2)
for at, kind, who, text in [
    (2.4, 'shout', 'u_ada', 'Huzzah!'),
    (6.2, 'shout', 'u_kit', 'Natural 20!'),
    (11.7, 'donation', 'u_lena', 'For every adventurer finding their first party!'),
    (15.1, 'shout', 'u_mara', 'Roll for initiative!'),
    (23.4, 'shout', 'u_vera', 'More snacks!'),
    (32.8, 'donation', 'u_bea', 'May your dice be kind and your table welcoming.'),
    (37.2, 'shout', 'u_cass', 'Huzzah!'),
    (44.6, 'shout', 'u_rafa', 'Natural 20!'),
]:
    events.append(dict(id=f'e{len(events) + 1:02}', kind=kind, at=at,
                       duration=None, text=text, person=who,
                       by=who if kind == 'shout' else 'u_admin'))
events.sort(key=lambda e: e['at'])

for pad, table in enumerate(tables):
    table["pad"] = pad
for p in people.values():
    p["appearance"] = None

doc = {
  "schema": 4,
  "room_layout": {"version": 1, "pad_capacity": 20, "overflow_capacity": 120},
  "phase": "live",
  "generated_at": "2026-11-07T20:09:41Z",
  "event": {
    "name": "Longtable",
    "start": "2026-11-07T10:00:00-05:00",
    "tz": "America/New_York",
    "slot_minutes": 30,
    "slots": 48,
  },
  "people": list(people.values()),
  "tables": tables,
  "events": events,
}
out = "site/data/timeline.sample.json"
json.dump(doc, open(out, "w"), indent=1, ensure_ascii=False)
print(out, "people", len(people), "tables", len(tables), "signups", sum(len(t["signups"]) for t in tables))
for t in tables: print(t["id"], t["name"], f"{t['start']}-{t['end']}", f"{len(t['signups'])}/{t['seats']}")
