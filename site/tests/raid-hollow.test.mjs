import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const moduleURL=process.env.HOLLOW_MODULE?pathToFileURL(process.env.HOLLOW_MODULE):new URL('../raid-hollow.mjs',import.meta.url);
const { hollowLayout, badgePoint, drawHollow, floorLayout, drawFloor, clusterBoxes, glowAt } = await import(moduleURL);

// Reviewed F28 sample snapshot: the public site checkout contains no tools/ or bot/.
const sample={
  "floors": {
    "heart": {
      "id": "heart",
      "suit": "hearts",
      "name": "Heart",
      "weight": 40,
      "hint": "The King's heartbeat echoes loudest from the upper chambers.",
      "rooms": {
        "A": {"card": "A of Hearts", "place": "Aortic arch", "type": "encounter", "entry": true, "special": null},
        "2": {"card": "2 of Hearts", "place": "Heart tube, fore", "type": "hazard", "entry": false, "special": null},
        "3": {"card": "3 of Hearts", "place": "Heart tube", "type": "encounter", "entry": false, "special": null},
        "4": {"card": "4 of Hearts", "place": "Heart tube, crest", "type": "encounter", "entry": false, "special": null},
        "5": {"card": "5 of Hearts", "place": "Heart tube", "type": "flavor", "entry": false, "special": null},
        "6": {"card": "6 of Hearts", "place": "Heart tube, aft", "type": "encounter", "entry": false, "special": null},
        "7": {"card": "7 of Hearts", "place": "Posterior artery", "type": "encounter", "entry": true, "special": null},
        "8": {"card": "8 of Hearts", "place": "Fore ostium", "type": "flavor", "entry": false, "special": null},
        "9": {"card": "9 of Hearts", "place": "Lateral artery (shaft down)", "type": "hazard", "entry": false, "special": null},
        "10": {"card": "10 of Hearts", "place": "Heart Valve", "type": "buff", "entry": false, "special": "heart_valve"},
        "J": {"card": "J of Hearts", "place": "Lateral artery", "type": "encounter", "entry": false, "special": null},
        "K": {"card": "K of Hearts", "place": "Prototype Prime", "type": "miniboss", "entry": false, "special": "prototype_prime"},
        "Q": {"card": "Q of Hearts", "place": "Aft ostium", "type": "hazard", "entry": false, "special": null}
      },
      "edges": [
        [
          "A",
          "2"
        ],
        [
          "2",
          "3"
        ],
        [
          "3",
          "4"
        ],
        [
          "4",
          "5"
        ],
        [
          "5",
          "6"
        ],
        [
          "6",
          "7"
        ],
        [
          "2",
          "8"
        ],
        [
          "3",
          "9"
        ],
        [
          "4",
          "10"
        ],
        [
          "5",
          "J"
        ],
        [
          "J",
          "K"
        ],
        [
          "6",
          "Q"
        ]
      ]
    },
    "digestion": {
      "id": "digestion",
      "suit": "diamonds",
      "name": "Digestion",
      "weight": 30,
      "hint": "The King's heartbeat echoes loudest from the upper chambers.",
      "rooms": {
        "A": {"card": "A of Diamonds", "place": "Midgut mouth", "type": "encounter", "entry": true, "special": null},
        "2": {"card": "2 of Diamonds", "place": "Intestine, fore", "type": "encounter", "entry": false, "special": null},
        "3": {"card": "3 of Diamonds", "place": "Intestine", "type": "flavor", "entry": false, "special": null},
        "4": {"card": "4 of Diamonds", "place": "Intestine, aft", "type": "encounter", "entry": false, "special": null},
        "5": {"card": "5 of Diamonds", "place": "Acid Reservoir", "type": "buff", "entry": false, "special": "acid_reservoir"},
        "6": {"card": "6 of Diamonds", "place": "Tubule (shaft up)", "type": "hazard", "entry": false, "special": null},
        "7": {"card": "7 of Diamonds", "place": "Rear tubule wound", "type": "encounter", "entry": true, "special": null},
        "8": {"card": "8 of Diamonds", "place": "Tubule fork", "type": "encounter", "entry": false, "special": null},
        "9": {"card": "9 of Diamonds", "place": "Tubule tip", "type": "hazard", "entry": false, "special": null},
        "10": {"card": "10 of Diamonds", "place": "Acid Titan", "type": "miniboss", "entry": false, "special": "acid_titan"},
        "J": {"card": "J of Diamonds", "place": "Malpighian tubule", "type": "encounter", "entry": false, "special": null},
        "Q": {"card": "Q of Diamonds", "place": "Malpighian tip", "type": "flavor", "entry": false, "special": null},
        "K": {"card": "K of Diamonds", "place": "Tubule over the ovary (shaft down)", "type": "hazard", "entry": false, "special": null}
      },
      "edges": [
        [
          "A",
          "2"
        ],
        [
          "2",
          "3"
        ],
        [
          "3",
          "4"
        ],
        [
          "4",
          "5"
        ],
        [
          "2",
          "6"
        ],
        [
          "3",
          "8"
        ],
        [
          "8",
          "9"
        ],
        [
          "8",
          "10"
        ],
        [
          "4",
          "J"
        ],
        [
          "J",
          "Q"
        ],
        [
          "J",
          "7"
        ],
        [
          "4",
          "K"
        ]
      ]
    },
    "brood": {
      "id": "brood",
      "suit": "clubs",
      "name": "Brood",
      "weight": 20,
      "hint": "The King's heartbeat echoes loudest from the upper chambers.",
      "rooms": {
        "A": {"card": "A of Clubs", "place": "Genital pore", "type": "encounter", "entry": true, "special": null},
        "2": {"card": "2 of Clubs", "place": "Oviduct", "type": "flavor", "entry": false, "special": null},
        "3": {"card": "3 of Clubs", "place": "Sperm receptacle", "type": "flavor", "entry": false, "special": null},
        "4": {"card": "4 of Clubs", "place": "Egg cluster, fore", "type": "encounter", "entry": false, "special": null},
        "5": {"card": "5 of Clubs", "place": "Egg cluster, fore", "type": "encounter", "entry": false, "special": null},
        "6": {"card": "6 of Clubs", "place": "Egg cluster, fore", "type": "hazard", "entry": false, "special": null},
        "7": {"card": "7 of Clubs", "place": "Cocoon Forge", "type": "buff", "entry": false, "special": "cocoon_forge"},
        "8": {"card": "8 of Clubs", "place": "Phase Matriarch", "type": "miniboss", "entry": false, "special": "phase_matriarch"},
        "9": {"card": "9 of Clubs", "place": "Egg cluster (shaft up)", "type": "hazard", "entry": false, "special": null},
        "10": {"card": "10 of Clubs", "place": "Egg cluster, aft", "type": "encounter", "entry": false, "special": null},
        "J": {"card": "J of Clubs", "place": "Egg cluster, aft", "type": "encounter", "entry": false, "special": null},
        "Q": {"card": "Q of Clubs", "place": "Ovary root (shaft down)", "type": "hazard", "entry": false, "special": null},
        "K": {"card": "K of Clubs", "place": "Rear wound", "type": "encounter", "entry": true, "special": null}
      },
      "edges": [
        [
          "A",
          "2"
        ],
        [
          "2",
          "3"
        ],
        [
          "2",
          "4"
        ],
        [
          "4",
          "5"
        ],
        [
          "5",
          "6"
        ],
        [
          "6",
          "4"
        ],
        [
          "6",
          "7"
        ],
        [
          "7",
          "8"
        ],
        [
          "8",
          "9"
        ],
        [
          "9",
          "7"
        ],
        [
          "9",
          "10"
        ],
        [
          "10",
          "J"
        ],
        [
          "J",
          "Q"
        ],
        [
          "Q",
          "10"
        ],
        [
          "J",
          "K"
        ]
      ]
    },
    "silk": {
      "id": "silk",
      "suit": "spades",
      "name": "Silk",
      "weight": 10,
      "hint": "The King's heartbeat echoes loudest from the upper chambers.",
      "rooms": {
        "A": {"card": "A of Spades", "place": "Book lung", "type": "encounter", "entry": true, "special": null},
        "2": {"card": "2 of Spades", "place": "Gland bed", "type": "flavor", "entry": false, "special": null},
        "3": {"card": "3 of Spades", "place": "Fore gland", "type": "encounter", "entry": false, "special": null},
        "4": {"card": "4 of Spades", "place": "Fore gland", "type": "flavor", "entry": false, "special": null},
        "5": {"card": "5 of Spades", "place": "Fore gland (shaft up)", "type": "hazard", "entry": false, "special": null},
        "6": {"card": "6 of Spades", "place": "Great gland", "type": "encounter", "entry": false, "special": null},
        "7": {"card": "7 of Spades", "place": "Great gland", "type": "hazard", "entry": false, "special": null},
        "8": {"card": "8 of Spades", "place": "Web Prophet", "type": "miniboss", "entry": false, "special": "web_prophet"},
        "9": {"card": "9 of Spades", "place": "Great gland", "type": "encounter", "entry": false, "special": null},
        "Q": {"card": "Q of Spades", "place": "Spinneret chamber", "type": "encounter", "entry": false, "special": null},
        "K": {"card": "K of Spades", "place": "Spinnerets", "type": "encounter", "entry": true, "special": null},
        "10": {"card": "10 of Spades", "place": "Nerve cord", "type": "hazard", "entry": false, "special": null},
        "J": {"card": "J of Spades", "place": "Nerve Nexus", "type": "buff", "entry": false, "special": "nerve_nexus"}
      },
      "edges": [
        [
          "A",
          "2"
        ],
        [
          "2",
          "3"
        ],
        [
          "3",
          "4"
        ],
        [
          "4",
          "5"
        ],
        [
          "5",
          "Q"
        ],
        [
          "2",
          "6"
        ],
        [
          "6",
          "7"
        ],
        [
          "7",
          "8"
        ],
        [
          "8",
          "9"
        ],
        [
          "9",
          "Q"
        ],
        [
          "Q",
          "K"
        ],
        [
          "2",
          "10"
        ],
        [
          "10",
          "J"
        ]
      ]
    }
  },
  "shafts": [
    [
      [
        "heart",
        "9"
      ],
      [
        "digestion",
        "6"
      ]
    ],
    [
      [
        "digestion",
        "K"
      ],
      [
        "brood",
        "9"
      ]
    ],
    [
      [
        "brood",
        "Q"
      ],
      [
        "silk",
        "5"
      ]
    ]
  ]
};
const proto={"floors": {"heart": {"suit": "hearts", "rooms": {"A": {"type": "e", "place": "Aortic arch", "entry": true}, "2": {"type": "h", "place": "Heart tube, fore", "entry": false}, "3": {"type": "e", "place": "Heart tube", "entry": false}, "4": {"type": "e", "place": "Heart tube, crest", "entry": false}, "5": {"type": "f", "place": "Heart tube", "entry": false}, "6": {"type": "e", "place": "Heart tube, aft", "entry": false}, "7": {"type": "e", "place": "Posterior artery", "entry": true}, "8": {"type": "f", "place": "Fore ostium", "entry": false}, "9": {"type": "h", "place": "Lateral artery (shaft down)", "entry": false}, "10": {"type": "b", "place": "Heart Valve", "entry": false}, "J": {"type": "e", "place": "Lateral artery", "entry": false}, "K": {"type": "m", "place": "Prototype Prime", "entry": false}, "Q": {"type": "h", "place": "Aft ostium", "entry": false}}, "edges": [["A", "2"], ["2", "3"], ["3", "4"], ["4", "5"], ["5", "6"], ["6", "7"], ["2", "8"], ["3", "9"], ["4", "10"], ["5", "J"], ["J", "K"], ["6", "Q"]]}, "digestion": {"suit": "diamonds", "rooms": {"A": {"type": "e", "place": "Midgut mouth", "entry": true}, "2": {"type": "e", "place": "Intestine, fore", "entry": false}, "3": {"type": "f", "place": "Intestine", "entry": false}, "4": {"type": "e", "place": "Intestine, aft", "entry": false}, "5": {"type": "b", "place": "Acid Reservoir", "entry": false}, "6": {"type": "h", "place": "Tubule (shaft up)", "entry": false}, "7": {"type": "e", "place": "Rear tubule wound", "entry": true}, "8": {"type": "e", "place": "Tubule fork", "entry": false}, "9": {"type": "h", "place": "Tubule tip", "entry": false}, "10": {"type": "m", "place": "Acid Titan", "entry": false}, "J": {"type": "e", "place": "Malpighian tubule", "entry": false}, "Q": {"type": "f", "place": "Malpighian tip", "entry": false}, "K": {"type": "h", "place": "Tubule over the ovary (shaft down)", "entry": false}}, "edges": [["A", "2"], ["2", "3"], ["3", "4"], ["4", "5"], ["2", "6"], ["3", "8"], ["8", "9"], ["8", "10"], ["4", "J"], ["J", "Q"], ["J", "7"], ["4", "K"]]}, "brood": {"suit": "clubs", "rooms": {"A": {"type": "e", "place": "Genital pore", "entry": true}, "2": {"type": "f", "place": "Oviduct", "entry": false}, "3": {"type": "f", "place": "Sperm receptacle", "entry": false}, "4": {"type": "e", "place": "Egg cluster, fore", "entry": false}, "5": {"type": "e", "place": "Egg cluster, fore", "entry": false}, "6": {"type": "h", "place": "Egg cluster, fore", "entry": false}, "7": {"type": "b", "place": "Cocoon Forge", "entry": false}, "8": {"type": "m", "place": "Phase Matriarch", "entry": false}, "9": {"type": "h", "place": "Egg cluster (shaft up)", "entry": false}, "10": {"type": "e", "place": "Egg cluster, aft", "entry": false}, "J": {"type": "e", "place": "Egg cluster, aft", "entry": false}, "Q": {"type": "h", "place": "Ovary root (shaft down)", "entry": false}, "K": {"type": "e", "place": "Rear wound", "entry": true}}, "edges": [["A", "2"], ["2", "3"], ["2", "4"], ["4", "5"], ["5", "6"], ["6", "4"], ["6", "7"], ["7", "8"], ["8", "9"], ["9", "7"], ["9", "10"], ["10", "J"], ["J", "Q"], ["Q", "10"], ["J", "K"]]}, "silk": {"suit": "spades", "rooms": {"A": {"type": "e", "place": "Book lung", "entry": true}, "2": {"type": "f", "place": "Gland bed", "entry": false}, "3": {"type": "e", "place": "Fore gland", "entry": false}, "4": {"type": "f", "place": "Fore gland", "entry": false}, "5": {"type": "h", "place": "Fore gland (shaft up)", "entry": false}, "6": {"type": "e", "place": "Great gland", "entry": false}, "7": {"type": "h", "place": "Great gland", "entry": false}, "8": {"type": "m", "place": "Web Prophet", "entry": false}, "9": {"type": "e", "place": "Great gland", "entry": false}, "Q": {"type": "e", "place": "Spinneret chamber", "entry": false}, "K": {"type": "e", "place": "Spinnerets", "entry": true}, "10": {"type": "h", "place": "Nerve cord", "entry": false}, "J": {"type": "b", "place": "Nerve Nexus", "entry": false}}, "edges": [["A", "2"], ["2", "3"], ["3", "4"], ["4", "5"], ["5", "Q"], ["2", "6"], ["6", "7"], ["7", "8"], ["8", "9"], ["9", "Q"], ["Q", "K"], ["2", "10"], ["10", "J"]]}}, "shafts": [[["heart", "9"], ["digestion", "6"]], [["digestion", "K"], ["brood", "9"]], [["brood", "Q"], ["silk", "5"]]]};
const checklist=[
  {
    "id": "heart_valve"
  },
  {
    "id": "cocoon_forge"
  },
  {
    "id": "nerve_nexus"
  },
  {
    "id": "acid_reservoir"
  },
  {
    "id": "prototype_prime"
  },
  {
    "id": "phase_matriarch"
  },
  {
    "id": "acid_titan"
  },
  {
    "id": "web_prophet"
  },
  {
    "id": "heart"
  }
];
const record=()=>{
  const calls=[];
  const ctx=new Proxy({}, {get:(_,name)=>(...args)=>calls.push([name,...args]),
    set:(_,name,value)=>{calls.push(['set',name,value]);return true;}});
  return {ctx,calls};
};
const box=([x,y],w,h)=>[[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]];
const segments=points=>points.map((p,i)=>[p,points[(i+1)%points.length]]);
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const pointSegment=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const u=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
  return Math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dy);
};
const segmentDistance=(a,b,c,d)=>{
  if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&
    Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&
    Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))return 0;
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
};
const inside=(point,polygon)=>{
  const sides=segments(polygon).map(([a,b])=>cross(a,b,point));
  return sides.every(n=>n>=0)||sides.every(n=>n<=0);
};
const polygonDistance=(a,b)=>a.some(p=>inside(p,b))||b.some(p=>inside(p,a))?0:
  Math.min(...segments(a).flatMap(([p,q])=>segments(b).map(([r,s])=>segmentDistance(p,q,r,s))));
const textBox=({value,anchor:[x,y],fontSize,align})=>{
  const width=.62*fontSize*value.length;
  return box([x+(align==='left'?width/2:align==='right'?-width/2:0),y],width,fontSize);
};
// Round 1 drew its side face and text inline. Read its actual draw anchors so
// regression failures demonstrate collisions, rather than just missing fields.
const plateParts=plate=>[plate.polygon,plate.side??[
  plate.polygon[3],plate.polygon[2],... [plate.polygon[2],plate.polygon[3]].map(([x,y])=>[x,y+3])]];
function legacyText(layout){
  const {ctx,calls}=record();
  drawHollow(ctx,layout,{dim:.76,countdown:'2:30',hint:sample.floors.heart.hint,entered:['digestion:5']});
  let fontSize=0,align='left';const specs=new Map();
  for(const [op,...args] of calls){
    if(op==='set'&&args[0]==='font')fontSize=parseFloat(args[1]);
    if(op==='set'&&args[0]==='textAlign')align=args[1];
    if(op==='fillText')specs.set(args[0],{value:args[0],anchor:args.slice(1),fontSize,align});
  }
  return [...specs.values()].filter(s=>s.fontSize>=6&&s.value.length>1);
}
test('Hollow shaft tubes clear every non-endpoint pad by 2px',()=>{
  for(const scale of [1,2]){
  const layout=hollowLayout(sample,{width:320*scale,height:180*scale}),collisions=[];
  for(const shaft of layout.shafts)for(const pad of Object.values(layout.pads)){
    if([shaft.from,shaft.to].includes(pad.id))continue;
    const bounds=box(pad.center,8*scale,6*scale);
    const distance=Math.min(...shaft.points.slice(1).map((b,i)=>{
      const a=shaft.points[i];
      return inside(a,bounds)||inside(b,bounds)?0:
        Math.min(...segments(bounds).map(([c,d])=>segmentDistance(a,b,c,d)));
    }));
    // Include the outer 5px tube stroke, not just its centreline.
    if(distance<4.5*scale)collisions.push(`${shaft.from} → ${shaft.to} passes ${(distance/scale).toFixed(2)}px from ${pad.id}`);
  }
  assert.deepEqual(collisions,[]);
  }
});
test('Hollow plate surfaces and side faces are disjoint with 3px gaps',()=>{
  const {plates}=hollowLayout(sample);
  for(const [i,a] of plates.entries())for(const [j,b] of plates.entries())if(j>i){
    const distance=Math.min(...plateParts(a).flatMap(p=>plateParts(b).map(q=>polygonDistance(p,q))));
    assert.ok(distance>0,`${a.id} overlaps ${b.id}`);
    if(j===i+1){
      assert.ok(distance>=3,`${a.id} → ${b.id} gap is ${distance.toFixed(2)}px`);
      // Keep an open horizontal band as well: tilted silhouettes must not share
      // rows, which makes the four layers distinguishable at trailer resolution.
      const verticalGap=Math.min(...plateParts(b).flat().map(p=>p[1]))-
        Math.max(...plateParts(a).flat().map(p=>p[1]));
      assert.ok(verticalGap>=3,`${a.id} → ${b.id} vertical gap is ${verticalGap}px`);
    }
  }
});
test('Hollow labels, countdown, hint, ledge and footer have disjoint boxes',()=>{
  const layout=hollowLayout(sample),items=[];
  if(layout.text){
    for(const plate of layout.plates)items.push({id:plate.name,floor:plate.id,polygon:textBox(plate.label)});
    const {title,countdown,hintLines,footer}=layout.text;
    const longest=Object.values(sample.floors).flatMap(f=>Object.values(f.rooms)).filter(r=>r.special)
      .map(r=>r.place).sort((a,b)=>b.length-a.length)[0];
    for(const spec of [title,countdown,...hintLines,{...footer,value:longest},layout.ledge.label])
      items.push({id:spec.value,polygon:textBox(spec)});
  }else{
    for(const spec of legacyText(layout))items.push({id:spec.value,
      floor:layout.plates.find(p=>p.name===spec.value)?.id,polygon:textBox(spec)});
  }
  items.push({id:'ledge',polygon:layout.ledge.polygon});
  for(const [i,a] of items.entries()){
    for(const p of a.polygon)assert.ok(p[0]>=16&&p[0]<=304&&p[1]>=16&&p[1]<=164,`${a.id} outside safe margin`);
    for(const b of items.slice(i+1))assert.ok(polygonDistance(a.polygon,b.polygon)>0,`${a.id} overlaps ${b.id}`);
    for(const plate of layout.plates)if(plate.id!==a.floor)for(const part of plateParts(plate))
      assert.ok(polygonDistance(a.polygon,part)>0,`${a.id} overlaps ${plate.name} plate`);
  }
  assert.ok(layout.text,'Text anchors must be exposed by the layout');
  for(const plate of layout.plates)for(const part of plateParts(plate))for(const [x,y] of part)
    assert.ok(x>=16&&x<=304&&y>=16&&y<=164,`${plate.name} outside safe margin`);
});
test('Hollow waiting ledge clusters are drawn above the dim veil',()=>{
  const layout=hollowLayout(sample),{ctx,calls}=record();
  drawHollow(ctx,layout,{dim:.76,ledge:layout.ledge.markers.map((_,i)=>({label:String(i),color:'#dfba76'}))});
  const veil=calls.findIndex(c=>c[0]==='set'&&c[1]==='fillStyle'&&c[2]==='rgba(18,29,25,0.76)');
  assert.ok(veil>=0);
  for(const marker of layout.ledge.markers)
    assert.ok(calls.findIndex(c=>c[0]==='ellipse'&&c[1]===marker[0]&&c[2]===marker[1]+1.5*layout.scale)>veil);
});
test('Hollow layout is deterministic and JSON round-trips',()=>{
  const a=hollowLayout(sample),b=hollowLayout(sample);
  assert.deepEqual(a,b);assert.deepEqual(a,JSON.parse(JSON.stringify(a)));
  assert.deepEqual(a.plates.map(p=>p.id),['heart','digestion','brood','silk']);
});
test('Hollow pads do not overlap at 320x180 and have a 16px safe margin',()=>{
  for(const scale of [1,2]){
  const pads=Object.values(hollowLayout(sample,{width:320*scale,height:180*scale}).pads);
  for(const a of pads){
    assert.ok(a.center[0]>=20*scale&&a.center[0]<=300*scale&&a.center[1]>=19*scale&&a.center[1]<=161*scale);
    for(const b of pads)if(a.id!==b.id){
      assert.ok(Math.abs(a.center[0]-b.center[0])>=8*scale||Math.abs(a.center[1]-b.center[1])>=6*scale,`${a.id} overlaps ${b.id}`);
    }
  }
  }
});
test('Hollow F9 hidden room draws ignore every type and special; entered special names reveal',()=>{
  const draws=[];
  for(const type of ['encounter','hazard','flavor','buff','miniboss']){
    const data=structuredClone(sample),room=data.floors.digestion.rooms['5'];
    room.type=type;room.special=type==='encounter'?null:'acid_reservoir';
    const {ctx,calls}=record();drawHollow(ctx,hollowLayout(data),{entered:[]});draws.push(calls);
  }
  for(const calls of draws.slice(1))assert.deepEqual(calls,draws[0]);
  const {ctx,calls}=record();drawHollow(ctx,hollowLayout(sample),{entered:['digestion:5']});
  assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='Acid Reservoir'));
});
test('Hollow badgePoint at equals all 52 pad centres',()=>{
  const layout=hollowLayout(sample);assert.equal(Object.keys(layout.pads).length,52);
  for(const [at,pad] of Object.entries(layout.pads))assert.deepEqual(badgePoint(layout,{at}),pad.center);
});
test('Hollow mid-vein badges use u and stay on the polyline in either direction',()=>{
  const layout=hollowLayout(sample);
  for(const edge of layout.veins){
    const a=layout.pads[edge.from].center,b=layout.pads[edge.to].center;
    const mid=badgePoint(layout,{from:edge.from,to:edge.to,u:.5});
    for(let axis=0;axis<2;axis++)if(a[axis]!==b[axis]){
      assert.ok(mid[axis]>Math.min(a[axis],b[axis])&&mid[axis]<Math.max(a[axis],b[axis]));
    }
    const distance=Math.abs((b[0]-a[0])*(a[1]-mid[1])-(a[0]-mid[0])*(b[1]-a[1]))/Math.hypot(b[0]-a[0],b[1]-a[1]);
    assert.ok(distance<=.5);
    assert.deepEqual(mid,badgePoint(layout,{from:edge.to,to:edge.from,u:.5}));
    assert.deepEqual(badgePoint(layout,{from:edge.from,to:edge.to,u:0}),a);
    assert.deepEqual(badgePoint(layout,{from:edge.from,to:edge.to,u:1}),b);
  }
});
test('Hollow shaft badges follow the tube and reverse correctly',()=>{
  const layout=hollowLayout(sample);
  for(const edge of layout.shafts){
    for(const u of [0,.25,.5,.75,1]){
      const p=badgePoint(layout,{from:edge.from,to:edge.to,u});
      const reverse=badgePoint(layout,{from:edge.to,to:edge.from,u:1-u});
      assert.ok(Math.hypot(p[0]-reverse[0],p[1]-reverse[1])<1e-8);
      assert.ok(edge.points.slice(1).some((b,i)=>{
        const a=edge.points[i];
        return p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&
          p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
      }));
    }
  }
});
test('Hollow sample preserves draft-1 rooms, edges, shafts and F28 constraints',()=>{
  const order=['heart','digestion','brood','silk'],types={e:'encounter',h:'hazard',f:'flavor',b:'buff',m:'miniboss'};
  const expected={heart:{10:'heart_valve',K:'prototype_prime'},digestion:{5:'acid_reservoir',10:'acid_titan'},
    brood:{7:'cocoon_forge',8:'phase_matriarch'},silk:{J:'nerve_nexus',8:'web_prophet'}};
  assert.deepEqual(Object.keys(sample.floors),order);
  for(const [index,id] of order.entries()){
    const floor=sample.floors[id],source=proto.floors[id];
    assert.equal(floor.id,id);assert.equal(floor.name,id[0].toUpperCase()+id.slice(1));
    assert.equal(floor.suit,source.suit);assert.equal(floor.weight,[40,30,20,10][index]);assert.ok(floor.hint.length>0);
    assert.equal(Object.keys(floor.rooms).length,13);assert.equal(Object.values(floor.rooms).filter(r=>r.entry).length,2);
    assert.deepEqual(floor.edges,source.edges);
    for(const [rank,room] of Object.entries(floor.rooms)){
      assert.deepEqual(room,{card:`${rank} of ${source.suit[0].toUpperCase()+source.suit.slice(1)}`,
        place:source.rooms[rank].place,type:types[source.rooms[rank].type],entry:source.rooms[rank].entry,special:expected[id][rank]??null});
      if(room.special)assert.ok(checklist.some(c=>c.id===room.special));
    }
    const visited=new Set(['A']);
    for(let n=0;n<13;n++)for(const [a,b] of floor.edges){if(visited.has(a))visited.add(b);if(visited.has(b))visited.add(a);}
    assert.equal(visited.size,13);
  }
  assert.deepEqual(sample.shafts,proto.shafts);
  for(const [[a,ar],[b,br]] of sample.shafts){
    assert.equal(Math.abs(order.indexOf(a)-order.indexOf(b)),1);
    assert.ok(sample.floors[a].rooms[ar]);assert.ok(sample.floors[b].rooms[br]);
  }
});

function optionalJSON(t,path){
  const url=new URL(path,import.meta.url);
  if(!existsSync(url)){t.skip(`${path} is absent in the public site checkout`);return null;}
  return JSON.parse(readFileSync(url,'utf8'));
}
test('Hollow embedded sample cross-checks the source floor prototype when present',t=>{
  const source=optionalJSON(t,'../../tools/proto-raid-floors/floors.json');if(!source)return;
  assert.deepEqual(proto,source);
  const types={e:'encounter',h:'hazard',f:'flavor',b:'buff',m:'miniboss'};
  for(const [id,floor]of Object.entries(source.floors)){
    assert.equal(sample.floors[id].suit,floor.suit);
    assert.deepEqual(sample.floors[id].edges,floor.edges);
    assert.deepEqual(Object.keys(sample.floors[id].rooms).sort(),Object.keys(floor.rooms).sort());
    for(const [rank,room]of Object.entries(floor.rooms)){
      const actual=sample.floors[id].rooms[rank];
      assert.deepEqual({type:actual.type,place:actual.place,entry:actual.entry},
        {type:types[room.type],place:room.place,entry:room.entry},`${id}:${rank}`);
    }
  }
  assert.deepEqual(sample.shafts,source.shafts);
});
test('Hollow embedded specials cross-check the bot checklist ids when present',t=>{
  const source=optionalJSON(t,'../../bot/raids/spider-mech.json');if(!source)return;
  assert.deepEqual(checklist.map(c=>c.id).sort(),source.checklist.map(c=>c.id).sort());
  for(const floor of Object.values(sample.floors))for(const room of Object.values(floor.rooms))
    if(room.special)assert.ok(source.checklist.some(c=>c.id===room.special),`Unknown special ${room.special}`);
});
test('Hollow embedded snapshot cross-checks the harness sample when present',t=>{
  const source=optionalJSON(t,'../../tools/raid-hollow-harness/floors.sample.json');if(!source)return;
  assert.deepEqual(sample,source);
});

const intersects=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
function floorItems(layout,scene){
  const clusters=clusterBoxes(layout,scene);
  return [...Object.entries(layout.boxes).map(([id,b])=>({id,...b})),
    ...Object.values(layout.pads).map(p=>({id:p.id,...p.box})),
    ...layout.shafts.map(s=>({id:`${s.id}:label`,...s.labelBox})),
    ...clusters.flatMap(c=>[{id:c.id,pad:c.pad,...c.box},{id:`${c.id}:flag`,owner:c.id,...c.flag}])];
}
function assertFloorGeometry(layout,scene){
  const items=floorItems(layout,scene);
  for(const [i,a] of items.entries()){
    assert.ok(a.x>=16&&a.y>=16&&a.x+a.w<=layout.width-16&&a.y+a.h<=layout.height-16,`${layout.floor} ${a.id} outside safe margin`);
    for(const b of items.slice(i+1)){
      if(a.pad===b.id||b.pad===a.id||a.owner===b.id||b.owner===a.id)continue;
      assert.ok(!intersects(a,b),`${layout.floor} ${a.id} overlaps ${b.id}`);
    }
  }
}
function scenes(layout){
  const ids=Object.keys(layout.pads),party=(at,i)=>({at,label:String(i+1),color:'#dfba76'});
  const edge=layout.veins[0];
  return [{clusters:[ids[0],ids[3],ids[7],ids[12]].map(party)},
    {clusters:[party(ids[0],0),party(ids[0],1)]},
    {clusters:[{label:'1',color:'#9cdbcd',from:edge.from,to:edge.to,u:.5}]}];
}
// Read the public polylines; the legacy segment fallback lets these geometric
// assertions run against round 2 rather than failing on a missing property.
function vesselSegments(layout){
  return layout.vesselTrees?layout.vesselTrees.flatMap(branch=>branch.points.slice(1).map((b,i)=>({
    a:branch.points[i],b,ra:branch.widths[i]/2,rb:branch.widths[i+1]/2,branch,index:i}))):
    layout.decorativeVessels.map(v=>({...v,branch:null}));
}
const samePoint=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6;
function organDistance(layout,p,vein=null){
  return Math.min(...layout.glowSources.filter(s=>vein===null||s.vein===vein).map(s=>{
    const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1];
    const u=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p[0]-s.a[0]-u*dx,p[1]-s.a[1]-u*dy)-s.ra-(s.rb-s.ra)*u;
  }));
}
for(const id of ['heart','digestion','brood','silk']){
  test(`Floor ${id} vessel trees (a) intersect only at connected forks`,()=>{
    const layout=floorLayout(sample,id),vessels=vesselSegments(layout),crossings=[];
    for(const [i,a]of vessels.entries())for(const b of vessels.slice(i+1)){
      if(segmentDistance(a.a,a.b,b.a,b.b)>1e-6)continue;
      const shared=[a.a,a.b].filter(p=>[b.a,b.b].some(q=>samePoint(p,q)));
      const connected=!a.branch&&!b.branch&&a.root===b.root||a.branch&&b.branch&&(a.branch.id===b.branch.id&&Math.abs(a.index-b.index)===1||
        a.branch.parent===b.branch.id||b.branch.parent===a.branch.id||
        a.branch.parent!==null&&a.branch.parent===b.branch.parent);
      // Two collinear strokes sharing an endpoint may still overlap in length.
      const interior=[a.a,a.b].some(p=>![b.a,b.b].some(q=>samePoint(p,q))&&pointSegment(p,b.a,b.b)<1e-6)||
        [b.a,b.b].some(p=>![a.a,a.b].some(q=>samePoint(p,q))&&pointSegment(p,a.a,a.b)<1e-6);
      if(shared.length!==1||!connected||interior)crossings.push([i,vessels.indexOf(b)]);
    }
    assert.deepEqual(crossings,[],`${id} decorative intersections outside connected forks`);
  });
  test(`Floor ${id} vessel trees (b) clear organ bodies and graph veins except their own rim roots`,()=>{
    const layout=floorLayout(sample,id),violations=[];
    for(const [index,v]of vesselSegments(layout).entries()){
      for(const vein of layout.veins)if(segmentDistance(v.a,v.b,...vein.points)<1e-6)
        violations.push(`${index} crosses graph vein ${vein.from} → ${vein.to}`);
      const steps=Math.ceil(Math.hypot(v.b[0]-v.a[0],v.b[1]-v.a[1]));
      for(let i=0;i<=steps;i++){
        const u=i/steps,p=v.a.map((n,k)=>n+(v.b[k]-n)*u),radius=v.ra+(v.rb-v.ra)*u;
        const root=v.branch?.parent===null&&v.index===0;
        const atAttachment=root&&Math.hypot(p[0]-v.branch.points[0][0],p[1]-v.branch.points[0][1])<=v.ra*2;
        const d=organDistance(layout,p);
        if(d< -1e-5||!atAttachment&&d<radius-1e-5){violations.push(`${index} enters organ body`);break;}
        if(atAttachment)for(const source of layout.glowSources)if(source.vein!==v.branch.organ){
          // An attachment collar cannot excuse a hit on a different organ.
          const other=organDistance({...layout,glowSources:[source]},p);
          if(other<radius-1e-5){violations.push(`${index} root enters another organ`);break;}
        }
      }
    }
    assert.deepEqual(violations,[],`${id} decorative organ/graph crossings`);
    for(const root of layout.vesselTrees?.filter(b=>b.parent===null)??[])
      assert.ok(Math.abs(organDistance(layout,root.points[0],root.organ))<1e-4,'Root must be on its own organ rim');
  });
  test(`Floor ${id} vessel trees (c) expose connected polylines with monotone widths and outward growth`,()=>{
    const layout=floorLayout(sample,id),branches=layout.vesselTrees;
    assert.ok(branches?.length,'Layout must expose vessel polylines and widths');
    const tips=new Set(branches.map(b=>b.parent));
    for(const branch of branches){
      assert.equal(branch.widths.length,branch.points.length);assert.ok(branch.points.length>=3);
      const parent=branch.parent===null?null:branches.find(b=>b.id===branch.parent);
      if(parent){
        assert.equal(branch.root,parent.root);assert.equal(branch.organ,parent.organ);
        assert.deepEqual(branch.points[0],parent.points.at(-1));
        assert.ok(branch.widths[0]<=parent.widths.at(-1));
      }else assert.ok(branch.widths[0]>=3,'Root must be at least 3px wide');
      if(!tips.has(branch.id))assert.ok(branch.widths.at(-1)>=1,'Tip must remain at least 1px wide');
      let farthest=organDistance(layout,branch.points[0],branch.organ);
      for(let i=0;i<branch.points.length;i++){
        assert.ok(Number.isFinite(branch.widths[i])&&branch.widths[i]>=1);
        if(!i)continue;
        assert.ok(branch.widths[i]<=branch.widths[i-1],'Widths must taper monotonically');
        const a=branch.points[i-1],b=branch.points[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
        for(let j=1;j<=steps;j++){
          const p=a.map((n,k)=>n+(b[k]-n)*j/steps),d=organDistance(layout,p,branch.organ);
          assert.ok(d>=farthest-2,`${id} branch returns toward its root organ`);farthest=Math.max(farthest,d);
        }
      }
    }
    assert.equal(new Set(branches.map(b=>b.id)).size,branches.length);
    for(const branch of branches)if(tips.has(branch.id))
      assert.ok(branches.filter(b=>b.parent===branch.id).length<=2,'Only binary forks are allowed');
  });
  test(`Floor ${id} vessel trees (d) have between 10 and 40 rim roots`,()=>{
    const layout=floorLayout(sample,id),roots=layout.vesselTrees?.filter(b=>b.parent===null)??[];
    assert.ok(roots.length>=10&&roots.length<=40,`${id} has ${roots.length} roots`);
    assert.equal(new Set(roots.map(b=>b.root)).size,roots.length);
    for(const branch of layout.vesselTrees)assert.ok(roots.some(r=>r.root===branch.root));
  });
  test(`Floor ${id} vessel trees (e) retain 35% dark background and 15% bright glow on a 4px grid`,t=>{
    const layout=floorLayout(sample,id),coverage=[];
    for(const time of [0,.2,.5,1]){
      let dark=0,bright=0,total=0;
      for(let y=0;y<360;y+=4)for(let x=0;x<640;x+=4){
        const glow=glowAt(layout,{pulse:1,t:time},x,y);dark+=glow<.1;bright+=glow>.3;total++;
      }
      coverage.push({t:time,dark:dark/total,bright:bright/total});
    }
    assert.ok(coverage.every(c=>c.dark>=.35&&c.bright>=.15),JSON.stringify(coverage));
    t.diagnostic(`${id}: ${layout.vesselTrees.filter(b=>b.parent===null).length} roots; peak coverage ${JSON.stringify(coverage)}`);
  });
  test(`Floor ${id} decorative vessels clear pad and text boxes by 2px and pad endpoints by 8px`,()=>{
    const layout=floorLayout(sample,id),vessels=layout.decorativeVessels??[];
    assert.ok(vessels.length>=24,`${id} needs a branching decorative vessel network`);
    const pads=Object.values(layout.pads).map(p=>p.box);
    const boxes=[...pads,...Object.values(layout.boxes),...layout.shafts.map(s=>s.labelBox)];
    for(const vessel of vessels){
      assert.ok(vessel.ra<11&&vessel.rb<=vessel.ra,'Decorative vessels must taper below graph-vein thickness');
      for(const b of boxes){
        const corners=box([b.x+b.w/2,b.y+b.h/2],b.w,b.h);
        const distance=inside(vessel.a,corners)||inside(vessel.b,corners)?0:
          Math.min(...segments(corners).map(([a,b])=>segmentDistance(vessel.a,vessel.b,a,b)));
        assert.ok(distance-vessel.ra>=2-1e-6,`${id} vessel too close to a pad or text box`);
      }
      for(const p of [vessel.a,vessel.b])for(const b of pads){
        const dx=Math.max(b.x-p[0],p[0]-b.x-b.w,0),dy=Math.max(b.y-p[1],p[1]-b.y-b.h,0);
        assert.ok(Math.hypot(dx,dy)-vessel.ra>=8-1e-6,`${id} vessel endpoint too close to a pad`);
      }
    }
  });
  test(`Floor ${id} peak glow reaches 0.3 at 16 samples 8px outside the main organ rim`,()=>{
    const layout=floorLayout(sample,id),sources=layout.glowSources.filter(s=>s.main);
    assert.ok(sources.length>0);
    const center=[0,1].map(k=>(Math.min(...sources.flatMap(s=>[s.a[k],s.b[k]]))+Math.max(...sources.flatMap(s=>[s.a[k],s.b[k]])))/2);
    const distance=p=>Math.min(...sources.map(s=>{
      const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],u=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dy)/(dx*dx+dy*dy||1)));
      return Math.hypot(p[0]-s.a[0]-u*dx,p[1]-s.a[1]-u*dy)-s.ra-(s.rb-s.ra)*u;
    }));
    for(let i=0;i<16;i++){
      const angle=i*Math.PI/8,point=r=>[center[0]+Math.cos(angle)*r,center[1]+Math.sin(angle)*r];
      let hi=Math.hypot(layout.width,layout.height),lo=hi;
      while(lo>0&&distance(point(lo))>8)lo-=.5;
      for(let n=0;n<25;n++){const mid=(lo+hi)/2;if(distance(point(mid))<8)lo=mid;else hi=mid;}
      const p=point((lo+hi)/2);
      assert.ok(Math.abs(distance(p)-8)<1e-4,'Sample must be 8px outside the main rim');
      for(const t of [.2,.5,1])assert.ok(glowAt(layout,{pulse:1,t},...p)>=.3,`${id} rim sample ${i} at t=${t} is too dim`);
    }
  });
  test(`Floor ${id} layout is deterministic and JSON round-trips`,()=>{
    const a=floorLayout(sample,id);assert.deepEqual(a,floorLayout(sample,id));assert.deepEqual(a,JSON.parse(JSON.stringify(a)));
    assert.equal(Object.keys(a.pads).length,13);
    assert.deepEqual(a.veins.map(v=>[v.from.split(':')[1],v.to.split(':')[1]]),sample.floors[id].edges);
  });
  test(`Floor ${id} pads, clusters, flags and text are disjoint inside the safe margin`,()=>{
    const layout=floorLayout(sample,id);
    for(const scene of scenes(layout))assertFloorGeometry(layout,scene);
  });
  test(`Floor ${id} shaft openings clear all pad boxes by 4px`,()=>{
    const layout=floorLayout(sample,id);
    for(const shaft of layout.shafts)for(const pad of Object.values(layout.pads)){
      const a=shaft.box,b=pad.box,dx=Math.max(a.x-b.x-b.w,b.x-a.x-a.w,0),dy=Math.max(a.y-b.y-b.h,b.y-a.y-a.h,0);
      assert.ok(Math.hypot(dx,dy)>=4,`${id} ${shaft.id} too close to ${pad.id}`);
    }
  });
  test(`Floor ${id} peak glow stays below half strength under every text box`,()=>{
    const layout=floorLayout(sample,id);
    for(const scene of scenes(layout)){
      scene.pulse=1;scene.t=.2;
      const boxes=[...Object.values(layout.boxes),...layout.shafts.map(s=>s.labelBox),
        ...Object.values(layout.pads).map(p=>p.rankBox),...clusterBoxes(layout,scene).map(c=>c.flag)];
      for(const b of boxes)for(let y=b.y;y<=b.y+b.h;y+=2)for(let x=b.x;x<=b.x+b.w;x+=2)
        assert.ok(glowAt(layout,scene,x,y)<=.5,`${id} bright glow under text at ${x},${y}`);
    }
  });
}
test('Floor F27 unentered types and specials draw identically; entered special names reveal',()=>{
  const draws=[];
  for(const type of ['encounter','hazard','flavor','buff','miniboss']){
    const data=structuredClone(sample),room=data.floors.heart.rooms['10'];room.type=type;room.special=type==='encounter'?null:'heart_valve';room.place=type;
    const {ctx,calls}=record();drawFloor(ctx,floorLayout(data,'heart'),{specialCard:'heart:10'});draws.push(calls);
  }
  for(const calls of draws.slice(1))assert.deepEqual(calls,draws[0]);
  const {ctx,calls}=record();drawFloor(ctx,floorLayout(sample,'heart'),{entered:['heart:10']});
  assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='+ HEART VALVE'));
});
test('Floor special card is one centered bold uppercase string and title has no panel',()=>{
  const layout=floorLayout(sample,'heart'),{ctx,calls}=record();
  drawFloor(ctx,layout,{entered:['heart:10'],specialCard:'heart:10'});
  const b=layout.boxes.nameCard,index=calls.findIndex(c=>c[0]==='fillText'&&c[1]==='+ HEART VALVE');
  assert.ok(index>=0);assert.deepEqual(calls[index].slice(2),[b.x+b.w/2,b.y+b.h/2]);
  assert.ok(calls.slice(0,index).some(c=>c[0]==='set'&&c[1]==='font'&&c[2].startsWith('bold ')));
  assert.ok(!calls.some(c=>c[0]==='fillText'&&c[1]==='+'&&c[2]>=b.x&&c[3]>=b.y&&c[3]<=b.y+b.h));
  const title=layout.boxes.title;
  assert.ok(!calls.some(c=>c[0]==='fillRect'&&c.slice(1).every((v,i)=>v===[title.x,title.y,title.w,title.h][i])));
});
test('Hollow waiting title can be suppressed while countdown remains',()=>{
  const {ctx,calls}=record();drawHollow(ctx,hollowLayout(sample),{showTitle:false,countdown:'2:30'});
  assert.ok(!calls.some(c=>c[0]==='fillText'&&c[1]==='THE HOLLOW'));
  assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='2:30'));
});
test('Floor and stacked renderers never read clocks or use ambient randomness',()=>{
  const source=readFileSync(new URL('../raid-hollow.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Date\.now|performance\.now|Math\.random|requestAnimationFrame|\b(?:window|document)\b|^import /m);
  const date=globalThis.Date,performance=globalThis.performance,random=Math.random;
  const fail=()=>{throw new Error('ambient time or randomness read');};
  try{
    globalThis.Date=new Proxy(date,{get:fail,construct:fail,apply:fail});globalThis.performance=new Proxy({},{get:fail});Math.random=fail;
    const scene={t:4.8,pulse:1,entered:['heart:10'],sprites:{},clusters:[{label:'1',color:'#dfba76',at:'heart:A'}]};
    drawFloor(record().ctx,floorLayout(sample,'heart'),scene);drawHollow(record().ctx,hollowLayout(sample),scene);
  }finally{globalThis.Date=date;globalThis.performance=performance;Math.random=random;}
});
test('Floor cluster walks join standing anchors continuously on Heart veins',()=>{
  const layout=floorLayout(sample,'heart');
  for(const edge of layout.veins){
    const scene=cluster=>({clusters:[{label:'1',color:'#9cdbcd',...cluster}]});
    const at=id=>clusterBoxes(layout,scene({at:id}))[0].center;
    const moving=u=>clusterBoxes(layout,scene({from:edge.from,to:edge.to,u}))[0].center;
    assert.deepEqual(moving(0),at(edge.from));assert.deepEqual(moving(1),at(edge.to));
    let previous=moving(0);
    for(let n=1;n<=100;n++){
      const next=moving(n/100);assert.ok(Math.hypot(next[0]-previous[0],next[1]-previous[1])<8,'a cluster jumped');previous=next;
    }
  }
});
test('Hollow clusters clear the entered-special footer and every other pad',()=>{
  const layout=hollowLayout(sample,{width:640,height:360}),s=layout.scale;
  const scene={clusters:['silk:8','heart:K','digestion:5','brood:7'].map((at,i)=>({at,label:String(i+1),color:'#dfba76'}))};
  const footer={x:120*s,y:155*s,w:180*s,h:9*s};
  for(const cluster of clusterBoxes(layout,scene)){
    assert.ok(!intersects(cluster.box,footer),'footer hides a huddle');
    for(const pad of Object.values(layout.pads)){
      const bounds={x:pad.center[0]-4*s,y:pad.center[1]-3*s,w:8*s,h:6*s};
      assert.ok(pad.id===cluster.pad||!intersects(cluster.box,bounds),`${cluster.label} covers ${pad.id}`);
      assert.ok(!intersects(cluster.flag,bounds),`${cluster.label} flag covers ${pad.id}`);
    }
  }
});
