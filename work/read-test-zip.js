'use strict';
const zlib=require('node:zlib');
module.exports=function readZip(bytes){const files=new Map();let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+n).toString('utf8'),start=at+30+n+extra,data=bytes.subarray(start,start+size);files.set(name,method===8?zlib.inflateRawSync(data):Buffer.from(data));at=start+size;}return files;};
