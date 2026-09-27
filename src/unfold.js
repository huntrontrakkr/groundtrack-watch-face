import {F,EDGES,NEIGHBORS,TEMPLATE,faceOf,forwardFace,flatPoint,barycentric,inverseFace} from './fuller.js';
const key=p=>p.map(v=>Math.round(v*1e6)).join(',');
const center=tri=>[0,1].map(k=>tri.reduce((s,p)=>s+p[k]/3,0));
export function across(tile,edge){
  const [a,b]=EDGES[edge],other=[0,1,2].find(i=>i!==a&&i!==b),p=tile.tri[a],q=tile.tri[b],r=tile.tri[other];
  const dx=q[0]-p[0],dy=q[1]-p[1],t=((r[0]-p[0])*dx+(r[1]-p[1])*dy)/(dx*dx+dy*dy);
  const reflected=[2*(p[0]+t*dx)-r[0],2*(p[1]+t*dy)-r[1]],face=NEIGHBORS[tile.face][edge];
  const tri=F[face].map(v=>v===F[tile.face][a]?p:v===F[tile.face][b]?q:reflected);
  return {face,tri,key:key(center(tri))};
}
function matches(a,b){return a.face===b.face&&a.tri.every((p,i)=>key(p)===key(b.tri[i]));}

// Five icosahedron faces meet at a vertex, six equilateral tiles in a plane.
// A globally seamless tessellation is impossible. Fill from a root, preserve
// real neighbor joins where possible, and record EVERY incompatible edge.
export function unfold(rootFace,rings=7){
  if(!Number.isInteger(rings)||rings<1||rings>14)throw new RangeError('Atlas radius must be 1–14 rings');
  const root={face:rootFace,tri:TEMPLATE.map(p=>[...p]),key:'0,0',depth:0},tiles=[root],cells=new Map([[root.key,root]]);
  for(let i=0;i<tiles.length;i++){
    const tile=tiles[i];if(tile.depth>=rings)continue;
    for(let edge=0;edge<3;edge++){
      const next=across(tile,edge);if(cells.has(next.key))continue;
      next.depth=tile.depth+1;cells.set(next.key,next);tiles.push(next);
    }
  }
  for(const tile of tiles)tile.links=EDGES.map((_,edge)=>{
    const expected=across(tile,edge),neighbor=cells.get(expected.key);
    return {tile:neighbor,seam:!!neighbor&&!matches(neighbor,expected),edge};
  });
  const byFace=F.map((_,face)=>tiles.filter(t=>t.face===face));
  return {tiles,root,byFace,cells};
}
export function copies(atlas,dir){
  const face=faceOf(dir),weights=forwardFace(face,dir);
  return atlas.byFace[face].map(tile=>({tile,xy:flatPoint(weights,tile.tri)}));
}
export function joined(a,b){return a===b||a.links.some(link=>link.tile===b&&!link.seam);}
export function closestCopy(atlas,dir,reference=[0,0],previousTile=null){
  const choices=copies(atlas,dir);
  choices.sort((a,b)=>{
    const score=p=>Math.hypot(p.xy[0]-reference[0],p.xy[1]-reference[1])+(previousTile&&!joined(previousTile,p.tile)?2:0);
    return score(a)-score(b);
  });
  return choices[0];
}
export function mapTrack(atlas,track,anchorIndex=Math.floor(track.length/2)){
  const out=new Array(track.length);
  const put=(i,previous)=>{
    const p=closestCopy(atlas,track[i].dir,previous?.xy||[0,0],previous?.tile);
    out[i]={...track[i],...p};return out[i];
  };
  put(anchorIndex);
  for(let i=anchorIndex+1;i<track.length;i++)put(i,out[i-1]);
  for(let i=anchorIndex-1;i>=0;i--)put(i,out[i+1]);
  return out.map((p,i)=>({...p,cut:i>0&&!joined(out[i-1].tile,p.tile)}));
}
export function locate(atlas,p){
  for(const tile of atlas.tiles){
    const weights=barycentric(p,tile.tri);
    if(weights.every(w=>w>=-1e-8))return {tile,weights,dir:inverseFace(tile.face,weights)};
  }
  return null;
}
