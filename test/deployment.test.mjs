import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { serviceDefinition, installManaged, startManaged, stopManaged } from '../src/setup/managed-service.mjs';
import { selectDeployment, readDeployment, deploymentLines } from '../src/setup/deployment.mjs';
import { startQrServer } from '../src/setup/qr-server.mjs';

test('macOS 服务使用独立名称和绝对路径，特殊字符转义，不复制凭据', () => {
  const a=serviceDefinition('/tmp/团队 & "方案"',{platform:'darwin',home:'/tmp/test home',node:'/usr/local/bin/node',uid:501,searchPath:'/usr/bin:/bin'});
  assert.match(a.content, /团队 &amp; &quot;方案&quot;/); assert.match(a.content, /<key>KeepAlive<\/key><true\/>/);assert.match(a.content,/scripts\/managed-service.mjs/);
  assert.doesNotMatch(a.content,/MODEL_API_KEY|FEISHU_.*SECRET/);assert.notEqual(a.id,serviceDefinition('/tmp/another',{platform:'darwin'}).id);
  assert.throws(()=>serviceDefinition('/tmp/xx\nOther=evil'),/控制字符/);
});

test('服务器临时扫码入口仅服务二维码文件，不读取密钥或遍历目录', async () => {
 const root=mkdtempSync(path.join(os.tmpdir(),'qr-http-'));writeFileSync(path.join(root,'index.html'),'<h1>扫码</h1>');writeFileSync(path.join(root,'.env'),'secret');const server=await startQrServer(root);
 try {assert.equal((await fetch(server.url)).status,200);assert.equal((await fetch(server.url+'.env')).status,404);assert.equal((await fetch(server.url+'%2e%2e%2f.env')).status,404);assert.equal((await fetch(server.url,{method:'POST'})).status,405);assert.equal((await fetch(server.url,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);}
 finally {await server.close();rmSync(root,{recursive:true,force:true});}
});
test('Linux 用户服务重启整个进程组；路径不展开变量或 systemd specifier', () => {
  const s=serviceDefinition('/tmp/团队 $abc %h',{platform:'linux',home:'/tmp/home',node:'/usr/bin/node',searchPath:'/usr/bin'});
  assert.match(s.content,/KillMode=control-group/);assert.match(s.content,/Restart=always/);assert.match(s.content,/ExecStart=.*\$\$abc %%h/);assert.match(s.content,/WorkingDirectory=.*\$abc %%h/);
});
test('安装与开始分离，停止通过系统服务管理器，避免被 KeepAlive 拉回', () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'service-install-')),calls=[];let loaded=false;
  const run=(command,args)=>{calls.push([command,...args]);if(args[0]==='print'&&!loaded)throw Error('not loaded');if(args[0]==='bootstrap')loaded=true;if(args[0]==='bootout')loaded=false;return '';};
  try {
    const s=installManaged(root,{platform:'darwin',home:root,uid:123,run});assert.equal(calls.length,0);
    assert.ok(readFileSync(s.file,'utf8').includes(s.id));startManaged(s,run);startManaged(s,run);stopManaged(s,run);
    assert.equal(calls.filter(x=>x[1]==='bootstrap').length,1);assert.equal(calls.filter(x=>x[1]==='bootout').length,1);assert.equal(loaded,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('服务器信息持久化且安全引用；缺少信息、注入主机与根目录拒绝', () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'deployment-'));
  try {
    assert.throws(()=>selectDeployment(root,'server'),/主机和用户名/);
    assert.throws(()=>selectDeployment(root,'server',{host:'x; touch /tmp/pwn',user:'root'}),/格式无效/);
    assert.throws(()=>selectDeployment(root,'server',{host:'example.org',user:'root',directory:'/'}),/非根目录/);
    const r=selectDeployment(root,'server',{host:'example.org',user:'ubuntu',directory:'/opt/my team',identityFile:'/tmp/my key'});
    assert.equal(readDeployment(root).server.directory,'/opt/my team');assert.equal(r.location,'remote');assert.match(deploymentLines(r).join('\n'),/'\/tmp\/my key'/);
    assert.equal(selectDeployment(root,'server',{here:true}).location,'here');
  }finally{rmSync(root,{recursive:true,force:true});}
});
