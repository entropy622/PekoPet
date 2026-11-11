import {Buffer} from 'node:buffer';
/** JSON framing keeps Electron and the bundled Node independent of V8 serializer versions. */
export function encodeWire(value:any):any{
  if(value===undefined)return {t:'undefined'};
  if(value===null||['string','number','boolean'].includes(typeof value))return value;
  if(value instanceof Uint8Array)return {t:'bytes',v:Buffer.from(value).toString('base64')};
  if(value instanceof ArrayBuffer)return {t:'bytes',v:Buffer.from(value).toString('base64')};
  if(Array.isArray(value))return {t:'array',v:value.map(encodeWire)};
  if(typeof value==='object')return {t:'record',v:Object.entries(value).map(([key,item])=>[key,encodeWire(item)])};
  throw new Error('IPC 无法传输此值');
}
export function decodeWire(value:any):any{
  if(value===null||typeof value!=='object')return value;
  if(value.t==='undefined')return undefined;
  if(value.t==='bytes')return new Uint8Array(Buffer.from(value.v,'base64'));
  if(value.t==='array')return value.v.map(decodeWire);
  if(value.t==='record')return Object.fromEntries(value.v.map(([key,item]:[string,unknown])=>[key,decodeWire(item)]));
  throw new Error('IPC 帧格式无效');
}
export const encodePacket=(value:any)=>({version:1,payload:encodeWire(value)});
export function decodePacket(packet:any){if(packet?.version!==1)throw new Error('IPC 协议版本不匹配');return decodeWire(packet.payload);}
