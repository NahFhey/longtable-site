#!/usr/bin/env python3
"""Build a deterministic 50-person demo without changing the legacy QA sample."""
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
rng = random.Random(50)
data = json.loads((root / 'timeline.sample.json').read_text())
data['schema'] = 7
data['event'].update(name='Lanternlight Marathon — 50-person demo',
                     start='2026-11-14T10:00:00-05:00',
                     host_name='The Lantern & Dice', host_icon_url='')
data['generated_at'] = '2026-11-15T15:00:00Z'
people = {person['id']: person for person in data['people']}
people['u_admin']['name'] = 'Morgan Vale'

for index, (name, start, end) in enumerate([
    ('Rowan Bell', 1, 8), ('Sage Mercer', 5, 17), ('Alex Rivers', 12, 25),
    ('Robin Patel', 20, 33), ('Taylor Finch', 28, 41), ('Casey Moon', 39, 47),
]):
    person = dict(id=f'v{index + 1}', name=name, dm=False, hidden=False,
                  variant=10000 + index * 137,
                  presence=dict(planned=[start, end], actual=dict(here=None, leaving=None)))
    people[person['id']] = person

for index, person in enumerate(people.values()):
    start, end = person['presence']['planned']
    actual = person['presence']['actual']
    actual['here'] = actual['here'] if actual['here'] is not None else round(start + rng.uniform(.08, .6), 3)
    actual['leaving'] = min(actual['leaving'] if actual['leaving'] is not None else round(end - rng.uniform(.08, .6), 3), 47.4)
    person['movements'] = []
    person['appearance'] = None if person['hidden'] else dict(
        skin=index % 4, shirt=index % 15, hair=index % 16, hat=index % 4)
people['u_admin']['presence']['actual'] = dict(here=.05, leaving=47.7)
# Every guest shares one stretch of the marathon: 20% of the event (9.6 slots).
ALL_HERE = (19, 28.6)
for person in people.values():
    actual = person['presence']['actual']
    if actual['here'] > ALL_HERE[0]:
        actual['here'] = round(ALL_HERE[0] - rng.uniform(.3, 4), 3)
    if actual['leaving'] <= ALL_HERE[1]:
        actual['leaving'] = round(ALL_HERE[1] + rng.uniform(.3, 4), 3)
    planned = person['presence']['planned']
    planned[0] = min(planned[0], int(actual['here']))
    planned[1] = max(planned[1], int(actual['leaving']) + 1)
data['people'] = list(people.values())
data['visitors'] = dict(open=True, people=[f'v{i + 1}' for i in range(6)] + ['u_admin'])
data['events'] = []
data['activity'] = []
start_time = datetime.fromisoformat(data['event']['start'])

def activity(at, action, actor, table=None):
    data['activity'].append(dict(id=f'{len(data["activity"]) + 1:032x}',
        at=(start_time + timedelta(minutes=at * 30)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        action=action, actor=actor, person=None, table=table))

def event(at, kind, text=None, person=None, duration=None, **extra):
    data['events'].append(dict(id=f'demo-{len(data["events"]) + 1}', kind=kind,
        at=at, duration=duration, text=text, person=person,
        by=person if kind in ('shout', 'roll') else 'u_admin', **extra))

for person in people.values():
    actual = person['presence']['actual']
    activity(actual['here'], 'here', person['id'])
    activity(actual['leaving'], 'leaving', person['id'])

for table in data['tables']:
    # Finish games before the final departures and cleanup.
    table['end'] = min(table['end'], 46)
    attending = []
    for signup in table['signups']:
        signup['planned'][1] = min(signup['planned'][1], table['end'])
        presence = people[signup['person']]['presence']['actual']
        first = max(signup['planned'][0], presence['here'])
        last = min(signup['planned'][1], presence['leaving'])
        if first < last:
            signup['actual'] = [first, last]
            attending.append(signup)
    table['signups'] = attending
    # Include one snack trip and one recorded roll from a present player per game.
    candidates = [table['dm']] + [signup['person'] for signup in table['signups']]
    for uid in candidates:
        person = people[uid]
        actual = person['presence']['actual']
        first = max(table['start'], actual['here']) + .5
        last = min(table['end'], actual['leaving'])
        if last - first < 1:
            continue
        person['movements'].extend([
            dict(at=first, table=table['id'], destination='food'),
            dict(at=first + .3, table=table['id'], destination='table'),
        ])
        activity(first, 'move_food', uid, table['id'])
        activity(first + .3, 'move_table', uid, table['id'])
        faces = [rng.randint(1, 6) for _ in range(3)]
        event(first + .4, 'roll', person=uid, table=table['id'], visibility='public',
              roll=dict(expression='3d6', faces=faces, sides=6, modifier=0, total=sum(faces)))
        break

event(.4, 'announce', 'Welcome to Lanternlight! A full day of games, snacks, and new friends.')
event(8, 'break', duration=.5)
event(16, 'meal', 'Dinner is ready! Visit the buffet and grab a seat.', duration=1)
event(24, 'announce', 'The late-night games are starting. Welcome, night owls!')
event(30, 'break', duration=.5)
event(39, 'meal', 'Breakfast is served. Coffee and pancakes for the dawn crew!', duration=1)
event(47, 'announce', 'Thank you for a wonderful marathon. Safe travels home!')
for at, uid, kind, text in [
    (2.4, 'u_ada', 'shout', 'Huzzah!'),
    (6.2, 'u_kit', 'shout', 'Natural 20!'),
    (11.7, 'u_lena', 'donation', 'For everyone finding their first adventuring party!'),
    (15.1, 'u_mara', 'shout', 'Roll for initiative!'),
    (23.4, 'u_vera', 'shout', 'More snacks!'),
    (32.8, 'u_bea', 'donation', 'A toast to our overnight adventurers and tireless game masters!'),
    (37.2, 'u_cass', 'shout', 'We survived the night!'),
    (44.6, 'u_rafa', 'shout', 'One last adventure!'),
]:
    event(at, kind, text, person=uid)
for person in people.values():
    person['movements'].sort(key=lambda move: move['at'])
data['events'].sort(key=lambda item: item['at'])
data['activity'].sort(key=lambda item: item['at'])
output = root / 'timeline.demo-50.json'
output.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')
print(f'{output.name}: {len(people)} people, {len(data["tables"])} games, {len(data["events"])} events')
