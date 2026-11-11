import {Buffer} from 'node:buffer';

/** Windows ICO containing one 256px PNG; portraits remain in the user's cache. */
export function portraitIcon(png:Uint8Array){
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  return Buffer.concat([header,png]);
}
