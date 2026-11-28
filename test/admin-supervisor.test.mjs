import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupervisor } from '../src/admin/supervisor.mjs';
import { serviceStatus, startService, stopService } from '../src/setup/service.mjs';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const fixture = scripts => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'admin-sup-'));
  for (const [name, code] of Object.entries(scripts)) { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), code); }
  return root;
};
const ready = "console.log('3 个机器人已连上飞书'); setInterval(() => {}, 1000);";

test('拉起团队服务、等它连上飞书、输出写进日志；正常停下不算意外退出', async () => {
  const root = fixture({ 'team.mjs': ready });
  const exits = [];
  const sup = createSupervisor({ root, entry: 'team.mjs', logFile: path.join(root, 'data/service.log'), echo: false, onExit: e => exits.push(e) });
  const r = await sup.start();
  assert.equal(r.ok, true);
  assert.deepEqual([sup.status().running, sup.status().healthy], [true, true]);
  assert.deepEqual(await sup.start(), { ok: true, already: true, pid: r.pid });
  assert.deepEqual(await sup.stop(), { stopped: true });
  assert.equal(sup.status().running, false);
  assert.equal(sup.status().lastExit.expected, true);
  assert.equal(alive(r.pid), false);
  assert.deepEqual(exits, []);
  sup.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(readFileSync(path.join(root, 'data/service.log'), 'utf8'), /已连上飞书/);
});

test('团队服务意外退出时通知；启动就崩时带回报错', async () => {
  const root = fixture({ 'flaky.mjs': "console.log('3 个机器人已连上飞书'); setTimeout(() => process.exit(3), 100);", 'bad.mjs': "console.error('缺少配置：FEISHU_PRODUCT_APP_ID'); process.exit(1);" });
  const exits = [];
  const flaky = createSupervisor({ root, entry: 'flaky.mjs', echo: false, onExit: e => exits.push(e) });
  assert.equal((await flaky.start()).ok, true);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual([exits.length, exits[0].code, exits[0].expected], [1, 3, false]);
  const bad = createSupervisor({ root, entry: 'bad.mjs', echo: false, onExit: e => exits.push(e) });
  const r = await bad.start();
  assert.equal(r.ok, false);
  assert.match(r.error, /FEISHU_PRODUCT_APP_ID/);
  assert.equal(exits.at(-1).code, 1);
});

test('一直没连上：到时间报出来但不杀它；重启换新进程；不理 SIGTERM 的强制结束', async () => {
  const root = fixture({ 'slow.mjs': 'setInterval(() => {}, 1000);', 'team.mjs': ready, 'stubborn.mjs': "process.on('SIGTERM', () => {}); console.log('3 个机器人已连上飞书'); setInterval(() => {}, 1000);" });
  const slow = createSupervisor({ root, entry: 'slow.mjs', readyMs: 200, echo: false });
  const r = await slow.start();
  assert.equal(r.ok, false);
  assert.match(r.error, /秒内没看到/);
  assert.equal(slow.status().running, true);
  await slow.stop();
  const team = createSupervisor({ root, entry: 'team.mjs', echo: false });
  const first = await team.start();
  const second = await team.restart();
  assert.equal(second.ok, true);
  assert.notEqual(second.pid, first.pid);
  assert.equal(alive(first.pid), false);
  await team.stop();
  const stubborn = createSupervisor({ root, entry: 'stubborn.mjs', stopMs: 200, echo: false });
  const s = await stubborn.start();
  await stubborn.stop();
  assert.equal(alive(s.pid), false);
});

test('并发启动共用一次就绪结果，停下和重启串行执行', async () => {
  const root = fixture({ 'slow.mjs': "setTimeout(() => console.log('3 个机器人已连上飞书'), 120); setInterval(() => {}, 1000);" });
  const sup = createSupervisor({ root, entry: 'slow.mjs', echo: false });
  const first = sup.start();
  const second = sup.start();
  assert.equal(first, second);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(a.pid, b.pid);
  const restarted = sup.restart();
  const stopped = sup.stop();
  assert.equal((await restarted).ok, true);
  assert.deepEqual(await stopped, { stopped: true });
  assert.equal(sup.status().running, false);
});

test('npm start 后台起的是管理服务，团队服务是它的子进程；npm stop 两个一起停', async () => {
  const root = fixture({ 'src/main.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync('team.pid', String(process.pid)); console.log('3 个机器人已连上飞书'); setInterval(() => {}, 1000);" });
  for (const file of ['src/admin/main.mjs', 'src/admin/supervisor.mjs', 'src/setup/service.mjs', 'src/setup/proc.mjs', 'src/setup/managed-service.mjs']) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); copyFileSync(path.join(repo, file), path.join(root, file)); }
  const r = await startService(root, { intervalMs: 50 });
  assert.equal(r.ok, true);
  assert.equal(serviceStatus(root).running, true);
  assert.match(readFileSync(path.join(root, 'data/service.pid'), 'utf8'), /src\/admin\/main\.mjs/);
  const teamPid = Number(readFileSync(path.join(root, 'team.pid'), 'utf8'));
  assert.notEqual(teamPid, r.pid);
  assert.equal(alive(teamPid), true);
  assert.deepEqual(await stopService(root), { stopped: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(alive(teamPid), false);
  assert.match(readFileSync(path.join(root, 'data/service.log'), 'utf8'), /管理服务已启动/);
});

test('守护模式异常退出会自动拉起，显式停止不会再次启动', async () => {
  const root=fixture({'team.mjs':"import {existsSync,writeFileSync} from 'node:fs'; console.log('3 个机器人已连上飞书'); if(!existsSync('once')){writeFileSync('once','1');setTimeout(()=>process.exit(3),30);}else setInterval(()=>{},1000);"});
  const sup=createSupervisor({root,entry:'team.mjs',echo:false,autoRestart:true,restartMs:30});
  try {
    const first=await sup.start(); const deadline=Date.now()+3000;
    while((sup.status().pid===first.pid||!sup.status().healthy)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
    assert.equal(sup.status().healthy,true);assert.notEqual(sup.status().pid,first.pid);
    await sup.stop();await new Promise(r=>setTimeout(r,100));assert.equal(sup.status().running,false);
  }finally{await sup.stop();sup.close();}
});
