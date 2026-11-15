'use strict';
const vnoj = require('./vnoj');
const decode = text => text.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(entity,s)=>{if(s[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[s.toLowerCase()];const n=s[1].toLowerCase()==='x'?parseInt(s.slice(2),16):Number(s.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):entity;}).replace(/\r\n/g,'\n');
function htmlSamples(html) {
  const blocks=[];
  const pattern=/(?:<h[1-6]\b[^>]*>\s*(?:(?:Sample|Ví dụ|Mẫu)\s+)?(Input|Output|Dữ liệu vào|Kết quả)(?:\s*(?:mẫu|sample|#?\d+))*\s*:?\s*<\/h[1-6]>|<div\b[^>]*class=["'][^"']*sample-(input|output)[^"']*["'][^>]*>)(?:(?!<h[1-6]\b)[\s\S])*?<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
  for(const m of html.matchAll(pattern)) blocks.push({input:/input|vào/i.test(m[1]??m[2]),text:decode(m[3]).replace(/^\n/,'')});
  const samples=[];
  for(let i=0;i+1<blocks.length;i++)if(blocks[i].input&&!blocks[i+1].input){samples.push({input:blocks[i].text,output:blocks[++i].text});}
  return samples.slice(0,50);
}
function pdfSamples(text) {
  // Deliberately conservative: standalone labels, numeric-only bodies, explicit end of example.
  const samples=[];
  for(const m of text.matchAll(/(?:^|\n)Input\s*\n([\d\s.+-]+?)\nOutput\s*\n([\d\s.+-]+?)(?=\n(?:Giải thích|Explanation|Ví dụ|Example|\[Trang)|$)/g)) {
    if(m[1].trim()&&m[2].trim())samples.push({input:m[1].trim()+'\n',output:m[2].trim()+'\n'});
  }
  return samples;
}
async function bytes(url,maximum,{sid,fetcher=globalThis.fetch}={}) {
  try {const data=await vnoj.fetchBytes(url,maximum,fetcher);if(/<form[^>]*[\s\S]*?name=["']password["']/i.test(data.toString('utf8')))throw Error('Login required');return data;}
  catch(error){if(!sid)throw error;return vnoj.fetchBytes(url,maximum,fetcher,sid);}
}
async function loadList(url,options) {
  const html=(await bytes(url,4_000_000,options)).toString('utf8'),title=vnoj.plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'').replace(/\s*-\s*VNOJ:.*$/i,'')||url.split('/').at(-1);
  const problems=url.includes('/contest/')?vnoj.contestProblems(html):[{url,name:title}];
  if(!problems.length)throw Error('Không đọc được danh sách bài. Kiểm tra đã tham gia kỳ thi trên VNOJ, hoặc dùng Competitive Companion.');
  return {title,problems:problems.slice(0,26)};
}
async function statement(problem,options) {
  const html=(await bytes(problem.url,5_000_000,options)).toString('utf8');
  const tests=htmlSamples(html),text=decode(html.match(/<div\b[^>]*id=["']problem-content["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]??'');
  const links=[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>vnoj.vnojUrl(m[1],/^\/pdf\/[\w.-]+\.pdf$/i)).filter(Boolean).map(u=>u.href);
  for(const url of [...new Set(links),problem.url+'/pdf'])try{const pdf=await bytes(url,25_000_000,options);if(pdf.subarray(0,5).toString()==='%PDF-')return {pdf,tests,text};}catch{}
  return {tests,text};
}
module.exports={htmlSamples,pdfSamples,bytes,loadList,statement};
