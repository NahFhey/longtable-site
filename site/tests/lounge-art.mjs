import { LOUNGE_FURNITURE } from '../lounge-layout.mjs';
// Independent reconstruction of the rectangles painted by lounge.mjs. Never use routing footprints.
export function art(g, layout) {
  const ox=layout.lounge.x, oy=layout.lounge.y, out=[];
  g.ops.forEach((o,i)=>{
    if (o.flat) return;
    const add=(x,y,w,h,kind)=>out.push({x:ox+x,y:oy+y,w,h,owner:i,kind:kind??o.kind??o.op,op:o});
    switch(o.op){
      case 'furn': { const f=LOUNGE_FURNITURE[o.kind];
        if (f.rows) add(o.x,o.y,2,f.rows.order.length/16);
        else { let xs=f.parts.map(p=>p[2]), ys=f.parts.map(p=>p[3]);
          add(o.x+Math.min(...xs),o.y+Math.min(...ys),Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1);} break; }
      case 'cards': add(o.cx-1,o.cy-.5,2,1,'cardTable'); break;
      case 'tile': add(o.x,o.y,o.s??1,o.s??1,'tile'); break;
      case 'hearth': add(o.x,o.y,o.s,2*o.s,'hearth'); break;
      case 'chimney': add(o.x,o.y,o.w,o.h,'chimney'); break;
      case 'mantel': add(o.x,o.y,o.w,1,'mantel'); break;
      case 'wainscot': add(o.x,o.y,o.w,o.h,'wainscot'); break;
    }
  });
  return out;
}
