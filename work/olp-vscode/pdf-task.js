'use strict';
// PDF.js must not select its browser backend in an Electron extension host.
const { fork } = require('node:child_process');
const isolated = Boolean(process.versions.electron) && process.env.OLP_PDF_WORKER !== '1';
function run(operation, args) {
  return new Promise((resolve,reject)=>{
    let child,done=false,timer;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);if(error){try{child?.kill();}catch{}reject(error);}else resolve(result);};
    try{child=fork(__filename,[],{execArgv:[],windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',OLP_PDF_WORKER:'1'}});}catch(error){finish(error);return;}
    timer=setTimeout(()=>{child.kill();finish(new Error('Chuẩn bị PDF quá 120 giây.'));},120000);
    child.once('error',error=>finish(error));
    child.once('exit',code=>{if(!done)finish(new Error('Tiến trình PDF kết thúc sớm (mã '+code+').'));});
    child.once('message',message=>{if(message.error){const error=new Error(message.error.message);error.code=message.error.code;finish(error);}else finish(undefined,message.result);});
    child.send({operation,args},error=>{if(error)finish(error);});
  });
}
if(require.main===module&&process.send)process.once('message',async({operation,args})=>{
  let message;
  try{
    let result;
    if(operation==='extract')result=await require('./pdf-map').extract(args.file);
    else if(operation==='prepare'){await require('./pdf-map').prepare(args.kitRoot,args.kit);result=args.kit;}
    else if(operation==='render')result=await require('./pdf-reader').renderDirect(args.file,args.problem,args.problems);
    else throw new Error('Unknown PDF operation');
    message={result};
  }catch(error){message={error:{message:error.message,code:error.code??error.cause?.code}};}
  process.send(message,()=>{if(process.connected)process.disconnect();});
});
module.exports={isolated,run};
