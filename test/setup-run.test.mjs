import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSetup } from '../src/setup/run.mjs';
import { readProgress, saveProgress } from '../src/setup/progress.mjs';

const MODEL = 'MODEL_BASE_URL=https://m.test/api\nMODEL_API_KEY=sk-secret-123\nMODEL_NAME=m1\n';
const TEAM = ['PRODUCT', 'DESIGNER', 'DEVELOPER'].map(k => `FEISHU_${k}_APP_ID=cli_${k.toLowerCase()}\nFEISHU_${k}_APP_SECRET=s_${k}\n`).join('');
const ADMIN = 'FEISHU_ADMIN_APP_ID=cli_admin\nFEISHU_ADMIN_APP_SECRET=s_ADMIN\nFEISHU_ADMIN_OPEN_ID=ou_admin\n';
const BOTS = TEAM + ADMIN;

function setupRoot(envText) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-run-'));
  writeFileSync(path.join(root, '.env.example'), '# 模板\nMODEL_BASE_URL=https://example.com/api/compatible\nMODEL_API_KEY=xxx\nMODEL_NAME=xxx\n');
  if (envText !== undefined) writeFileSync(path.join(root, '.env'), envText, { mode: 0o600 });
  return root;
}

function fakes(over = {}) {
  const calls = { install: 0, scan: [], group: [], service: 0, stop: 0, greet: [], messages: [] };
  let running = false;
  const deps = {
    depsReady: () => true,
    installStatus: () => ({ status: 'ok' }),
    pickRegistry: async () => 'https://registry.npmjs.org/',
    startInstall: () => { calls.install += 1; return { status: 'running' }; },
    waitForInstall: async () => ({ ok: true }),
    installLogTail: () => '',
    checkModel: async () => ({ ok: true }),
    serviceStatus: () => ({ running }),
    startService: async () => { calls.service += 1; running = true; return { ok: true, pid: 1 }; },
    stopService: async () => { calls.stop += 1; running = false; return { stopped: true }; },
    portsFree: async () => true,
    pickPort: async start => start,
    workbenchState: async () => null,
    workbenchMessage: async (port, message) => { calls.messages.push({ port, ...message }); return { retrying: true }; },
    loadFeishu: async () => ({
      lark: { defaultHttpInstance: {}, LoggerLevel: { error: 0 }, Client: class { constructor(o) { this.appId = o.appId; } } },
      qrcode: {},
      installRetry: () => {},
      registerMissing: async ({ roles, save }) => { calls.scan.push(roles.map(r => r.key)); for (const role of roles) await save(role, { appId: `cli_new_${role.key}`, appSecret: 'new-secret', openId: 'ou_me' }); return roles.map(role => ({ role, ok: true, error: null })); },
      createTeamGroup: async args => { calls.group.push(args); return { chatId: 'oc_team', ownerSet: true, joinLink: null }; },
      greetAdmin: async args => { calls.greet.push(args); },
    }),
    ...over,
  };
  return { deps, calls };
}

const env0 = root => readFileSync(path.join(root, '.env'), 'utf8');

async function run(root, argv, { deps, env = {}, stdin = '' }) {
  const out = [];
  const code = await runSetup({ root, argv, env, readStdin: async () => stdin, log: line => out.push(line), deps });
  return { code, text: out.join('\n') };
}

test('首跑：按模板建 .env（600），在后台装依赖，问用户要模型三项', async () => {
  const root = setupRoot();
  const { deps, calls } = fakes({ depsReady: () => false, installStatus: () => ({ status: 'none' }) });
  const { code, text } = await run(root, [], { deps });
  assert.equal(code, 0);
  assert.equal(statSync(path.join(root, '.env')).mode & 0o777, 0o600);
  assert.equal(calls.install, 1);
  assert.match(text, /== 下一步 ==/);
  assert.match(text, /接口地址、密钥、模型名/);
});

test('model 子命令：密钥从标准输入写入，输出里没有密钥', async () => {
  const root = setupRoot();
  const { deps } = fakes({ checkModel: async () => ({ ok: false, reason: '密钥不对或没有权限：检查 MODEL_API_KEY（HTTP 401）' }) });
  const { text } = await run(root, ['model', '--base-url', 'https://m.test/api', '--model', 'm1'], { deps, stdin: 'sk-secret-123\n' });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /MODEL_API_KEY=sk-secret-123/);
  assert.match(text, /MODEL_API_KEY/);
  assert.doesNotMatch(text, /sk-secret-123/);
});

test('沿用终端变量：只报变量名，不出现值', async () => {
  const root = setupRoot();
  const { deps } = fakes();
  const env = { ANTHROPIC_BASE_URL: 'https://gw.test', ANTHROPIC_AUTH_TOKEN: 'tok-secret', ANTHROPIC_MODEL: 'm2' };
  const { text } = await run(root, ['--use-anthropic-env'], { deps, env });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /MODEL_API_KEY=tok-secret/);
  assert.match(text, /ANTHROPIC_AUTH_TOKEN/);
  assert.doesNotMatch(text, /tok-secret/);
});

test('到扫码这步只提示，不自己开始扫码', async () => {
  const root = setupRoot(MODEL);
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  const { text } = await run(root, [], { deps });
  assert.deepEqual(calls.scan, []);
  assert.match(text, /node setup\.mjs scan/);
  assert.match(text, /飞书手机版/);
});

test('scan：只扫缺的角色，写凭证，建群，起服务，最后让用户去群里 @', async () => {
  const root = setupRoot(MODEL + 'FEISHU_PRODUCT_APP_ID=cli_old\nFEISHU_PRODUCT_APP_SECRET=s_old\n');
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  const { code, text } = await run(root, ['scan'], { deps });
  assert.equal(code, 0);
  assert.deepEqual(calls.scan, [['designer', 'developer', 'admin']]);
  assert.match(env0(root), /FEISHU_ADMIN_OPEN_ID=ou_me/);
  const env = readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(env, /FEISHU_DESIGNER_APP_ID=cli_new_designer/);
  assert.match(env, /FEISHU_PRODUCT_APP_ID=cli_old/);
  assert.equal(calls.group[0].appIds.product, 'cli_old');
  assert.equal(calls.group[0].ownerOpenId, undefined);
  assert.equal(calls.service, 1);
  assert.equal(readProgress(root).groupReady, true);
  assert.match(text, /@AI 产品经理/);
  assert.match(text, /127\.0\.0\.1:4870/);
  assert.doesNotMatch(text, /new-secret|s_old|sk-secret-123/);
});

test('扫产品经理的码时拿到的 open_id 用来当群主', async () => {
  const root = setupRoot(MODEL);
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  await run(root, ['scan'], { deps });
  assert.equal(calls.group[0].ownerOpenId, 'ou_me');
});

test('依赖还在装：提示稍后重跑', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true });
  const { deps } = fakes({ depsReady: () => false, installStatus: () => ({ status: 'running' }), waitForInstall: async () => ({ ok: false, pending: true }) });
  const { code, text } = await run(root, [], { deps });
  assert.equal(code, 0);
  assert.match(text, /依赖还在后台安装/);
});

test('都好了再跑只报状态；不认识的参数报错', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true });
  const { deps, calls } = fakes({ serviceStatus: () => ({ running: true }) });
  const done = await run(root, [], { deps });
  assert.match(done.text, /都好了/);
  assert.equal(calls.service, 0);
  assert.equal((await run(root, ['--nope'], { deps })).code, 1);
});

test('工作台端口被别的程序占了：换一对空闲端口写进 .env，卡片和提示都用新地址', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, ownerOpenId: 'ou_me' });
  const { deps, calls } = fakes({ portsFree: async port => port !== 4870, pickPort: async start => start });
  const { text } = await run(root, [], { deps });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /PREVIEW_PORT=4880/);
  assert.equal(calls.group[0].workbench, 'http://127.0.0.1:4880');
  assert.match(text, /本机工作台：http:\/\/127\.0\.0\.1:4880/);
});

test('群已建好、只差起服务时端口被占，也会先换端口再起服务', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true });
  const { deps, calls } = fakes({ portsFree: async port => port !== 4870, pickPort: async start => start });
  await run(root, [], { deps });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /PREVIEW_PORT=4880/);
  assert.equal(calls.service, 1);
});

test('起好服务后状态仍判不出来（比如沙箱里 ps 用不了）：这次运行只启动一次，不换端口', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true });
  // 端口启动前空闲，启动后被刚起的服务自己占着
  const fake = fakes({ serviceStatus: () => ({ running: false }), portsFree: async () => fake.calls.service === 0 });
  const { deps, calls } = fake;
  const { code, text } = await run(root, [], { deps });
  assert.equal(code, 0);
  assert.equal(calls.service, 1);
  assert.doesNotMatch(readFileSync(path.join(root, '.env'), 'utf8'), /PREVIEW_PORT=/);
  assert.match(text, /都好了/);
  assert.match(text, /✓ 团队服务/);
});

test('--key-file：读文件里的密钥写进 .env，读完删掉文件，输出里没有密钥', async () => {
  const root = setupRoot();
  const { deps } = fakes();
  (await import('node:fs')).mkdirSync(path.join(root, 'data'), { recursive: true });
  writeFileSync(path.join(root, 'data/model-key.txt'), "sk-it's-secret\n");
  const { text } = await run(root, ['model', '--base-url', 'https://m.test/api', '--model', 'm1', '--key-file', 'data/model-key.txt'], { deps });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /MODEL_API_KEY="sk-it's-secret"/);
  assert.equal((await import('node:fs')).existsSync(path.join(root, 'data/model-key.txt')), false);
  assert.doesNotMatch(text, /sk-it's-secret/);
});

test('依赖文件在但安装还没跑完：先等安装，不提前进入扫码', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true });
  let waited = 0;
  const { deps, calls } = fakes({ installStatus: () => ({ status: 'running' }), waitForInstall: async () => { waited += 1; return { ok: false, pending: true }; } });
  const { text } = await run(root, [], { deps });
  assert.equal(waited, 1);
  assert.equal(calls.install, 0);
  assert.match(text, /依赖还在后台安装/);
});

test('上次安装失败留下半截依赖：重跑会重新安装', async () => {
  const root = setupRoot(MODEL);
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes({ installStatus: () => ({ status: 'failed', code: 1 }), waitForInstall: async () => ({ ok: false, pending: true }) });
  await run(root, [], { deps });
  assert.equal(calls.install, 1);
});

test('建群续跑：把上次保存的群号、群主状态、链接交给建群', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, chatId: 'oc_half', ownerSet: false, joinLink: 'https://applink.test/j' });
  const { deps, calls } = fakes();
  await run(root, [], { deps });
  assert.deepEqual(calls.group[0].existing, { chatId: 'oc_half', ownerSet: false, joinLink: 'https://applink.test/j' });
});

const STUCK = { projects: [
  { number: 1, name: '读书笔记', stage: 'done', waitingFor: null, error: null, chatId: 'oc_1', retryRole: null },
  { number: 2, name: '个人专注力的小应用', stage: 'clarifying', waitingFor: '重试', error: '团队服务重启过，上一步没做完', chatId: 'oc_2', retryRole: 'product' },
  { number: 3, name: '报名页', stage: 'confirm_design', waitingFor: '确认设计', error: null, chatId: 'oc_3', retryRole: null },
] };
const DONE = () => { const root = setupRoot(MODEL + BOTS); saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true }); return root; };

test('服务停了：重跑 setup 拉起服务，提醒停机时的操作要再做一次，列出没做完的项目和接着做的命令', async () => {
  const { deps, calls } = fakes({ workbenchState: async () => STUCK });
  const { code, text } = await run(DONE(), [], { deps });
  assert.equal(code, 0);
  assert.equal(calls.service, 1);
  assert.match(text, /团队服务已重新启动；服务停着时在群里 @ 过、点过卡片没反应的，再操作一次就行/);
  assert.match(text, /#2 个人专注力的小应用：「澄清需求」停下了（团队服务重启过，上一步没做完）→ node setup.mjs resume 2/);
  assert.doesNotMatch(text, /resume 1|resume 3/);
});

test('第一次搭好（还没有项目）不说“重新启动”；服务一直在跑也不说', async () => {
  const fresh = await run(DONE(), [], { deps: fakes({ workbenchState: async () => ({ projects: [] }) }).deps });
  assert.doesNotMatch(fresh.text, /重新启动|没做完/);
  const running = await run(DONE(), [], { deps: fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => STUCK }).deps });
  assert.doesNotMatch(running.text, /重新启动/);
  assert.match(running.text, /resume 2/);
  const status = await run(DONE(), ['status'], { deps: fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => STUCK }).deps });
  assert.match(status.text, /resume 2/);
  assert.doesNotMatch(status.text, /都好了/);
});

test('resume：替用户给负责的角色发“重试”；编号不对、没停下、服务没在跑都说明原因', async () => {
  const root = DONE();
  const ok = fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => STUCK });
  const r = await run(root, ['resume', '2'], { deps: ok.deps });
  assert.equal(r.code, 0);
  assert.deepEqual(ok.calls.messages, [{ port: 4870, chatId: 'oc_2', role: 'product', text: '重试' }]);
  assert.match(r.text, /已让AI 产品经理接着做 #2 个人专注力的小应用「澄清需求」/);
  const waiting = await run(root, ['resume', '3'], { deps: ok.deps });
  assert.equal(waiting.code, 1);
  assert.match(waiting.text, /#3 报名页 没有停下，不用接着做（现在：确认设计，等用户确认设计）/);
  assert.match((await run(root, ['resume', '9'], { deps: ok.deps })).text, /没有 #9 这个项目/);
  assert.equal(ok.calls.messages.length, 1);
  const down = await run(root, ['resume', '2'], { deps: fakes().deps });
  assert.match(down.text, /团队服务没在运行：先运行 node setup\.mjs/);
  const failed = await run(root, ['resume', '2'], { deps: fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => STUCK, workbenchMessage: async () => { throw new Error('角色无效'); } }).deps });
  assert.match(failed.text, /没能接着做：角色无效/);
});

const NO_ADMIN = () => { const root = setupRoot(MODEL + TEAM); saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true }); return root; };

test('已搭好、还没有管理员助手：先把服务拉起来，再提示补扫一张码；status 也提一句', async () => {
  const { deps, calls } = fakes({ workbenchState: async () => STUCK });
  const { code, text } = await run(NO_ADMIN(), [], { deps });
  assert.equal(code, 0);
  assert.equal(calls.service, 1);
  assert.deepEqual(calls.scan, []);
  assert.match(text, /resume 2/);
  assert.match(text, /创建 AI 管理员助手/);
  assert.match(text, /node setup\.mjs scan/);
  assert.match(text, /… AI 管理员助手/);
  const status = await run(NO_ADMIN(), ['status'], { deps: fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => STUCK }).deps });
  assert.match(status.text, /resume 2/);
  assert.match(status.text, /还没建 AI 管理员助手/);
});

test('补扫管理员助手：只扫这一张，写进 3 个变量，私聊报到，重启团队服务让它上线', async () => {
  const root = NO_ADMIN();
  const { deps, calls } = fakes({ serviceStatus: () => ({ running: calls.stop === 0 || calls.service > 0 }), workbenchState: async () => ({ projects: [] }) });
  const { code, text } = await run(root, ['scan'], { deps });
  assert.equal(code, 0);
  assert.deepEqual(calls.scan, [['admin']]);
  assert.match(env0(root), /FEISHU_ADMIN_APP_ID=cli_new_admin\nFEISHU_ADMIN_APP_SECRET=new-secret\nFEISHU_ADMIN_OPEN_ID=ou_me/);
  assert.equal(calls.greet[0].openId, 'ou_me');
  assert.match(JSON.stringify(calls.greet[0].card), /AI 管理员助手 · 报到/);
  assert.deepEqual([calls.stop, calls.service], [1, 1]);
  assert.match(text, /AI 管理员助手上线了/);
  assert.match(text, /✓ AI 管理员助手/);
  assert.match(text, /私聊「AI 管理员助手」/);
  assert.doesNotMatch(text, /new-secret/);
});

test('补扫管理员助手时有项目在干活、或没有权限停服务：不重启，告诉用户之后自己重启', async () => {
  const busy = fakes({ serviceStatus: () => ({ running: true }), workbenchState: async () => ({ projects: [{ number: 4, name: '番茄钟', busy: true }] }) });
  const r1 = await run(NO_ADMIN(), ['scan'], { deps: busy.deps });
  assert.equal(busy.calls.stop, 0);
  assert.match(r1.text, /#4 番茄钟正在干活，等这一步做完后运行 npm stop && npm start/);
  const denied = fakes({ serviceStatus: () => ({ running: true }), stopService: async () => ({ stopped: false, denied: true }) });
  const r2 = await run(NO_ADMIN(), ['scan'], { deps: denied.deps });
  assert.equal(denied.calls.service, 0);
  assert.match(r2.text, /在自己的终端里进入项目目录运行 npm stop && npm start/);
});

test('扫管理员助手的码没拿到扫码人的身份：不写半截配置，报出原因', async () => {
  const { deps, calls } = fakes({ serviceStatus: () => ({ running: true }) });
  const feishu = await deps.loadFeishu();
  deps.loadFeishu = async () => ({ ...feishu, registerMissing: async ({ roles, save }) => {
    calls.scan.push(roles.map(r => r.key));
    try { await save(roles[0], { appId: 'cli_x', appSecret: 'sec', openId: null }); return [{ role: roles[0], ok: true }]; }
    catch (error) { return [{ role: roles[0], ok: false, error }]; }
  } });
  const root = NO_ADMIN();
  const { text } = await run(root, ['scan'], { deps });
  assert.doesNotMatch(env0(root), /FEISHU_ADMIN_APP_ID/);
  assert.match(text, /AI 管理员助手没建成（没拿到扫码人的身份（open_id））/);
});
