// The watch's map resource: the land atlas and relief grid packed losslessly
// (tools/relief-pack.mjs), cropped to the latitudes the watch's views can
// show (tests/map-pack.test.mjs checks that they stay inside), so it fits
// the app store's 256 KB of resources with room for type.
//
//   node tools/generate-map-pack.mjs [--world]   (--world: all latitudes, 1 MB side-load limit)
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {encodePack} from './relief-pack.mjs';

// 79°N to 66°S: GPS charts reach 77.5°N and 64.4°S; the world band 72°N to 60°S.
export const MAP_ROWS={first:(90-79)*4,rows:(79+66)*4,strip:32};
if(process.argv[1]===new URL(import.meta.url).pathname){
  const relief=new Uint8Array(readFileSync(new URL('../public/relief.bin',import.meta.url)));
  const land=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url)));
  const rows=process.argv.includes('--world')?{first:0,rows:720,strip:32}:MAP_ROWS,pack=encodePack(relief,land,rows);
  mkdirSync(new URL('../native/resources',import.meta.url),{recursive:true});
  writeFileSync(new URL('../native/resources/map.pack',import.meta.url),pack);
  console.log(`native/resources/map.pack: ${pack.length} bytes, latitudes ${90-rows.first/4}° to ${90-(rows.first+rows.rows)/4}°`);
}
