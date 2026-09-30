// Quarter-degree relief from NOAA ETOPO1 and USGS GMTED2010 (see
// tools/generate-relief.mjs). It lines up cell for cell with land.bin.
import {wrap} from './geometry.js';

export const RELIEF_BYTES=1440*720;
// Square-root codes: 0..63 is depth to 11,000 m, 64..255 height to 8,850 m.
export const reliefMeters=code=>code>=64?((code-64)/191)**2*8850:-(((63-code)/63)**2)*11000;
export function decodeRelief(bytes){
  if(bytes.length!==RELIEF_BYTES)throw new Error('Incomplete relief data');
  const table=Float32Array.from({length:256},(_,c)=>reliefMeters(c));
  return Float32Array.from(bytes,c=>table[c]);
}
// Bilinear height in meters between cell centres.
export function reliefAt(meters,lat,lon){
  const u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
  const at=(x,y)=>meters[Math.max(0,Math.min(719,y))*1440+((x%1440)+1440)%1440];
  return (at(i,j)*(1-fu)+at(i+1,j)*fu)*(1-fv)+(at(i,j+1)*(1-fu)+at(i+1,j+1)*fu)*fv;
}
