// All geometry is in drawing pixels. The caller owns time and canvas upscaling.
const ORDER = ['heart', 'digestion', 'brood', 'silk'];
const COLORS = {
  heart: ['#48252d', '#613039', '#b97574'],
  digestion: ['#303d26', '#42542b', '#a4bd77'],
  brood: ['#51422d', '#665238', '#cfb78b'],
  silk: ['#3e374a', '#51485d', '#c4b4d2'],
};
// Organ graphs: a heart tube, branching gut, egg loops and parallel silk glands.
const POSITIONS = {
  heart: { A:[0,0], 2:[1,0], 3:[2,0], 4:[3,0], 5:[4,0], 6:[5,0], 7:[6,0],
    8:[1,-1.6], 9:[2.1,1.5], 10:[3,-1.3], J:[4,1.3], Q:[5,-1.3], K:[5.2,1.6] },
  digestion: { A:[0,0], 2:[1,0], 3:[2.5,0], 4:[4,0], 5:[6,0], 6:[.8,-1.3],
    7:[6.1,1.6], 8:[2.7,-1.4], 9:[1.9,-1.3], 10:[3.5,-1.3], J:[4.5,1.3],
    Q:[3.6,1.6], K:[5.1,1.6] },
  brood: { A:[0,0], 2:[1,0], 3:[.8,-1.3], 4:[2,0], 5:[2.5,-1.7], 6:[3.1,.8],
    7:[3.8,.3], 8:[4.1,-1.5], 9:[4.9,-1.5], 10:[5.4,-.6], J:[5.8,.7],
    Q:[4.1,1.5], K:[6.5,.7] },
  silk: { A:[0,0], 2:[.8,0], 3:[1.9,-1.3], 4:[3.2,-1.3], 5:[4.6,-1.3],
    6:[1.8,1.7], 7:[2.8,1.3], 8:[3.7,1.6], 9:[4.6,1.3], 10:[2.5,0],
    J:[3.8,0], Q:[5.5,0], K:[6.5,0] },
};
const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function wrapHint(value, maxChars) {
  const lines=[''];
  for (const word of value.split(' ')) {
    if ((lines.at(-1)+(lines.at(-1)?' ':'')+word).length>maxChars) lines.push('');
    lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;
  }
  return lines;
}

export function hollowLayout(data, view = {}) {
  const width = view.width ?? 320, height = view.height ?? 180;
  const sx = width / 320, sy = height / 180;
  const scale = Math.min(sx, sy);
  const point = (x, y) => [Math.round(x * sx), Math.round(y * sy)];
  const label = (value,x,y,size,align='left') => ({value,anchor:point(x,y),fontSize:size*scale,align});
  const layout = { width, height, scale, plates: [], pads: {}, veins: [], shafts: [],
    text: {
      title: label('THE HOLLOW',18,20,8), countdown: label('5:00',44,43,18,'center'),
      hintLines: wrapHint(view.hint??data.floors.heart.hint,14).map((value,i)=>label(value,18,64+i*8,6)),
      footer: {...label('',210,160,8,'center'),maxWidth:180*scale},
    },
    ledge: { polygon: [[20,121],[63,118],[65,145],[22,148]].map(p => point(...p)),
      label: label('PEDICEL',18,113,6),
      markers: [[32,128],[52,127],[33,140],[53,139]].map(p=>point(...p)) } };
  for (const [index, id] of ORDER.entries()) {
    const floor = data.floors[id], top = 38 + index * 32;
    const project = ([x,y]) => point(140 + 22*x + 5*y, top + .6*x + 4.5*y);
    const surface = [[-.55,-2.4],[6.65,-2.4],[6.65,2.4],[-.55,2.4]].map(project);
    const side = [surface[3],surface[2],... [surface[2],surface[3]].map(([x,y])=>[x,y+2*scale])];
    layout.plates.push({ id, name: floor.name, colors: COLORS[id],
      polygon: surface, side, label: label(floor.name,74,top+1,7) });
    for (const [rank, room] of Object.entries(floor.rooms)) {
      layout.pads[`${id}:${rank}`] = { id: `${id}:${rank}`, floor: id, rank,
        center: project(POSITIONS[id][rank]), room: { ...room } };
    }
    for (const [a,b] of floor.edges) {
      const from = `${id}:${a}`, to = `${id}:${b}`;
      layout.veins.push({ from, to, points: [layout.pads[from].center, layout.pads[to].center], color: COLORS[id][2] });
    }
  }
  for (const [a,b] of data.shafts) {
    const from = a.join(':'), to = b.join(':');
    const p = layout.pads[from].center, q = layout.pads[to].center;
    const plates = [a,b].map(([id])=>layout.plates.find(plate=>plate.id===id))
      .sort((a,b)=>ORDER.indexOf(a.id)-ORDER.indexOf(b.id));
    // Shaft endpoints sit on the facing rims; the cross-run uses the open gap.
    const gapY = Math.round((Math.max(...plates[0].side.map(p=>p[1]))+
      Math.min(...plates[1].polygon.map(p=>p[1])))/2);
    layout.shafts.push({ from, to, points: [p, [p[0],gapY], [q[0],gapY], q] });
  }
  return layout;
}

export function badgePoint(layout, badge) {
  if (badge.at) return [...layout.pads[badge.at].center];
  const edge = [...layout.veins, ...layout.shafts].find(e =>
    e.from === badge.from && e.to === badge.to || e.to === badge.from && e.from === badge.to);
  if (!edge) throw new Error(`No Hollow connection: ${badge.from} to ${badge.to}`);
  const points = edge.from === badge.from ? edge.points : [...edge.points].reverse();
  const lengths = points.slice(1).map((p,i) => Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  let distance = clamp(badge.u,0,1) * lengths.reduce((a,b) => a+b,0);
  for (let i=0; i<lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length-1) {
      const u = lengths[i] ? distance/lengths[i] : 0;
      return points[i].map((v,axis) => v+(points[i+1][axis]-v)*u);
    }
    distance -= lengths[i];
  }
  return [...points[0]];
}

function polygon(ctx, points) {
  ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
}
function line(ctx, points, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  points.forEach((p,i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke();
}

export function drawHollow(ctx, layout, scene = {}) {
  const { width, height, scale:s } = layout, entered = new Set(scene.entered ?? []);
  const font = size => `${size*s}px ui-monospace, monospace`;
  const text = (value,x,y,color,size=7) => { ctx.fillStyle=color; ctx.font=font(size); ctx.fillText(value,x,y); };
  const label = (spec,color,value=spec.value) => {
    ctx.textAlign=spec.align; ctx.fillStyle=color; ctx.font=`${spec.fontSize}px ui-monospace, monospace`;
    ctx.fillText(value,...spec.anchor);
  };
  ctx.save(); ctx.imageSmoothingEnabled=false; ctx.lineJoin='miter'; ctx.lineCap='square';
  ctx.fillStyle='#121d19'; ctx.fillRect(0,0,width,height);
  for (const plate of layout.plates) {
    // Ordered 4x4 dither, clipped to the fleshy plate. No random texture state.
    polygon(ctx,plate.polygon); ctx.fillStyle=plate.colors[0]; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle=plate.colors[1];
    const xs=plate.polygon.map(p=>p[0]), ys=plate.polygon.map(p=>p[1]);
    for (let y=Math.floor(Math.min(...ys)/s); y<=Math.ceil(Math.max(...ys)/s); y++)
      for (let x=Math.floor(Math.min(...xs)/s); x<=Math.ceil(Math.max(...xs)/s); x++)
        if (BAYER[y%4][x%4]<5) ctx.fillRect(x*s,y*s,s,s);
    ctx.restore();
    const p=plate.polygon;
    polygon(ctx,plate.side);
    ctx.fillStyle='#1c2925'; ctx.fill();
    line(ctx,[...p,p[0]],plate.colors[2],Math.max(1,s));
  }
  for (const vein of layout.veins) line(ctx,vein.points,vein.color,Math.max(1,s));
  for (const shaft of layout.shafts) {
    line(ctx,shaft.points,'#121d19',5*s); line(ctx,shaft.points,'#7c8971',3*s);
    line(ctx,shaft.points,'#3b4b40',s);
  }
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const specials=[];
  for (const pad of Object.values(layout.pads)) {
    const [x,y]=pad.center, seen=entered.has(pad.id);
    ctx.fillStyle=seen?'#dfba76':'#1c2925'; ctx.fillRect(x-4*s,y-3*s,8*s,6*s);
    text(pad.rank,x,y,seen?'#121d19':'#f1eadb',5);
    // F9: hidden draws above never read type, special or place. Metadata is
    // inspected only after the entered gate, including the name callout.
    if (seen) {
      const glyph={encounter:'×',hazard:'!',flavor:'.',buff:'+',miniboss:'^'}[pad.room.type];
      text(glyph,x-6*s,y,'#f1eadb',6);
      if (pad.room.special) specials.push(pad);
    }
  }
  const disc = (badge,p) => {
    ctx.fillStyle=badge.color; ctx.beginPath(); ctx.arc(...p,5*s,0,Math.PI*2); ctx.fill();
    ctx.textAlign='center'; text(badge.label,...p,'#121d19',7);
  };
  for (const badge of scene.badges??[]) disc(badge,badgePoint(layout,badge));
  // A named entered special gets a high-contrast footer, away from badge discs.
  if (specials.length) {
    const value=specials.map(pad=>pad.room.place).join(' · '), spec=layout.text.footer;
    ctx.fillStyle='#121d19'; ctx.fillRect(120*s,155*s,180*s,9*s);
    label({...spec,fontSize:Math.min(spec.fontSize,spec.maxWidth/(.62*value.length))},'#dfba76',value);
  }
  ctx.fillStyle=`rgba(18,29,25,${clamp(scene.dim??0,0,1)})`; ctx.fillRect(0,0,width,height);
  // Names and the gathering parties share the foreground above the waiting veil.
  for (const plate of layout.plates) label(plate.label,'#f1eadb');
  polygon(ctx,layout.ledge.polygon); ctx.fillStyle='#1c2925'; ctx.fill();
  line(ctx,[...layout.ledge.polygon,layout.ledge.polygon[0]],'#3b4b40',s);
  label(layout.ledge.label,'#dfba76');
  (scene.ledge??[]).forEach((badge,i) => disc(badge,layout.ledge.markers[i]));
  label(layout.text.title,'#dfba76');
  if (scene.countdown !== null && scene.countdown !== undefined) {
    label(layout.text.countdown,'#dfba76',scene.countdown);
  }
  if (scene.hint) {
    wrapHint(scene.hint,14).forEach((value,i)=>{
      const first=layout.text.hintLines[0];
      label({...first,anchor:[first.anchor[0],first.anchor[1]+i*8*s]},'#f1eadb',value);
    });
  }
  ctx.restore();
}
