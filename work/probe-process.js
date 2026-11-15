const {spawn,spawnSync}=require('node:child_process');
console.log('sync',spawnSync('g++',['--version'],{stdio:'inherit',windowsHide:true}));
const c=spawn('g++',['--version'],{windowsHide:true}); c.on('error',e=>console.log('async',e.code,e.message)); c.stdout.on('data',x=>console.log(x.toString()));
