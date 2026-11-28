import test from 'node:test';import assert from 'node:assert/strict';
import {calculate,readPdf} from '../src/packages/research-local.mjs';
import {newResearchRequest} from '../src/packages/lobby.mjs';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {saveResearchEvidence} from '../src/packages/evidence.mjs';
import {execFileSync} from 'node:child_process';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {fetchPublic} from '../src/packages/research.mjs';
let hasPdfText=false;try{execFileSync('pdftotext',['-v'],{stdio:'ignore'});hasPdfText=true;}catch{}
test('真实 PDF 提取保留物理页，关键词定位与越界页处理', {skip:!hasPdfText}, async()=>{
  const stream='BT /F1 12 Tf 72 720 Td (Revenue 123) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const fetcher=async()=>({bytes:Buffer.from(pdf),url:'https://example.org/report.pdf',fetchedAt:'now'});
  const r=await readPdf({url:'https://example.org/report.pdf'},fetcher);assert.equal(r.totalPages,1);assert.match(r.text,/物理页 1.*\nRevenue 123/);
  const q=await readPdf({url:r.url,query:'Revenue'},fetcher);assert.equal(q.matches[0].page,1);
  await assert.rejects(readPdf({url:r.url,startPage:2},fetcher),/页码无效/);
});
test('确定性财务计算保留公式来源，增长率与百分比区分',()=>{
const r=calculate({op:'growth',values:[339788,294916],sources:['官方年报物理页10']});assert.ok(Math.abs(r.result-(-0.1320588131))<1e-6);assert.match(r.formula,/比率/);assert.equal(r.sources[0],'官方年报物理页10');
assert.equal(calculate({op:'divide',values:[75059,52849]}).result,75059/52849);
assert.deepEqual(calculate({op:'returns',values:[100,120,90,110]}).result,{totalReturn:110/100-1,periodReturns:[120/100-1,90/120-1,110/90-1],maxDrawdown:-0.25});
const d=calculate({op:'dcf',values:[10,10],rate:0.1,terminalGrowth:0});assert.ok(Math.abs(d.result.total-100)<1e-10);
});
test('拒绝计算注入、零分母、溢出、非法DCF与价格口径',()=>{
for(const args of [{op:'divide',values:[1,0]},{op:'growth',values:[-1,5]},{op:'add',values:[NaN]},{op:'power',values:[10,1000]},{op:'dcf',values:[1],rate:0.01,terminalGrowth:0.02},{op:'returns',values:[0,3]},{op:'eval',values:[1]}])assert.throws(()=>calculate(args));
});
test('PDF 签名验证，非 PDF 不启动提取器',async()=>{
await assert.rejects(readPdf({url:'https://example.com/test'},async()=>({bytes:Buffer.from('not pdf')})),/不是有效 PDF/);
});
test('恶意或缺失重定向只令工具失败，不崩溃服务，也不连接内网',async t=>{
  let location,requests=0;
  t.mock.method(https,'get',(_url,_options,callback)=>{
    requests++;const req=new EventEmitter();
    queueMicrotask(()=>{callback({statusCode:302,headers:{location},resume(){}});req.emit('close');});return req;
  });
  for(const target of [undefined,'https://[invalid','https://127.0.0.1/private','http://example.com/']){
    location=target;await assert.rejects(fetchPublic('https://8.8.8.8/'));
  }
  assert.equal(requests,4,'重定向目标均未产生第二次请求');
});
test('新研究请求产生新项目意图，普通聊天不误判',()=>{
for(const q of ['请你帮我研究一下中国神华','研究中国神华','新研究：中国神华','创建一个新项目','好的，我现在想写一篇关于产品即分发的文章','请帮我写一份行业简报'])assert.equal(newResearchRequest(q),true,q);
for(const q of ['你能做什么','研究报告在哪里','中国神华的报告做好了吗','重试','同步文档'])assert.equal(newResearchRequest(q),false,q);
});
test('PDF 与计算实际结果保留宿主证据而非未定义搜索列表',async()=>{
const root=await mkdtemp(path.join(os.tmpdir(),'research-evidence-'));try{await mkdir(path.join(root,'context'));let r=await saveResearchEvidence(root,'quant','calculate',{...calculate({op:'divide',values:[3,2]}),fetchedAt:'now'});assert.match(await readFile(path.join(root,r.cachedPath),'utf8'),/1.5/);r=await saveResearchEvidence(root,'equity','read_pdf',{url:'https://example.org/report.pdf',text:'[物理页 10]\n年报收入',fetchedAt:'now'});assert.match(await readFile(path.join(root,r.cachedPath),'utf8'),/物理页 10/);}finally{await rm(root,{recursive:true,force:true});}
});
