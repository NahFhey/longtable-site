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
    layout.plates.at(-1).decorativeVessels=floorLayout(data,id).decorativeVessels.map(v=>({...v,
      a:project([(v.a[0]-64)/76,(v.a[1]-201)/52]),
      b:project([(v.b[0]-64)/76,(v.b[1]-201)/52]),ra:v.ra*.22*scale,rb:v.rb*.22*scale}));
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

const INK = '#121d19', CREAM = '#f1eadb', GOLD = '#dfba76';
// Saturated versions of the existing floor accents; Heart uses V9's red.
const GLOW = { heart:'#e2384e', digestion:'#9fcf4d', brood:'#efb64c', silk:'#bd91ed' };
const rect = (x,y,w,h) => ({x,y,w,h});
const overlaps = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;
const contains = (b,x,y) => x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h;
const shifted = (b,dx,dy) => rect(b.x+dx,b.y+dy,b.w,b.h);

export function floorLayout(data, floorId, view = {}) {
  const width=view.width??640, height=view.height??360, sx=width/640, sy=height/360;
  const floor=data.floors[floorId], index=ORDER.indexOf(floorId);
  if (!floor || index<0) throw new Error(`Unknown Hollow floor: ${floorId}`);
  const point=([x,y])=>[Math.round((64+76*x)*sx),Math.round((201+52*y)*sy)];
  const box=(x,y,w,h)=>rect(x*sx,y*sy,w*sx,h*sy);
  const layout={width,height,scale:Math.min(sx,sy),floor:floorId,name:floor.name,index,
    pads:{},veins:[],shafts:[],glowSources:[],
    boxes:{title:box(18,18,260,40),nameCard:box(424,18,198,26)},
    title:{heading:floor.name.toUpperCase(),subheading:`THE HOLLOW · FLOOR ${index+1} / 4`}};
  for (const [rank,room] of Object.entries(floor.rooms)) {
    const id=`${floorId}:${rank}`, center=point(POSITIONS[floorId][rank]);
    layout.pads[id]={id,floor:floorId,rank,center,room:{...room},
      box:rect(center[0]-16*sx,center[1]-10*sy,32*sx,20*sy),
      rankBox:rect(center[0]-7*sx,center[1]-6*sy,14*sx,12*sy)};
  }
  for (const [a,b] of floor.edges) {
    const from=`${floorId}:${a}`,to=`${floorId}:${b}`;
    const points=[layout.pads[from].center,layout.pads[to].center];
    layout.veins.push({from,to,points,color:GLOW[floorId]});
    // The graph supplies the playable organs. Bulges between junctions form chambers;
    // the short subdivisions keep the engraved silhouette continuous.
    const main=POSITIONS[floorId][a][1]===0 && POSITIONS[floorId][b][1]===0;
    for(let j=0;j<6;j++){
      const p=points[0].map((v,k)=>v+(points[1][k]-v)*j/6);
      const q=points[0].map((v,k)=>v+(points[1][k]-v)*(j+1)/6);
      const radius=u=>(main?20+9*Math.sin(Math.PI*u):11+3*Math.sin(Math.PI*u))*layout.scale;
      layout.glowSources.push({a:p,b:q,ra:radius(j/6),rb:radius((j+1)/6),main,strength:1,vein:layout.veins.length-1});
    }
  }
  const links=data.shafts.filter(pair=>pair.some(([id])=>id===floorId));
  links.forEach((pair,i)=>{
    const here=pair.find(([id])=>id===floorId),there=pair.find(([id])=>id!==floorId);
    const down=ORDER.indexOf(there[0])>index;
    const endpoint=layout.pads[here.join(':')].center;
    const upper=!down && endpoint[1]<200*sy;
    const center=[(upper?(endpoint[0]<200*sx?84:550):i===0?180:436)*sx,(upper?84:310)*sy];
    const shaft={id:`shaft:${there[0]}`,from:here.join(':'),to:there.join(':'),center,
      points:[layout.pads[here.join(':')].center,center],
      box:rect(center[0]-31*sx,center[1]-12*sy,62*sx,24*sy),
      label:`${down?'▼':'▲'} ${data.floors[there[0]].name.toUpperCase()}`,
      labelBox:rect(center[0]-66*sx,(upper?100:329)*sy,132*sx,12*sy)};
    layout.shafts.push(shaft);
  });
  layout.vesselTrees=decorativeNetwork(layout);
  // The raster and stacked view share these exact variable-width polylines.
  layout.decorativeVessels=layout.vesselTrees.flatMap(branch=>branch.points.slice(1).map((b,i)=>({
    a:branch.points[i],b,ra:branch.widths[i]/2,rb:branch.widths[i+1]/2,
    root:branch.root,branch:branch.id,parent:branch.parent,index:i})));
  return layout;
}

// Roots attach only to exposed organ rims. Trunks grow first, reserving space
// before two generations of binary forks fill the remaining outward corridors.
function decorativeNetwork(layout){
  const s=layout.scale,result=[],occupied=[],pads=Object.values(layout.pads).map(p=>p.box);
  const text=[...Object.values(layout.boxes),...layout.shafts.flatMap(p=>[p.box,p.labelBox])];
  const clear=(a,b,r)=>pads.every(box=>segmentClearsBox(a,b,box,8*s+r))&&
    text.every(box=>segmentClearsBox(a,b,box,3*s+r));
  const organ=p=>fieldAt(layout,...p).d;
  function grow(origin,heading,radius,length,seed,root,parent=null,own=null){
    const branch={id:result.length,root,parent,organ:parent===null?own:result[parent].organ,
      points:[origin],widths:[radius*2]};
    const sources=layout.glowSources.filter(source=>source.vein===branch.organ);
    const fromRoot=p=>fieldAt(layout,...p,sources).d;
    let a=origin,angle=heading,travelled=0;
    let farthest=fromRoot(origin);
    const steps=Math.ceil(length/(8*s));
    for(let i=0;i<steps;i++){
      const ra=radius*(1-.3*i/steps),rb=Math.max(.8*s,radius*(1-.3*(i+1)/steps));
      const drift=Math.sin(seed+i*.8)*.14;
      let next;
      for(const turn of [0,.18,-.18,.36,-.36,.54,-.54]){
        const direction=angle+drift+turn;
        const b=[clamp(a[0]+Math.cos(direction)*8*s,0,layout.width),clamp(a[1]+Math.sin(direction)*8*s,0,layout.height)];
        if(Math.hypot(b[0]-a[0],b[1]-a[1])<s||!clear(a,b,ra))continue;
        const before=organ(a);
        // Check the whole swept tube, including between vertices. Only the
        // root's attachment footprint may enter its own organ rim.
        let nextFarthest=farthest;
        if(Array.from({length:9},(_,j)=>{
          const u=j/8,p=a.map((v,k)=>v+(b[k]-v)*u),d=organ(p);
          const ownDistance=fromRoot(p),outward=ownDistance>=nextFarthest-.15*s;
          nextFarthest=Math.max(nextFarthest,ownDistance);
          return outward&&d>=before-.15*s && d>=Math.min(ra+1.5*s,(travelled+u*8*s)*.7)-1e-6;
        }).some(ok=>!ok))continue;
        const collides=occupied.some(v=>{
          if(v.branch===branch.id)return segmentsCrossAwayFromEnds(a,b,v.a,v.b);
          // Incident branches share a short, filled junction. Beyond it their
          // swept widths must separate as well as their centre lines.
          const incident=v.branch===parent||v.parent===parent&&parent!==null;
          const nearFork=incident&&Math.hypot(v.b[0]-origin[0],v.b[1]-origin[1])<18*s&&travelled<18*s;
          if(nearFork)return segmentsCrossAwayFromEnds(a,b,v.a,v.b);
          return segmentGap(a,b,v.a,v.b)<ra+v.r+2.5*s;
        });
        if(!collides){next={b,direction,farthest:nextFarthest};break;}
      }
      if(!next)break;
      occupied.push({a,b:next.b,r:ra,branch:branch.id,parent});
      a=next.b;angle=next.direction;farthest=next.farthest;travelled+=8*s;
      branch.points.push(a);branch.widths.push(rb*2);
      if(a[0]===0||a[0]===layout.width||a[1]===0||a[1]===layout.height)break;
    }
    if(branch.points.length<(parent===null?5:3)){
      while(occupied.at(-1)?.branch===branch.id)occupied.pop();
      return null;
    }
    result.push(branch);
    return {branch,angle,seed};
  }
  const trunks=[];
  // Midpoints get first choice; quarter points add roots on longer chambers.
  for(const fraction of [.5,.28,.72])for(const [i,vein]of layout.veins.entries()){
    const [a,b]=vein.points,heading=Math.atan2(b[1]-a[1],b[0]-a[0]);
    for(const sign of [-1,1]){
      if(trunks.length>=24)break;
      const angle=heading+sign*Math.PI/2,normal=[Math.cos(angle),Math.sin(angle)];
      const center=a.map((v,k)=>v+(b[k]-v)*fraction);
      // Find the first exposed rim along this normal; reject buried roots.
      let lo=0,hi=0;
      while(hi<42*s&&organ(center.map((v,k)=>v+normal[k]*hi))<0)hi+=s;
      if(hi>=42*s)continue;
      for(let j=0;j<24;j++){
        const mid=(lo+hi)/2;
        if(organ(center.map((v,k)=>v+normal[k]*mid))<0)lo=mid;else hi=mid;
      }
      const origin=center.map((v,k)=>v+normal[k]*hi),radius=(6.6+hash(i,sign+layout.index)*1.6)*s;
      const own=layout.glowSources.reduce((best,source)=>
        distanceToSource(source,...origin)<distanceToSource(best,...origin)?source:best).vein;
      if(layout.glowSources.some(source=>source.vein!==own&&distanceToSource(source,...origin)<radius+1.5*s))continue;
      const trunk=grow(origin,angle,radius,(32+hash(i,layout.index)*16)*s,i*13+sign+101,trunks.length,null,own);
      if(trunk)trunks.push(trunk);
    }
  }
  let generation=trunks;
  for(let depth=1;depth>=0;depth--){
    const next=[];
    for(const {branch,angle,seed}of generation)for(const sign of [-1,1]){
      const fork=branch.points.at(-1),radius=Math.max(1.4*s,branch.widths.at(-1)*.46);
      const child=grow(fork,angle+sign*(.5+hash(seed,9)*.24),radius,
        (depth?42:80)*s,seed*3+sign,branch.root,branch.id);
      if(child)next.push(child);
    }
    generation=next;
  }
  // Unforked tips finish at a fine but visible width, including blocked twigs.
  const parents=new Set(result.map(b=>b.parent));
  for(const b of result)if(!parents.has(b.id)){
    const start=b.widths[0];b.widths=b.widths.map((_,i)=>start+(1.6*s-start)*i/(b.widths.length-1));
  }
  return result;
}
function pointGap(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],u=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dy);
}
function segmentsCrossAwayFromEnds(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return cross(a,b,c)*cross(a,b,d)<-1e-8&&cross(c,d,a)*cross(c,d,b)<-1e-8;
}
function segmentGap(a,b,c,d){
  return segmentsCrossAwayFromEnds(a,b,c,d)?0:Math.min(pointGap(a,c,d),pointGap(b,c,d),pointGap(c,a,b),pointGap(d,a,b));
}
function segmentClearsBox(a,b,box,padding){
  let lo=0,hi=1;
  for(let k=0;k<2;k++){
    const min=(k?box.y:box.x)-padding,max=(k?box.y+box.h:box.x+box.w)+padding,d=b[k]-a[k];
    if(Math.abs(d)<1e-9){if(a[k]<min||a[k]>max)return true;}
    else{
      const x=(min-a[k])/d,y=(max-a[k])/d;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));
      if(lo>hi)return true;
    }
  }
  return false;
}

function padBounds(layout,pad){return pad.box??rect(pad.center[0]-4*layout.scale,pad.center[1]-3*layout.scale,8*layout.scale,6*layout.scale);}
function staticBoxes(layout) {
  if(!layout.boxes)return [...Object.values(layout.pads).map(p=>({id:p.id,...padBounds(layout,p)})),
    {id:'footer',...rect(120*layout.scale,155*layout.scale,180*layout.scale,9*layout.scale)}];
  return [{id:'title',...layout.boxes.title},{id:'nameCard',...layout.boxes.nameCard},
    ...Object.values(layout.pads).map(p=>({id:p.id,...p.box})),
    ...layout.shafts.map(s=>({id:`${s.id}:label`,...s.labelBox}))];
}

// This is the sole placement path for both the figures and their measured boxes.
// Two parties sharing a room take separate huddles beside its pad.
export function clusterBoxes(layout, scene = {}) {
  const s=layout.scale*(scene.clusterScale??(layout.boxes?1:.35)), placed=[], obstacles=staticBoxes(layout);
  const parties=scene.clusters??scene.badges??[];
  for(const [index,party] of parties.entries()){
    const walking=party.from&&layout.boxes&&layout.pads[party.from]&&layout.pads[party.to];
    let p;
    if(party.point)p=party.point;
    else p=walking?clusterTravel(layout,party):badgePoint(layout,party);
    let pad=party.at??null;
    if(!pad && party.from){
      const candidates=[party.from,party.to].filter(id=>layout.pads[id]);
      const bounds=rect(p[0]-16*s,p[1]-27*s,38*s,37*s);
      pad=candidates.find(id=>overlaps(bounds,padBounds(layout,layout.pads[id])))??null;
    }
    const offsets=walking?[[0,0]]:layout.boxes?PLACEMENTS:[[0,0],...PLACEMENTS];
    let chosen;
    for(const [dx,dy] of offsets){
      const center=[Math.round(p[0]+dx*s),Math.round(p[1]+dy*s)];
      const body=rect(center[0]-16*s,center[1]-22*s,32*s,32*s);
      const flag=rect(center[0]+10*s,center[1]-27*s,12*s,12*s);
      const bounds=rect(center[0]-16*s,center[1]-27*s,38*s,37*s);
      chosen={id:`cluster:${party.label}:${index}`,label:party.label,color:party.color,pad,center,box:bounds,body,flag};
      if(!layout.boxes&&party.point)break;
      const safe=bounds.x>=16 && bounds.y>=16 && bounds.x+bounds.w<=layout.width-16 && bounds.y+bounds.h<=layout.height-16;
      const rank=layout.pads[pad]?.rankBox;
      const clear=(!rank||!overlaps(body,rank))&&obstacles.every(b=>(b.id===pad||!overlaps(bounds,b))&&!overlaps(flag,b));
      if(safe&&clear&&placed.every(c=>!overlaps(bounds,c.box)))break;
    }
    placed.push(chosen);
  }
  return placed;
}

const PLACEMENTS=[[24,0],[-24,0],[24,4],[-24,4],[0,35],[0,-32],[25,35],[-25,-32],
  ...Array.from({length:17},(_,j)=>Array.from({length:15},(_,i)=>[(i-7)*8,(j-7)*8])).flat()
    .sort((a,b)=>Math.hypot(a[0]-24,a[1])-Math.hypot(b[0]-24,b[1]))];
const travelCache=new WeakMap();
function along(points,u){
  const lengths=points.slice(1).map((b,i)=>Math.hypot(b[0]-points[i][0],b[1]-points[i][1]));
  let d=clamp(u,0,1)*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){
    if(d<=lengths[i]||i===lengths.length-1)return points[i].map((v,k)=>v+(points[i+1][k]-v)*(lengths[i]?d/lengths[i]:0));
    d-=lengths[i];
  }
  return points[0];
}
function clusterTravel(layout,party){
  // Canonical edge orientation keeps a cold seek identical to a later return.
  if(party.from>party.to)return clusterTravel(layout,{...party,from:party.to,to:party.from,u:1-party.u});
  let cache=travelCache.get(layout);if(!cache){cache=new Map();travelCache.set(layout,cache);}
  const reverseKey=`${party.to}|${party.from}`,key=`${party.from}|${party.to}`;
  let path=cache.get(key);
  if(!path&&cache.has(reverseKey))path=[...cache.get(reverseKey)].reverse();
  if(!path){
    const edge=[...layout.veins,...layout.shafts].find(e=>e.from===party.from&&e.to===party.to||e.to===party.from&&e.from===party.to);
    if(!edge)throw new Error(`No Hollow connection: ${party.from} to ${party.to}`);
    const points=edge.from===party.from?edge.points:[...edge.points].reverse();
    const anchor=(id,point)=>clusterBoxes(layout,{clusters:[{label:party.label,color:party.color,at:layout.pads[id]?id:undefined,point}]} )[0].center;
    const start=anchor(party.from,points[0]),end=anchor(party.to,points.at(-1));
    const s=layout.scale,obstacles=staticBoxes(layout);
    const clear=p=>{
      const box=rect(p[0]-16*s,p[1]-27*s,38*s,37*s),flag=rect(p[0]+10*s,p[1]-27*s,12*s,12*s),body=rect(p[0]-16*s,p[1]-22*s,32*s,32*s);
      return box.x>=16&&box.y>=16&&box.x+box.w<=layout.width-16&&box.y+box.h<=layout.height-16&&obstacles.every(b=>{
        const endpoint=[party.from,party.to].includes(b.id);
        return (endpoint||!overlaps(box,b))&&!overlaps(flag,b)&&(!endpoint||!overlaps(body,layout.pads[b.id].rankBox));
      });
    };
    const candidates=[[start,end]];
    // Clearance routes remain attached to the same graph edge and join the
    // exact standing anchors. Arc-length interpolation makes every seek pure
    // and prevents the placement solver from flipping sides during a walk.
    for(const bend of [-32,32,-56,56,-80,80]){
      candidates.push([start,[start[0],start[1]+bend*s],[end[0],end[1]+bend*s],end]);
      candidates.push([start,[start[0]+bend*s,start[1]],[end[0]+bend*s,end[1]],end]);
    }
    path=candidates.find(points=>Array.from({length:161},(_,i)=>along(points,i/160)).every(clear));
    if(!path){
      // Use a visibility graph of clearance corners for densely branched organs.
      const nodes=[start,end];
      for(const b of obstacles)for(const x of [b.x-24*s,b.x+b.w+18*s])for(const y of [b.y-14*s,b.y+b.h+30*s])if(clear([x,y]))nodes.push([x,y]);
      const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set();distance[0]=0;
      for(let n=0;n<nodes.length;n++){
        let i=-1;for(let j=0;j<nodes.length;j++)if(!done.has(j)&&(i<0||distance[j]<distance[i]))i=j;
        if(i<0||!Number.isFinite(distance[i])||i===1)break;done.add(i);
        for(let j=0;j<nodes.length;j++)if(!done.has(j)){
          const length=Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1]);
          if(distance[i]+length>=distance[j])continue;
          const steps=Math.ceil(length/2);
          if(Array.from({length:steps+1},(_,k)=>along([nodes[i],nodes[j]],k/steps)).every(clear)){distance[j]=distance[i]+length;previous[j]=i;}
        }
      }
      if(!Number.isFinite(distance[1]))throw new Error(`No cluster clearance route: ${key}`);
      path=[];for(let i=1;i>=0;i=previous[i])path.unshift(nodes[i]);
    }
    cache.set(key,path);
  }
  return along(path,party.u);
}

function distanceToSource(source,x,y){
  const [ax,ay]=source.a,[bx,by]=source.b,dx=bx-ax,dy=by-ay;
  const u=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(x-ax-u*dx,y-ay-u*dy)-source.ra-(source.rb-source.ra)*u;
}
function fieldAt(layout,x,y,sources=layout.glowSources){
  let d=1e9,main=false,strength=0;
  for(const source of sources){
    const next=distanceToSource(source,x,y);
    if(next<d){d=next;main=source.main;strength=source.strength;}
  }
  return {d,main,strength};
}
function artFieldAt(layout,x,y,graph=layout.glowSources,decoration=layout.decorativeVessels??[]){
  const organ=fieldAt(layout,x,y,graph);
  const vessel=fieldAt(layout,x,y,decoration);
  const surface=organ.d<=0||organ.d<=vessel.d?{...organ,organ:true}:{...vessel,organ:false};
  return {...surface,organDistance:organ.d,vesselDistance:vessel.d};
}
function rimGlow(layout,scene,x,field){
  const pulse=clamp(scene.pulse??0,0,1);
  const wave=.75+.25*Math.cos(x/(65*layout.scale)-(scene.t??0)*9);
  // Take the stronger halo, rather than adding branches or switching abruptly
  // at the boundary between a narrow vessel halo and the broad organ halo.
  const organ=Math.exp(-Math.abs(field.organDistance)/(16*layout.scale));
  const vessel=.85*Math.exp(-Math.abs(field.vesselDistance)/(6.5*layout.scale));
  return clamp(Math.max(organ,vessel)*(.6+.4*pulse*wave),0,1);
}
function textShade(layout,x,y){
  const boxes=layout.boxes?[layout.boxes.title,layout.boxes.nameCard,...layout.shafts.map(s=>s.labelBox)]:[];
  let shade=1;
  for(const b of boxes){
    const d=Math.hypot(Math.max(b.x-x,x-b.x-b.w,0),Math.max(b.y-y,y-b.y-b.h,0));
    shade=Math.min(shade,.24+.76*clamp(d/(10*layout.scale),0,1));
  }
  return shade;
}
export function glowAt(layout,scene,x,y){
  // Rank plates and number flags are opaque at the text plane. Other text is
  // conservatively measured against the raw rim field, before its ink panel.
  if(Object.values(layout.pads).some(p=>contains(p.rankBox,x,y)))return 0;
  if(clusterBoxes(layout,scene).some(c=>contains(c.flag,x,y)))return 0;
  return rimGlow(layout,scene,x,artFieldAt(layout,x,y))*textShade(layout,x,y);
}

const rasterCache=new WeakMap();
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const RAMPS=['#151910','#29291e','#494534','#897c5e','#d9cba6','#f1eadb'].map(rgb);
function hash(x,y){let n=Math.imul(x,374761393)^Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return (n>>>0)/4294967296;}
function cellEdge(x,y){
  const size=27,gx=Math.floor(x/size),gy=Math.floor(y/size);let f1=1e9,f2=1e9;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const a=gx+i,b=gy+j,d=Math.hypot(x-(a+hash(a,b))*size,y-(b+hash(b,a+71))*size);
    if(d<f1){f2=f1;f1=d;}else if(d<f2)f2=d;
  }
  return f2-f1;
}
function engraving(ctx,layout,scene){
  const {scale:s}=layout, bounds=layout.rasterBox??{x:0,y:0,w:layout.width,h:layout.height};
  const {x:ox,y:oy,w:width,h:height}=bounds;
  const img=ctx.createImageData(width,height);
  if(!img?.data){
    for(const v of layout.decorativeVessels??[])line(ctx,[v.a,v.b],GLOW[layout.floor],(v.ra+v.rb));
    for(const v of layout.veins){line(ctx,v.points,CREAM,2*s);line(ctx,v.points,INK,s);}
    return;
  }
  let cached=rasterCache.get(layout);
  if(!cached){
    // Bucket nearby segments once. The glow falls below a visible raster step
    // outside this reach; cold seeks need not scan the whole tree per pixel.
    const cell=32*s,reach=80*s,buckets=new Map();
    for(const [kind,sources]of [[0,layout.glowSources],[1,layout.decorativeVessels??[]]])for(const source of sources){
      const r=Math.max(source.ra,source.rb)+reach;
      for(let y=Math.floor((Math.min(source.a[1],source.b[1])-r)/cell);y<=Math.floor((Math.max(source.a[1],source.b[1])+r)/cell);y++)
        for(let x=Math.floor((Math.min(source.a[0],source.b[0])-r)/cell);x<=Math.floor((Math.max(source.a[0],source.b[0])+r)/cell);x++){
          const key=`${x},${y}`;if(!buckets.has(key))buckets.set(key,[[],[]]);buckets.get(key)[kind].push(source);
        }
    }
    const tint=rgb(GLOW[layout.floor]);
    cached=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const [graph,decoration]=buckets.get(`${Math.floor((x+ox)/cell)},${Math.floor((y+oy)/cell)}`)??[[],[]];
      const f=artFieldAt(layout,x+ox,y+oy,graph,decoration),depth=-f.d/s,edge=f.organ?1.3:.9;
      const hatch=f.organ?(x+y)%5===0 && (Math.sin(y/(9*s)+x/(40*s))<.25||depth<4):(x+y)%3===0||(x-y+3e4)%3===0;
      let v=depth>0 ? depth<edge?.97:Math.abs(depth-6)<.7&&f.main?.72:hatch?f.organ?.56:.42:.13 : cellEdge(x/s,y/s)<1.2?.23:.025;
      const n=v*5,i=Math.floor(n),threshold=(BAYER[y&3][x&3]+.5)/16;
      let c=RAMPS[Math.min(5,i+(n-i>threshold?1:0))];
      // Vessel contours take the floor's glow, as engraved lines lit from behind.
      if(!f.organ&&depth>0&&depth<edge)c=c.map((v,j)=>Math.round(v*.55+tint[j]*.45));
      // Engraved interiors stay dark: the glow bleeds from the rims, not the fill.
      if(depth>edge)c=c.map((v,j)=>Math.round(v*.7+tint[j]*(hatch?.3:.12)));
      cached.push({f,c,shade:textShade(layout,x+ox,y+oy)*(depth>edge?f.organ?.3:.45:1)});
    }
    rasterCache.set(layout,cached);
  }
  const glow=rgb(GLOW[layout.floor]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const {f,c,shade}=cached[y*width+x],g=Math.floor(rimGlow(layout,scene,x+ox,f)*shade*16)/16;
    const k=(y*width+x)*4;
    for(let j=0;j<3;j++)img.data[k+j]=Math.round(c[j]*(1-g*.35)+glow[j]*g*.8);
    img.data[k+3]=255;
  }
  ctx.putImageData(img,ox,oy);
}
function lettering(ctx,value,x,y,size,color=CREAM,align='left',bold=false){
  ctx.fillStyle=color;ctx.font=`${bold?'bold ':''}${size}px ui-monospace, monospace`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(value,x,y);
}
function plate(ctx,b,color=INK){ctx.fillStyle=color;ctx.fillRect(b.x,b.y,b.w,b.h);}
function cluster(ctx,item,scene,s){
  const [x,y]=item.center;
  ctx.fillStyle=INK;ctx.strokeStyle=item.color;ctx.lineWidth=Math.max(1,2*s);
  ctx.beginPath();ctx.ellipse(x,y+5*s,16*s,5*s,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  if(scene.sprites){
    const shirts=[[6,0],[10,0],[14,0],[6,3]],hair=[[20,0],[21,4],[24,0],[26,4]];
    [[-9,-8],[2,-10],[-4,-2],[8,-1]].forEach(([dx,dy],i)=>{
      const n=(Number(item.label)||0)+i,bob=Math.round(Math.sin((scene.t??0)*5+i*1.7))*s;
      for(const [col,row] of [[0,n%4],shirts[n%4],hair[n%4]])
        ctx.drawImage(scene.sprites,col*17,row*17,16,16,Math.round(x+(dx-6)*s),Math.round(y+(dy-12)*s+bob),12*s,12*s);
    });
  }
  plate(ctx,item.flag,item.color);
  lettering(ctx,item.label,item.flag.x+item.flag.w/2,item.flag.y+item.flag.h/2,9*s,INK,'center');
}
function pads(ctx,layout,scene,full){
  const s=layout.scale,entered=new Set(scene.entered??[]),specials=[];
  for(const pad of Object.values(layout.pads)){
    const [x,y]=pad.center,seen=entered.has(pad.id);
    const bounds=full?rect(x-10*s,y-8*s,20*s,16*s):rect(x-4*s,y-3*s,8*s,6*s);
    plate(ctx,bounds,seen?GOLD:INK);
    ctx.strokeStyle=seen?CREAM:'#71664e';ctx.lineWidth=Math.max(1,s);ctx.strokeRect(bounds.x,bounds.y,bounds.w,bounds.h);
    lettering(ctx,pad.rank,x,y,full?10*s:5*s,seen?INK:CREAM,'center');
    // F27: no metadata is read until this exact pad has been entered.
    if(seen){
      const glyph={encounter:'×',hazard:'!',flavor:'·',buff:'+',miniboss:'^'}[pad.room.type]??'·';
      lettering(ctx,glyph,x-(full?13:6)*s,y,full?8*s:6*s,CREAM,'center');
      if(pad.room.special)specials.push(pad);
    }
  }
  return specials;
}
function mechanisms(ctx,layout,scene){
  const s=layout.scale;
  layout.veins.forEach((v,i)=>{
    const a=v.points[0],b=v.points[1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
    const p=a.map((n,k)=>n+(b[k]-n)*.47);
    // Twin band collars and a row of rivets on every chamber seam.
    for(const offset of [-3,3])line(ctx,[[p[0]+dx/len*offset*s+nx*15*s,p[1]+dy/len*offset*s+ny*15*s],
      [p[0]+dx/len*offset*s-nx*15*s,p[1]+dy/len*offset*s-ny*15*s]],'#b9a985',s);
    for(let k=-2;k<=2;k++){ctx.fillStyle=CREAM;ctx.fillRect(Math.round(p[0]+nx*k*6*s),Math.round(p[1]+ny*k*6*s),2*s,2*s);}
    if(layout.floor==='digestion'&&i%2===0){
      // Square gear-driven piston housings, with moving rack teeth.
      ctx.strokeStyle=GOLD;ctx.lineWidth=s;ctx.strokeRect(p[0]-10*s,p[1]-10*s,20*s,20*s);
      const u=Math.round((.5+.5*Math.sin((scene.t??0)*8+i))*7)*s;
      line(ctx,[[p[0]-7*s+u,p[1]-7*s],[p[0]-7*s+u,p[1]+7*s]],CREAM,3*s);
      for(let k=-8;k<=8;k+=4)line(ctx,[[p[0]+k*s,p[1]-13*s],[p[0]+k*s,p[1]-10*s]],GOLD,s);
    }
    if(layout.floor==='brood'&&i%3===0){
      ctx.strokeStyle=CREAM;ctx.lineWidth=s;ctx.beginPath();ctx.ellipse(...p,10*s,17*s,0,0,Math.PI*2);ctx.stroke();
      for(const sign of [-1,1])line(ctx,[[p[0]+sign*13*s,p[1]-16*s],[p[0]+sign*17*s,p[1]-16*s],[p[0]+sign*17*s,p[1]+16*s],[p[0]+sign*13*s,p[1]+16*s]],GOLD,2*s);
    }
    if(layout.floor==='silk'&&i%3===0){
      ctx.strokeStyle=CREAM;ctx.lineWidth=s;ctx.strokeRect(p[0]-12*s,p[1]-8*s,24*s,16*s);
      for(let k=-8;k<=8;k+=4)line(ctx,[[p[0]+k*s,p[1]-8*s],[p[0]+k*s,p[1]+8*s]],GOLD,s);
      line(ctx,[[p[0]+12*s,p[1]-5*s],[p[0]+20*s,p[1]],[p[0]+12*s,p[1]+5*s]],CREAM,2*s);
      for(let k=-1;k<=1;k++){ctx.fillStyle=GOLD;ctx.fillRect(p[0]+19*s,p[1]+k*3*s,2*s,s);}
    }
  });
  Object.values(layout.pads).filter((_,i)=>i%4===0).forEach(p=>{
    const [x,y]=p.center,b=rect(x-10*s,y+15*s,20*s,9*s);plate(ctx,b);
    ctx.strokeStyle='#897c5e';ctx.lineWidth=s;ctx.strokeRect(b.x,b.y,b.w,b.h);
    for(const dx of [2,16])for(const dy of [2,6]){ctx.fillStyle=GOLD;ctx.fillRect(b.x+dx*s,b.y+dy*s,s,s);}
  });
}
export function drawFloor(ctx,layout,scene = {}){
  const s=layout.scale;
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.lineJoin='miter';ctx.lineCap='square';
  engraving(ctx,layout,scene);mechanisms(ctx,layout,scene);
  for(const shaft of layout.shafts){
    line(ctx,shaft.points,'#897c5e',3*s);
    const [x,y]=shaft.center,pulse=1+.07*clamp(scene.pulse??0,0,1);
    for(let r=4;r>=0;r--){
      ctx.fillStyle=r===0?'#030705':r%2?INK:'#897c5e';ctx.beginPath();
      ctx.ellipse(x,y,(15+r*3)*s*pulse,(4+r*1.7)*s*pulse,0,0,Math.PI*2);ctx.fill();
    }
    if(!scene.artOnly){const b=shaft.labelBox;plate(ctx,b);lettering(ctx,shaft.label,b.x+b.w/2,b.y+b.h/2,10*s,GOLD,'center');}
  }
  const specials=pads(ctx,layout,scene,true);
  for(const item of clusterBoxes(layout,scene))cluster(ctx,item,scene,s);
  if(!scene.artOnly){const b=layout.boxes.title;lettering(ctx,layout.title.heading,b.x,b.y+12*s,22*s,GOLD,'left',true);
    lettering(ctx,layout.title.subheading,b.x,b.y+33*s,9*s);}
  // The caller may ask for a card, but cannot reveal an unentered room.
  const special=scene.specialCard===null?null:specials.find(p=>scene.specialCard===undefined || scene.specialCard===p.id || scene.specialCard===p.room.place);
  if(special&&!scene.artOnly){
    const b=layout.boxes.nameCard;plate(ctx,b);ctx.strokeStyle=GOLD;ctx.lineWidth=s;ctx.strokeRect(b.x,b.y,b.w,b.h);
    lettering(ctx,`+ ${special.room.place.toUpperCase()}`,b.x+b.w/2,b.y+b.h/2,11*s,GOLD,'center',true);
  }
  ctx.restore();
}

const stackArtCache=new WeakMap();
function stackEngraving(layout,plate){
  let cache=stackArtCache.get(layout);if(!cache){cache={};stackArtCache.set(layout,cache);}
  if(!cache[plate.id]){
    const xs=plate.polygon.map(p=>p[0]),ys=plate.polygon.map(p=>p[1]);
    const x=Math.ceil(Math.min(...xs))+1,y=Math.ceil(Math.min(...ys))+1;
    const veins=layout.veins.filter(v=>v.from.startsWith(`${plate.id}:`));
    cache[plate.id]={floor:plate.id,width:layout.width,height:layout.height,scale:layout.scale*.4,veins,
      rasterBox:rect(x,y,Math.floor(Math.max(...xs))-x,Math.floor(Math.max(...ys))-y),
      glowSources:veins.map(v=>({a:v.points[0],b:v.points[1],ra:3*layout.scale,rb:3*layout.scale,main:true,strength:1})),
      decorativeVessels:plate.decorativeVessels};
  }
  return cache[plate.id];
}
export function drawHollow(ctx,layout,scene = {}){
  const {width,height,scale:s}=layout;
  const label=(spec,color,value=spec.value)=>lettering(ctx,value,...spec.anchor,spec.fontSize,color,spec.align);
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.lineJoin='miter';ctx.lineCap='square';plate(ctx,rect(0,0,width,height));
  for(const p of layout.plates){
    polygon(ctx,p.polygon);ctx.fillStyle='#191e17';ctx.fill();
    polygon(ctx,p.side);ctx.fillStyle='#29291e';ctx.fill();
    line(ctx,[...p.polygon,p.polygon[0]],'#897c5e',Math.max(1,s));
    engraving(ctx,stackEngraving(layout,p),scene);
    line(ctx,[...p.polygon,p.polygon[0]],'#897c5e',Math.max(1,s));
  }
  for(const v of layout.veins){
    const floor=v.from.split(':')[0],pulse=clamp(scene.pulse??0,0,1);
    ctx.globalAlpha=.16+.35*pulse;line(ctx,v.points,GLOW[floor],5*s);ctx.globalAlpha=1;
    line(ctx,v.points,'#897c5e',3*s);line(ctx,v.points,CREAM,s);
    const [a,b]=v.points;
    for(let k=1;k<5;k++){
      const x=a[0]+(b[0]-a[0])*k/5,y=a[1]+(b[1]-a[1])*k/5;
      line(ctx,[[x-s,y-2*s],[x+s,y+2*s]],'#494534',s);
    }
  }
  for(const shaft of layout.shafts){line(ctx,shaft.points,INK,5*s);line(ctx,shaft.points,'#897c5e',3*s);line(ctx,shaft.points,'#3b4b40',s);}
  const specials=pads(ctx,layout,scene,false);
  for(const item of clusterBoxes(layout,scene))cluster(ctx,item,scene,s*.35);
  if(specials.length&&!scene.artOnly){const value=specials.map(p=>p.room.place).join(' · '),spec=layout.text.footer;
    plate(ctx,rect(120*s,155*s,180*s,9*s));label({...spec,fontSize:Math.min(spec.fontSize,spec.maxWidth/(.62*value.length))},GOLD,value);}
  ctx.fillStyle=`rgba(18,29,25,${clamp(scene.dim??0,0,1)})`;ctx.fillRect(0,0,width,height);
  if(!scene.artOnly)for(const p of layout.plates)label(p.label,CREAM);
  polygon(ctx,layout.ledge.polygon);ctx.fillStyle='#1c2925';ctx.fill();line(ctx,[...layout.ledge.polygon,layout.ledge.polygon[0]],'#897c5e',s);
  if(!scene.artOnly)label(layout.ledge.label,GOLD);
  const ledgeScene={...scene,clusterScale:.3,clusters:(scene.ledge??[]).map((p,i)=>({...p,point:layout.ledge.markers[i]}))};
  for(const item of clusterBoxes(layout,ledgeScene))cluster(ctx,item,scene,s*.3);
  if(!scene.artOnly&&scene.showTitle!==false)label(layout.text.title,GOLD);
  if(!scene.artOnly&&scene.countdown!==null&&scene.countdown!==undefined)label(layout.text.countdown,GOLD,scene.countdown);
  if(scene.hint&&!scene.artOnly)wrapHint(scene.hint,14).forEach((value,i)=>{
    const first=layout.text.hintLines[0];label({...first,anchor:[first.anchor[0],first.anchor[1]+i*8*s]},CREAM,value);
  });
  ctx.restore();
}
