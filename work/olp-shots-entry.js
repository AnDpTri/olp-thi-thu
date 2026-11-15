'use strict';
const fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),command=(n,...a)=>vscode.commands.executeCommand('olp.'+n,...a),scene=process.env.OLP_SHOTS_SCENE||'main';
async function request(root,name,sequence,action,expectText){fs.writeFileSync(path.join(root,'stage.json'),JSON.stringify({name,sequence,action,expectText}));const end=Date.now()+90000;while(Date.now()<end){if(fs.existsSync(path.join(root,'ack-'+sequence)))return;await sleep(200);}throw Error('Screenshot acknowledgement timeout: '+name);}
const body=`#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    long long sum = 0;
    for (int i = 0; i < n; i++) {
        int x;
        cin >> x;
        sum += x;
    }
    cout << sum << "\\n";
    return 0;
}
`;
async function seed(context,root){
 const names=['Đăng ký học phần','Đường đi','Ba số nguyên tố','Đố vui'];
 const kit={id:'shots-v7',title:'Olympic Sinh viên 2024 · Không chuyên',problems:names.map((name,i)=>({key:String.fromCharCode(65+i),name:'Olympic Sinh Viên 2024 - Không chuyên - '+name,source:String.fromCharCode(65+i)+'.cpp',pdf:i!==3,tests:1,templated:true}))};
 for(const p of kit.problems){const dir=path.join(root,'OLP-'+kit.id,p.key);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,p.source),'// Bài '+p.key+': '+names[p.key.charCodeAt(0)-65]+'\n'+(p.key==='B'?body.replace('cout << sum <<','cout << sum + 1 <<'):body));for(const[name,text]of Object.entries({'input.txt':'5\n1 2 3 4 5\n','output.txt':'','mau-1.in':'5\n1 2 3 4 5\n','mau-1.out':'15\n'}))fs.writeFileSync(path.join(dir,name),text);if(p.pdf)fs.copyFileSync(path.join(__dirname,'../outputs/De-OLP-2024-Khong-chuyen.pdf'),path.join(dir,'De-bai.pdf'));}
 await require('./olp-vscode/pdf-map').prepare(path.join(root,'OLP-'+kit.id),kit);
 // Intentional unknown-mapping scene: same combined file displayed as documented fallback.
 kit.problems[2].pages={start:1,end:7,confidence:'fallback'};
 const remaining=scene==='urgent'?4:118,start=Date.now()-(180-remaining)*60000,at=m=>start+m*60000;
 const events=[{type:'start',at:start},{type:'focus',at:at(0),problem:'A'},{type:'phase',at:at(0),problem:'A',phase:'coding'},{type:'sent',at:at(31),problem:'A',submission:'4101',url:'https://oj.vnoi.info/submission/4101',auto:true},{type:'verdict',at:at(32),problem:'A',submission:'4101',text:'AC',auto:true},{type:'sent',at:at(50),problem:'B',submission:'4102',url:'https://oj.vnoi.info/submission/4102',auto:true},{type:'verdict',at:at(51),problem:'B',submission:'4102',text:'WA 40/100',auto:true}];
 await context.workspaceState.update('olp.practice.v1',{kit,sessions:[{id:'shots-session',kit,start,deadline:start+180*60000,events}],runs:{}});
}
async function main(root,api){let n=0;const shot=async(name,action)=>{await sleep(1400);await request(root,name,++n,action);};
 await command('source','A');await vscode.commands.executeCommand('olp.session.focus');
 if(scene==='urgent'){await command('source','B');await sleep(1500);await shot('last-five-minutes');return;}
 await command('run');await shot('working-code-input-output');
 await command('statement');await shot('split-statement-A-pages-3-4');await command('statement');
 await command('source','D');await shot('working-without-pdf');
 await command('source','B');await command('runSamples');await api.expand('B');await shot('failing-sample-tree');
 await command('diffSample','B',1);await shot('failing-sample-diff');await command('source','A');await command('runSamples');await api.expand('A');await vscode.commands.executeCommand('notifications.clearAll');await shot('submissions-scoreboard-milestones');
 await command('source','C');await command('statement');await shot('combined-pdf-fallback-all-pages');await command('statement');
 await command('export');await shot('export-notification');
}
async function quick(context,activate,root){await vscode.workspace.getConfiguration('window').update('dialogStyle','custom',vscode.ConfigurationTarget.Global);let seq=0;const pending=command('login');await sleep(700);await request(root,'quick-cookie-paste-box',++seq,'cookie');await pending;
 const {createMock,good}=require('./mock-vnoj'),mock=await createMock('https://oj.vnoi.info').start(),real=globalThis.fetch;mock.control.combined=true;mock.control.htmlSamples=true;
 globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));return real(u.origin==='https://oj.vnoi.info'?mock.origin+u.pathname+u.search:u,init);};
 try{await context.secrets.store('olp.vnoj.sessionid',good);await context.globalState.update('olp.recentLinks',['https://oj.vnoi.info/contest/olp24']);await vscode.env.clipboard.writeText('https://oj.vnoi.info/contest/olp24');const pendingQuick=command('quick');await request(root,'quick-link-selection',++seq,'choose','Link \u0111ang sao ch\u00e9p');
  const readyEnd=Date.now()+90000;while(!context.workspaceState.get('olp.practice.v1')?.kit&&Date.now()<readyEnd)await sleep(200);if(!context.workspaceState.get('olp.practice.v1')?.kit)throw Error('Quick import did not become ready');await request(root,'quick-ready-code-input-output',++seq,'cancel-modal','Bắt đầu 180 phút ngay?');await pendingQuick;await vscode.commands.executeCommand('notifications.clearAll');await request(root,'quick-ready-working-view',++seq);
 }finally{globalThis.fetch=real;mock.stop();}
}
exports.boot=async function(context,activate){const root=vscode.workspace.workspaceFolders[0].uri.fsPath;if(scene!=='quick')await seed(context,root);const api=activate(context);setImmediate(async()=>{try{if(scene==='quick')await quick(context,activate,root);else await main(root,api);fs.writeFileSync(path.join(root,'shots-done'),'ok');}catch(error){fs.writeFileSync(path.join(root,'shots-error.txt'),error.stack);fs.writeFileSync(path.join(root,'shots-done'),'error');}});return api;};
