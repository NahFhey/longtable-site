#!/usr/bin/env python3
"""Write a deterministic schema-8 day; all paths are relative to this file."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def build_sample():
    definition = json.loads((ROOT / 'bot/raids/spider-mech.json').read_text(encoding='utf-8'))
    people, tables = [], []
    for n in range(1, 11):
        ids = [f'u_dm{n}'] + [f'u_player{n}_{p}' for p in range(1, 5)]
        for p, uid in enumerate(ids):
            people.append(dict(id=uid, name=f'DM {n}' if not p else f'Player {n}-{p}', dm=p == 0,
                hidden=False, variant=n * 5 + p, appearance=None, movements=[],
                presence=dict(planned=[0, 48], actual=dict(here=0.1 * n, leaving=None))))
        windows = [(f'day{n}', 0, 40), (f't{n}', 40, 48)] if n <= 9 else [('t10', 0, 48)]
        for tid, start, end in windows:
            tables.append(dict(id=tid, name=f'Table {n}: ' + ('Dawn finale' if start == 40 else 'Long adventure'),
                system='D&D 5e', pitch='A charity adventure; pregenerated characters available.',
                seats=4, walk_ins=True, start=start, end=end, dm=ids[0], pad=len(tables),
                created_at='2026-10-21T18:00:00-04:00',
                signups=[dict(person=uid, planned=[start, end], actual=None) for uid in ids[1:]]))
    specials = {s['leg']: dict(id=s['id'], name=s['name']) for s in definition['specials']}
    legs = [dict(id=l['id'], side=l['side'], name=l['name'], special=specials.get(l['id'])) for l in definition['legs']]
    opening = [dict(table=f't{n+1}', leg=legs[n]['id'] if n < 8 else None) for n in range(9)]
    members = [dict(m) for m in opening]
    log = []

    def emit(minute, kind, admin=False, **fields):
        log.append(dict(at=40 + minute / 30, kind=kind, admin=admin, **fields))

    def timer(minute, which, next_minute, interval, cause, paused=False, remaining=None, pushes_left=3, admin=False):
        emit(minute, 'timer', admin=admin, timer=which,
             next=None if next_minute is None else 40 + next_minute / 30,
             paused=paused, remaining=remaining, interval=interval, pushes_left=pushes_left, cause=cause)

    emit(0, 'open', legs=[dict(leg=l['id'], max=l['hp']['base'] + l['hp']['per_pc'] * 4, table=f't{n+1}')
                         for n, l in enumerate(definition['legs'])], members=opening)
    timer(0, 'lair', 4, 4, 'start')
    all_tables = [f't{n}' for n in range(1, 10)]
    for n, minute in enumerate([4, 9] + list(range(13, 54, 4))):
        action = 'acid_drip' if n % 2 == 0 else 'stompquake'
        emit(minute, 'strike', action=action, timer='lair', targets=['t2', 't6'] if action == 'acid_drip' else all_tables)
        timer(minute, 'lair', minute + 4, 4, 'strike')
    emit(6, 'push', table='t3', minutes=1)
    timer(6, 'lair', 9, 4, 'push', pushes_left=2)
    for minute, leg, table, hp in [(8,'L2','t2',210),(11,'L2','t2',230), # Silkbinder heal
                                  (14,'L1','t1',90),(18,'L1','t1',0),
                                  (29,'L2','t2',50),(32,'L2','t2',0),
                                  (43,'L3','t3',100),(54,'L3','t3',0)]:
        emit(minute, 'leg_hp', leg=leg, table=table, hp=hp)
        if hp == 0:
            emit(minute, 'leg_destroyed', leg=leg, table=table)
    # An organizer frees L4; a destroyed-leg party moves, later leaving it to the reserve.
    for minute, table, old, new, admin in [(10,'t4','L4',None,True),(19,'t1','L1','L4',False),
                                          (22,'t1','L4',None,True),(23,'t9',None,'L4',False)]:
        emit(minute, 'move', admin=admin, table=table, **{'from':old, 'to':new})
        next(m for m in members if m['table'] == table)['leg'] = new
    emit(54, 'phase', phase=2, cause='collapse') # L1/L2/L3: only three total destroyed.
    timer(54, None, None, 4, 'stop', pushes_left=0)
    for minute, item, table in [(60,'cocoon_forge','t7'),(70,'nerve_nexus','t8'),(80,'prototype_prime','t2')]:
        emit(minute,'check',item=item,table=table,undo=False)
    emit(73,'check',admin=True,item='nerve_nexus',table=None,undo=True)
    emit(78,'admin',admin=True,action='coin_grant') # No person or grant amount is public.
    emit(83,'member',admin=True,table='t10',leg=None,change='add')
    emit(84,'member',admin=True,table='t10',leg=None,change='remove')
    emit(90,'check',item='heart',table='t5',undo=False)
    emit(90,'phase',phase=3,cause='heart')
    emit(90,'active',table='t5')
    emit(90,'king_max',max=2250,hp=2250) # Nine running members, including reserves.
    timer(90,'core',95,5,'start')
    pulse_times = [95,100] + list(range(111,227,5))
    for n, minute in enumerate(pulse_times):
        action = 'phase_disruption' if n % 2 else 'chittering_storm'
        emit(minute,'strike',action=action,timer='core',targets=['t4'] if n % 2 else all_tables)
        timer(minute,'core',minute+5,5,'strike')
    emit(101,'king_hp',table='t5',hp=2000)
    timer(102,'core',None,5,'pause',paused=True,remaining=3,admin=True)
    emit(104,'check',item='heart_valve',table='t6',undo=False)
    emit(104,'king_max',max=1912,hp=1662) # floor(2250*.85); subtract the same 338 points.
    timer(108,'core',111,5,'resume',admin=True)
    for minute, table, hp, threshold in [(114,'t5',1400,75),(150,'t9',900,50),(190,'t9',450,25)]:
        emit(minute,'king_hp',table=table,hp=hp)
        emit(minute,'discharge',threshold=threshold,targets=[table])
    emit(137,'active',table='t9')
    emit(226.5,'king_hp',table='t9',hp=0)
    timer(226.5,None,None,5,'stop',pushes_left=0)
    emit(226.5,'end',result='won')
    log.sort(key=lambda e: e['at']) # Stable sort preserves causal order at equal times.
    return dict(schema=8,phase='live',generated_at='2026-11-08T14:00:00Z',
        event=dict(name='Longtable raid sample',start='2026-11-07T10:00:00-05:00',tz='America/New_York',slot_minutes=30,slots=48),
        room_layout=dict(version=1,pad_capacity=20,overflow_capacity=120),visitors=dict(open=True,people=[]),
        people=people,tables=tables,events=[],
        raid=dict(id=definition['id'],name=definition['name'],window=dict(start=40,end=48),art=definition['art'],
            legs=legs,actions=[{k:a[k] for k in ('id','name','timer')} for a in definition['actions']],
            checklist=[{k:c[k] for k in ('id','kind','name')} for c in definition['checklist']],
            discharges=[d['threshold'] for d in definition['discharges']],members=members,log=log))


if __name__ == '__main__':
    out = Path(__file__).with_name('timeline.raid.sample.json')
    out.write_text(json.dumps(build_sample(), indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(out.relative_to(ROOT))
