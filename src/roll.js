// Rolling Fuller: an endless icosahedral tiling that follows the route.
// A fixed Dymaxion net must cut the Earth somewhere, and earlier studies
// had routes break at those cuts. Here the icosahedron is rolled across the
// plane along the route instead, printing each face as it touches down, so
// the route never meets a cut. The rest of the view is filled outward from
// that strip on the same triangular lattice; where two printings disagree
// the edge would be a cut, so the view keeps only a floating net around
// the route: no cuts at all. On the Gray–Fuller faces great circles
// are nearly straight, so a satellite's hour unrolls into a near-straight
// line. The camera turns the plane so time always runs left to right.
import {sampleTrack,MINUTE} from './ephemeris.js';
import {F,EDGES,NEIGHBORS,TEMPLATE,BASES,faceOf,forwardFace,inverseFace,flatPoint,barycentric} from './fuller.js';
import {across} from './unfold.js';
import {dot,lonLat,direction} from './geometry.js';
import {hypot} from './fmath.js';

export const W=200,H=228;
const centre=tri=>[0,1].map(k=>tri.reduce((s,p)=>s+p[k]/3,0));
const key=tri=>centre(tri).map(v=>Math.round(v*1e6)).join(',');

// Roll from one face to the face holding dir, crossing one edge at a time.
function rollTo(tile,dir){
  for(let guard=0;guard<6&&tile.face!==faceOf(dir);guard++){
    const target=faceOf(dir),direct=NEIGHBORS[tile.face].indexOf(target);
    const edge=direct>=0?direct:[0,1,2].reduce((best,e)=>dot(BASES[NEIGHBORS[tile.face][e]].n,dir)>dot(BASES[NEIGHBORS[tile.face][best]].n,dir)?e:best,0);
    const next=across(tile,edge);tile={face:next.face,tri:next.tri,key:next.key};
  }
  return tile;
}

export function rollCamera(body,start,{span=180,trackY=140,rings=2,day=null}={}){
  // A satellite's strip stays under one lap (about 92 min for the ISS), so
  // the route never rolls back over a face it has already printed. With
  // day={start,end}, the strip is the whole local day instead, midnight to
  // midnight, for the Sun and Moon, which take a day to circle the Earth.
  const world=body!=='sun'&&body!=='moon',step=day?5*MINUTE:world?MINUTE/4:MINUTE,lead=(world?10:40)*MINUTE;
  const from=day?day.start:start-lead,to=day?day.end:start+60*MINUTE+lead,samples=sampleTrack(body,from,to,step);
  // Roll along the route. Cells are keyed by lattice position; the route's
  // own printing always wins its cells.
  const cells=new Map(),path=[];let tile={face:faceOf(samples[0].dir),tri:TEMPLATE.map(p=>[...p])};tile.key=key(tile.tri);
  const flat=samples.map(s=>{
    tile=rollTo(tile,s.dir);
    if(!cells.has(tile.key)){const t={...tile,route:true};cells.set(tile.key,t);path.push(t);}
    return {...s,tile:cells.get(tile.key),xy:flatPoint(forwardFace(tile.face,s.dir),tile.tri),hour:day?true:s.epoch>=start&&s.epoch<=start+60*MINUTE};
  });
  const i0=flat.findIndex(p=>p.epoch===start),i1=flat.findIndex(p=>p.epoch===start+60*MINUTE),a=flat[day?0:i0].xy,b=flat[day?flat.length-1:i1].xy;
  // Similarity transform: this hour's stations on a horizontal line, SPAN
  // pixels apart, time running left to right.
  const len=hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len;let scale=span/len,mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  if(day){
    // A path far from the equator unrolls as an arc, as a cone flattens into
    // a fan. Fit the whole day's arc, not just its chord, and centre it.
    const rs=flat.map(p=>p.xy[0]*ux+p.xy[1]*uy),rt=flat.map(p=>-p.xy[0]*uy+p.xy[1]*ux);
    const s0=Math.min(...rs),s1=Math.max(...rs),t0=Math.min(...rt),t1=Math.max(...rt);
    scale=Math.min(span/(s1-s0),110/Math.max(1e-9,t1-t0));
    const sc=(s0+s1)/2,tc=(t0+t1)/2;mid=[sc*ux-tc*uy,sc*uy+tc*ux];
  }
  const toScreenXY=p=>{const dx=p[0]-mid[0],dy=p[1]-mid[1];return {x:W/2+(dx*ux+dy*uy)*scale,y:trackY-(-dx*uy+dy*ux)*scale};};
  const toPlane=(x,y)=>{const s=(x-W/2)/scale,t=(trackY-y)/scale;return [mid[0]+s*ux-t*uy,mid[1]+s*uy+t*ux];};
  // A floating net: the faces the route rolls over, plus every face that
  // truly touches them across an edge. A lattice cell that two faces would
  // claim is left empty, so the net holds no cuts at all; the rest of the
  // view is plain paper.
  const onScreen=tri=>{const q=tri.map(toScreenXY);return Math.max(...q.map(p=>p.x))>-2&&Math.min(...q.map(p=>p.x))<W+2&&Math.max(...q.map(p=>p.y))>-2&&Math.min(...q.map(p=>p.y))<H+2;};
  // A true net: every face at most once, and a face joins only where it
  // truly meets every face already printed beside it, so neighbours are
  // always consecutive on the globe. It grows ring by ring from the route,
  // nearest the middle of the hour first.
  const printed=new Set(path.map(t=>t.face));
  let frontier=path;
  for(let ring=0;ring<rings;ring++){
    const candidates=[];
    for(const t of frontier)for(let e=0;e<3;e++){const n=across(t,e);if(!cells.has(n.key)&&!printed.has(n.face)&&onScreen(n.tri))candidates.push(n);}
    const mid=toScreenXY([(a[0]+b[0])/2,(a[1]+b[1])/2]),dist=n=>{const c=toScreenXY(centre(n.tri));return hypot(c.x-mid.x,c.y-mid.y);};
    candidates.sort((p,q)=>dist(p)-dist(q));
    const added=[];
    for(const n of candidates){
      if(cells.has(n.key)||printed.has(n.face))continue;
      const t={face:n.face,tri:n.tri,key:n.key,route:false};
      const fits=[0,1,2].every(e=>{const m=across(t,e),there=cells.get(m.key);return !there||there.face===m.face;});
      if(!fits)continue;
      cells.set(n.key,t);printed.add(n.face);added.push(t);
    }
    frontier=added;
  }
  const tiles=[...cells.values()].filter(t=>onScreen(t.tri));
  for(const t of tiles){
    t.screen=t.tri.map(toScreenXY);
    const xs=t.screen.map(p=>p.x),ys=t.screen.map(p=>p.y);t.box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
    // Inside the net every shared edge is a true fold of the icosahedron;
    // an edge with nothing printed beyond it is the net's outline.
    t.edges=EDGES.map((_,e)=>{const n=across(t,e),there=cells.get(n.key);return {a:t.screen[EDGES[e][0]],b:t.screen[EDGES[e][1]],cut:!!there&&there.face!==n.face,outline:!there};});
  }
  const locate=(x,y)=>{
    const p=toPlane(x,y);
    for(const t of tiles){if(x<t.box[0]-1||x>t.box[2]+1||y<t.box[1]-1||y>t.box[3]+1)continue;const w=barycentric(p,t.tri);if(w.every(v=>v>=-1e-9))return {tile:t,weights:w};}
    return null;
  };
  const toGround=(x,y)=>{const hit=locate(x,y);if(!hit)return {lat:NaN,lon:NaN};return lonLat(inverseFace(hit.tile.face,hit.weights));};
  // A direction appears once per printing of its face; show the copy
  // nearest the route's middle.
  const project=(lat,lon)=>{
    const dir=direction(lat,lon),face=faceOf(dir),w=forwardFace(face,dir);let best=null;
    for(const t of tiles)if(t.face===face){const q=toScreenXY(flatPoint(w,t.tri)),d=hypot(q.x-W/2,q.y-trackY);if(!best||d<best.d)best={...q,d};}
    return best||{x:-999,y:-999};
  };
  const track=flat.map(p=>({...p,...toScreenXY(p.xy)}));
  // The tile holding a screen point (its index in tiles), or -1; and the
  // plane under a screen point (fuller-ground.js places the faces' grids).
  const tileAt=(x,y)=>{const hit=locate(x,y);return hit?tiles.indexOf(hit.tile):-1;};
  return {body,start,world:false,fuller:true,tileAt,toPlane,wide:world||!!day,outside:(x,y)=>!locate(x,y),track,scale,band:{top:0,bottom:H},tiles,toScreen:project,toGround,project,
    stations:[track[i0],track[i1]],day:day?{...day,hours:track.filter(p=>(p.epoch-day.start)%(60*MINUTE)===0)}:null,key:`fuller/${body}/${day?day.start:start}/${span}`};
}
