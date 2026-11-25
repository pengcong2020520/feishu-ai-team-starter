import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { team } from './team.mjs';
import { readEnv, ensureEnv, updateEnv } from './env-file.mjs';
import { readProgress, saveProgress } from './progress.mjs';
import { missingModel, missingBots, nextStage } from './state.mjs';
import { anthropicEnv, checkModel } from './model.mjs';
import { depsReady, installStatus, pickRegistry, startInstall, waitForInstall, installLogTail } from './install.mjs';
import { serviceStatus, startService, pickPort, portsFree, workbenchState, workbenchMessage } from './service.mjs';
import { installRetry, registerMissing } from './register.mjs';
import { createTeamGroup } from './group.mjs';
import { stageNames } from '../flow/stages.mjs';

const portOf = env => Number(env.PREVIEW_PORT || 4870);
const workbenchOf = env => `http://127.0.0.1:${portOf(env)}`;
const LABEL = { MODEL_BASE_URL: '接口地址', MODEL_API_KEY: '密钥', MODEL_NAME: '模型名' };
const MODEL_CMD = '用文件写入工具把密钥原样存成 data/model-key.txt（不要用 shell 命令写），再运行 node setup.mjs model --base-url <地址> --model <模型名> --key-file data/model-key.txt（读完会删掉这个文件）';

const realDeps = {
  depsReady, installStatus, pickRegistry, startInstall, waitForInstall, installLogTail, checkModel, serviceStatus, startService, pickPort, portsFree, workbenchState, workbenchMessage,
  // 飞书 SDK 和 qrcode 要等依赖装好才能加载
  async loadFeishu() {
    const lark = await import('@larksuiteoapi/node-sdk');
    const { default: qrcode } = await import('qrcode');
    return { lark, qrcode, installRetry, registerMissing, createTeamGroup };
  },
};

const why = error => error?.code === 'timeout' ? '等待扫码超时' : error?.code === 'access_denied' ? '在手机上拒绝了创建' : (error?.message ?? '未知错误');

export async function runSetup({ root, argv = [], env = process.env, readStdin = async () => '', log = console.log, deps: injected = {} }) {
  const d = { ...realDeps, ...injected };
  const envFile = path.join(root, '.env');
  ensureEnv(envFile, path.join(root, '.env.example'));
  mkdirSync(path.join(root, 'data'), { recursive: true });
  // 后台安装还在跑或失败过，就算文件在也不算装好（可能只装了一半）
  const depsOk = () => d.depsReady(root) && !['running', 'failed'].includes(d.installStatus(root).status);
  // 这次运行里刚起好的服务就算在跑：万一判断进程的办法在这台机器上不灵，也不会一遍遍重复启动
  let serviceStarted = false;
  const serviceRunning = () => serviceStarted || d.serviceStatus(root).running;
  const [command, ...rest] = argv;
  // 服务在跑时，列出停下来等“重试”的项目（电脑重启、服务被关掉时没做完的那一步，或出错停下的）
  const stuckLines = async fileEnv => {
    const snapshot = await d.workbenchState(portOf(fileEnv));
    const projects = snapshot?.projects ?? [];
    const stuck = projects.filter(p => p.waitingFor === '重试');
    return [
      serviceStarted && projects.length ? '告诉用户：团队服务已重新启动；服务停着时在群里 @ 过、点过卡片没反应的，再操作一次就行' : null,
      stuck.length ? '有没做完的项目：问用户要不要接着做，要的话运行对应的命令（负责的同事会接着做这一步，群里会出现进度卡）' : null,
      ...stuck.map(p => `   #${p.number} ${p.name}：「${stageNames[p.stage] ?? p.stage}」停下了（${String(p.error).slice(0, 80)}）→ node setup.mjs resume ${p.number}`),
    ].filter(Boolean);
  };
  const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const finish = (code, lines) => {
    const fileEnv = readEnv(envFile);
    const progress = readProgress(root);
    const bots = team.length - missingBots(fileEnv).length;
    const mark = ok => (ok ? '✓' : '…');
    log(['', '== 当前进度 ==',
      `${mark(progress.modelOk && !missingModel(fileEnv).length)} 模型`,
      `${mark(depsOk())} 依赖`,
      `${mark(bots === team.length)} 飞书机器人 ${bots}/${team.length}`,
      `${mark(progress.groupReady)} 飞书群「AI 团队」`,
      `${mark(serviceRunning())} 团队服务`,
      '', '== 下一步 ==', ...lines.filter(Boolean)].join('\n'));
    return code;
  };

  if (command === 'model') {
    const updates = {};
    if (flag('--base-url')) updates.MODEL_BASE_URL = flag('--base-url');
    if (flag('--model')) updates.MODEL_NAME = flag('--model');
    const keyFile = flag('--key-file');
    let key;
    if (keyFile) {
      try { key = readFileSync(path.resolve(root, keyFile), 'utf8'); } catch { return finish(1, [`读不到密钥文件 ${keyFile}。${MODEL_CMD}`]); }
      rmSync(path.resolve(root, keyFile), { force: true });
    } else key = await readStdin();
    key = key.trim();
    if (key) updates.MODEL_API_KEY = key;
    if (!Object.keys(updates).length) return finish(1, [`没收到模型信息。${MODEL_CMD}`]);
    updateEnv(envFile, updates);
    saveProgress(root, { modelOk: false });
    log(`已写入 .env：${Object.keys(updates).join('、')}`);
  } else if (command === '--use-anthropic-env') {
    const { found, values } = anthropicEnv(env);
    if (!values.MODEL_API_KEY) return finish(0, ['需要用户：终端里没有 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY，请直接提供模型的接口地址、密钥、模型名', `拿到后：${MODEL_CMD}`]);
    updateEnv(envFile, values);
    saveProgress(root, { modelOk: false });
    log(`已沿用终端变量 ${found.join('、')}，写入 .env：${Object.keys(values).join('、')}`);
  } else if (command === 'resume') {
    const fileEnv = readEnv(envFile);
    if (!serviceRunning()) return finish(1, ['团队服务没在运行：先运行 node setup.mjs 把它拉起来，再接着做']);
    const snapshot = await d.workbenchState(portOf(fileEnv));
    if (!snapshot) return finish(1, [`连不上工作台 ${workbenchOf(fileEnv)}，看 data/service.log`]);
    const p = snapshot.projects.find(x => x.number === Number(rest[0]));
    if (!p) return finish(1, [`没有 #${rest[0] ?? ''} 这个项目。运行 node setup.mjs 看哪些项目没做完`]);
    if (p.waitingFor !== '重试') return finish(1, [`#${p.number} ${p.name} 没有停下，不用接着做（现在：${stageNames[p.stage] ?? p.stage}${p.waitingFor ? `，等用户${p.waitingFor}` : ''}）`]);
    const name = team.find(r => r.key === p.retryRole)?.name ?? '负责的同事';
    try { await d.workbenchMessage(portOf(fileEnv), { chatId: p.chatId, role: p.retryRole, text: '重试' }); }
    catch (error) { return finish(1, [`没能接着做：${error.message}`]); }
    return finish(0, [`告诉用户：已让${name}接着做 #${p.number} ${p.name}「${stageNames[p.stage] ?? p.stage}」，去飞书群或工作台 ${workbenchOf(fileEnv)} 看进度卡`]);
  } else if (command && !['scan', 'status'].includes(command)) {
    return finish(1, [`不认识的参数：${command}。可用：node setup.mjs、node setup.mjs scan、node setup.mjs status、node setup.mjs resume <编号>、node setup.mjs model …、node setup.mjs --use-anthropic-env`]);
  }

  // 依赖不在、也没在装，就先在后台装：用户回答问题的同时装好
  if (!depsOk() && d.installStatus(root).status !== 'running') {
    const registry = await d.pickRegistry();
    d.startInstall(root, { registry });
    log(`已在后台安装依赖（${registry.includes('npmmirror') ? 'npmmirror 镜像' : 'npm 官方源'}），日志 data/install.log`);
  }

  // 报到卡片和服务都要用工作台地址：先定好端口，被别的程序占了就换一对空闲的
  const ensurePort = async fileEnv => {
    const want = Number(fileEnv.PREVIEW_PORT || 4870);
    if (serviceRunning() || await d.portsFree(want)) return;
    const port = await d.pickPort(want + 10);
    updateEnv(envFile, { PREVIEW_PORT: String(port) });
    fileEnv.PREVIEW_PORT = String(port);
    log(`端口 ${want}/${want + 1} 被别的程序占用，改用 ${port}/${port + 1}（已写进 .env 的 PREVIEW_PORT）`);
  };

  let feishu = null;
  for (let round = 0; round < 10; round += 1) {
    const fileEnv = readEnv(envFile);
    const progress = readProgress(root);
    const stage = nextStage({ env: fileEnv, progress, depsReady: depsOk(), serviceRunning: serviceRunning() });
    if (command === 'status') {
      if (stage !== 'done') return finish(0, ['运行 node setup.mjs 继续']);
      const stuck = await stuckLines(fileEnv);
      return finish(0, stuck.length ? stuck : ['都好了，不用再做什么']);
    }

    if (stage === 'model') {
      const missing = missingModel(fileEnv);
      const a = anthropicEnv(env);
      return finish(0, [
        `需要用户：提供模型的${missing.map(k => LABEL[k]).join('、')}（Anthropic 兼容接口，比如火山方舟、DeepSeek）`,
        '密钥可以直接发给助手，也可以由用户自己填进 .env 的 MODEL_API_KEY 后说“填好了”；助手不要复述密钥',
        a.values.MODEL_API_KEY ? `可选：终端里已有 ${a.found.join('、')}（接口地址 ${a.baseUrl ?? '官方默认'}），用户说“沿用”就运行 node setup.mjs --use-anthropic-env` : null,
        `拿到后：${MODEL_CMD}（只缺模型名时：node setup.mjs model --model <模型名>；用户自己填了 .env 就直接运行 node setup.mjs）`,
      ]);
    }
    if (stage === 'model-check') {
      const r = await d.checkModel({ baseUrl: fileEnv.MODEL_BASE_URL, apiKey: fileEnv.MODEL_API_KEY, model: fileEnv.MODEL_NAME });
      if (!r.ok) return finish(0, [`模型连通检查没通过：${r.reason}`, `需要用户：确认后给出正确的值，用 ${MODEL_CMD} 写入（只改一项时只带那一项），再运行 node setup.mjs`]);
      saveProgress(root, { modelOk: true, modelCheckedAt: new Date().toISOString() });
      log('✓ 模型连通检查通过');
      continue;
    }
    if (stage === 'deps') {
      log('等依赖装好（首次约 450 MB）…');
      const w = await d.waitForInstall(root, { timeoutMs: 100000 });
      if (w.pending) return finish(0, ['依赖还在后台安装，过一两分钟再运行 node setup.mjs（日志 data/install.log）']);
      if (!w.ok) return finish(1, [`安装依赖没成功：${w.reason}`, d.installLogTail(root), '检查网络后重跑 node setup.mjs，会自动重新安装']);
      continue;
    }
    if (stage === 'feishu') {
      const names = missingBots(fileEnv).map(r => r.name).join('、');
      if (command !== 'scan') return finish(0, [
        `接下来扫码创建飞书机器人（还差：${names}）`,
        '先告诉用户：马上会在浏览器里弹出二维码页面，请用飞书手机版逐个扫码，并在手机上确认创建（大约 1 分钟）',
        '然后运行：node setup.mjs scan —— 它会等到扫完（最长 9 分钟）；把命令超时放宽到 10 分钟，或放到后台运行并查看输出；被打断就重跑，已建成的不用再扫',
      ]);
      feishu ??= await d.loadFeishu();
      feishu.installRetry(feishu.lark.defaultHttpInstance, { log });
      const results = await feishu.registerMissing({
        lark: feishu.lark, qrcode: feishu.qrcode, roles: missingBots(fileEnv), qrDir: path.join(root, 'qr'), log,
        save: async (role, r) => {
          updateEnv(envFile, { [`${role.prefix}APP_ID`]: r.appId, [`${role.prefix}APP_SECRET`]: r.appSecret });
          if (role.key === 'product' && r.openId) saveProgress(root, { ownerOpenId: r.openId });
        },
      });
      const failed = results.filter(r => !r.ok);
      if (failed.length) return finish(0, [`还有 ${failed.length} 个没建成：${failed.map(f => `${f.role.name}（${why(f.error)}）`).join('、')}`, '重跑 node setup.mjs scan 会给没建成的出新码，已建成的不用再扫']);
      continue;
    }
    if (stage === 'group') {
      await ensurePort(fileEnv);
      feishu ??= await d.loadFeishu();
      const appIds = Object.fromEntries(team.map(r => [r.key, fileEnv[`${r.prefix}APP_ID`]]));
      const clients = Object.fromEntries(team.map(r => [r.key, new feishu.lark.Client({ appId: fileEnv[`${r.prefix}APP_ID`], appSecret: fileEnv[`${r.prefix}APP_SECRET`], loggerLevel: feishu.lark.LoggerLevel.error })]));
      try {
        const g = await feishu.createTeamGroup({ clients, appIds, team, ownerOpenId: progress.ownerOpenId, existing: progress.chatId ? { chatId: progress.chatId, ownerSet: Boolean(progress.ownerSet), joinLink: progress.joinLink ?? null } : null, onChat: info => saveProgress(root, info), workbench: workbenchOf(fileEnv), log });
        saveProgress(root, { chatId: g.chatId, ownerSet: g.ownerSet, joinLink: g.joinLink, groupReady: true });
        log('✓ 已建群「AI 团队」，3 个机器人发了报到卡片');
      } catch (error) {
        return finish(1, [`建群没成功：${error.message}`, '把这段报错告诉用户；可以重跑 node setup.mjs 再试']);
      }
      continue;
    }
    if (stage === 'service') {
      await ensurePort(fileEnv);
      const r = await d.startService(root);
      if (!r.ok) return finish(1, [`团队服务没起来：${r.error}`, '日志在 data/service.log；修好后运行 npm start']);
      serviceStarted = true;
      log('✓ 团队服务已在后台启动');
      continue;
    }
    return finish(0, [
      ...await stuckLines(fileEnv),
      '都好了。告诉用户：',
      '1. 打开飞书群「AI 团队」，@AI 产品经理 说一句需求，比如“做一个记录读书笔记的小网页”；它回一张“要开始做吗？”卡片，点“就按这个开始”才开工，之后按卡片提示点按钮',
      progress.ownerSet ? null : progress.joinLink ? `   还不在群里的话，先打开这个链接进群：${progress.joinLink}` : '   还不在群里的话：在飞书里新建一个群，把 3 个机器人拉进来（群设置 → 群机器人 → 添加机器人）',
      `2. 本机工作台：${workbenchOf(readEnv(envFile))}`,
      '3. 想改某个角色或技能，直接说（照 AGENTS.md「改角色和技能」改）',
      '停止服务 npm stop；查看状态 npm run status',
    ]);
  }
  return finish(1, ['流程没有推进，请把上面的输出告诉维护者']);
}
