import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { admin, team } from './team.mjs';
import { readEnv, ensureEnv, updateEnv } from './env-file.mjs';
import { readProgress, saveProgress } from './progress.mjs';
import { missingModel, missingBots, missingAdmin, nextStage } from './state.mjs';
import { anthropicEnv, checkModel } from './model.mjs';
import { depsReady, installStatus, pickRegistry, startInstall, waitForInstall, installLogTail } from './install.mjs';
import { serviceStatus, startService, stopService, pickPort, portsFree, workbenchState, workbenchMessage, workbenchPackageRetry } from './service.mjs';
import { installRetry, registerMissing } from './register.mjs';
import { createTeamGroup, greetAdmin } from './group.mjs';
import { introCard as adminIntroCard } from '../admin/cards.mjs';
import { stageNames } from '../flow/stages.mjs';
import { createFeishuLogger } from '../feishu-logger.mjs';
import { resolveTeamMode, teamModeNames } from '../team-mode.mjs';
import { readDeployment, selectDeployment, deploymentLines, installBackground } from './deployment.mjs';
import { managedService, uninstallManaged, lingerStatus } from './managed-service.mjs';
import { startQrServer } from './qr-server.mjs';

const portOf = env => Number(env.PREVIEW_PORT || 4870);
const workbenchOf = env => `http://127.0.0.1:${portOf(env)}`;
const LABEL = { MODEL_BASE_URL: '接口地址', MODEL_API_KEY: '密钥', MODEL_NAME: '模型名' };
const MODEL_CMD = '用文件写入工具把密钥原样存成 data/model-key.txt（不要用 shell 命令写），再运行 node setup.mjs model --base-url <地址> --model <模型名> --key-file data/model-key.txt（读完会删掉这个文件）';

const realDeps = {
  depsReady, installStatus, pickRegistry, startInstall, waitForInstall, installLogTail, checkModel, serviceStatus, startService, stopService, pickPort, portsFree, workbenchState, workbenchMessage, workbenchPackageRetry, installBackground, managedService, uninstallManaged, lingerStatus,
  // 飞书 SDK 和 qrcode 要等依赖装好才能加载
  async loadFeishu() {
    const lark = await import('@larksuiteoapi/node-sdk');
    const { default: qrcode } = await import('qrcode');
    return { lark, qrcode, installRetry, registerMissing, createTeamGroup, greetAdmin };
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
      `版本：${teamModeNames[resolveTeamMode({ root, env: fileEnv })]}`,
      `部署：${({ local: '本地电脑', server: '服务器' })[readDeployment(root)?.target] || '尚未选择'}；自启动：${d.managedService(root)?.scope || '未安装'}`,
      `团队包审核：${({ human: '人工确认', auto: '独立自动审核' })[fileEnv.TEAM_REVIEW_MODE] || '尚未选择（沿用原工作流关口）'}`,
      `${mark(progress.modelOk && !missingModel(fileEnv).length)} 模型`,
      `${mark(depsOk())} 依赖`,
      `${mark(bots === team.length)} 飞书机器人 ${bots}/${team.length}`,
      `${mark(progress.groupReady)} 飞书群「AI 团队」`,
      `${mark(serviceRunning())} 团队服务`,
      `${mark(!missingAdmin(fileEnv))} AI 管理员助手`,
      '', '== 下一步 ==', ...lines.filter(Boolean)].join('\n'));
    return code;
  };

  const register = async (feishu, options) => {
    const qr = readDeployment(root)?.target === 'server' ? await startQrServer(options.qrDir) : null;
    if (qr) log(`服务器二维码页面：${qr.url}；在你的电脑建立 SSH 转发 -L ${qr.port}:127.0.0.1:${qr.port}，再打开该地址扫码。扫码完成后此临时入口自动关闭。`);
    try { return await feishu.registerMissing({ ...options, ...(qr ? { open: () => {} } : {}) }); }
    finally { await qr?.close(); }
  };

  if (readDeployment(root)?.location === 'remote' && !['deploy', 'service', 'mode', 'review', 'status'].includes(command)) return finish(0, deploymentLines(readDeployment(root)));

  if (command === 'deploy') {
    try {
      if (rest[0] === 'server' && !rest.includes('--here') && (serviceRunning() || d.managedService(root))) return finish(1, ['本机服务或自启动仍在使用这组机器人。请等当前任务结束，运行 npm stop 和 node setup.mjs service uninstall，再选择服务器；原项目与配置保留。']);
      const selected = selectDeployment(root, rest[0], { host: flag('--host'), user: flag('--user'), port: flag('--port'), directory: flag('--path'), identityFile: flag('--identity-file'), here: rest.includes('--here') });
      return finish(0, selected.location === 'remote' ? deploymentLines(selected) : ['部署位置已记录。运行 node setup.mjs 继续；模型与机器人就绪后安装系统常驻服务。macOS 在用户登录后启动；Linux 开机运行还需启用 linger。']);
    } catch (error) { return finish(1, [error.message]); }
  } else if (command === 'service') {
    if (rest[0] === 'uninstall') {
      try { d.uninstallManaged(root); return finish(0, ['已移除系统自启动；配置、项目和文档保留。需要重新启用时运行 node setup.mjs。']); }
      catch (e) { return finish(1, [`卸载自启动失败：${e.message}`]); }
    }
    return finish(rest[0] === 'status' ? 0 : 1, ['查看运行状态：npm run status；卸载自启：node setup.mjs service uninstall。']);
  } else if (command === 'review') {
    if (!['human', 'auto'].includes(rest[0])) return finish(1, ['请选择 node setup.mjs review human（人工确认）或 auto（独立自动审核）；仅影响新建团队包项目。']);
    updateEnv(envFile, { TEAM_REVIEW_MODE: rest[0] });
    return finish(0, [`新团队包项目默认采用${rest[0] === 'human' ? '人工确认' : '独立自动审核'}；已有项目保持原方式。运行 node setup.mjs 继续。`]);
  } else if (command === 'mode') {
    const selected = rest[0];
    if (!Object.hasOwn(teamModeNames, selected)) return finish(1, ['请选择：node setup.mjs mode basic（启航版）或 node setup.mjs mode projects（领航版）']);
    const current = readEnv(envFile);
    if (serviceRunning() && resolveTeamMode({ root, env: current }) !== selected) return finish(1, ['请等正在执行的步骤结束后 npm stop，再选择版本；原数据会保留']);
    resolveTeamMode({ root, env: { TEAM_MODE: selected } });
    updateEnv(envFile, { TEAM_MODE: selected });
    return finish(0, [`已选择${teamModeNames[selected]}。运行 node setup.mjs 继续；使用已有机器人升级多项目时，再按 docs/prompts/projects.md 补权限和验证发起人身份。`]);
  } else if (command === 'upgrade-projects') {
    if (!depsOk()) return finish(1, ['请先运行 node setup.mjs 安装依赖，再运行 node setup.mjs upgrade-projects']);
    const current = readEnv(envFile);
    if (missingBots(current).includes('product') || !current.FEISHU_PRODUCT_APP_ID || /^cli_x+$/.test(current.FEISHU_PRODUCT_APP_ID)) return finish(1, ['请先配置现有的 AI 产品经理机器人']);
    const f = await d.loadFeishu();
    f.installRetry(f.lark.defaultHttpInstance, { log });
    log('给现有 AI 产品经理增补：记录全部群讨论、读取私聊、项目群成员管理。不创建新机器人。请扫码查看权限差异并确认。');
    const result = await register(f, { lark: f.lark, qrcode: f.qrcode, roles: [{ ...team[0], existingAppId: current.FEISHU_PRODUCT_APP_ID }], qrDir: path.join(root, 'qr'), log,
      save: async (_role, r) => { updateEnv(envFile, { FEISHU_PRODUCT_APP_SECRET: r.appSecret }); saveProgress(root, { projectScopesRequested: true, ...(r.openId ? { ownerOpenId: r.openId } : {}) }); },
    });
    if (result.every(r => r.ok)) updateEnv(envFile, { TEAM_MODE: 'projects' });
    return finish(result.every(r => r.ok) ? 0 : 1, [result.every(r => r.ok) ? '现有机器人授权已更新，并选择领航版。等正在执行的步骤结束后重启本机服务，验证扫码身份和私聊发起人；验证普通群消息入档，权限是否生效以飞书接口检查为准。' : '授权未完成，重新运行 node setup.mjs upgrade-projects 即可。']);
  } else if (command === 'model') {
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
    try { if (p.package) await d.workbenchPackageRetry(portOf(fileEnv), p); else await d.workbenchMessage(portOf(fileEnv), { chatId: p.chatId, role: p.retryRole, text: '重试' }); }
    catch (error) { return finish(1, [`没能接着做：${error.message}`]); }
    return finish(0, [`告诉用户：已让${name}接着做 #${p.number} ${p.name}「${stageNames[p.stage] ?? p.stage}」，去飞书群或工作台 ${workbenchOf(fileEnv)} 看进度卡`]);
  } else if (command && !['scan', 'status'].includes(command)) {
    return finish(1, [`不认识的参数：${command}。可用：node setup.mjs、node setup.mjs mode basic|projects、node setup.mjs upgrade-projects、node setup.mjs scan、node setup.mjs status、node setup.mjs resume <编号>、node setup.mjs model …、node setup.mjs --use-anthropic-env`]);
  }

  const deployment = readDeployment(root);
  if (!deployment || deployment.location === 'remote') return finish(0, deploymentLines(deployment));

  // 先选择代码实际运行位置；服务器模式不能在本机悄悄安装、扫码或启动。
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
  const SCAN_LINE = '然后运行：node setup.mjs scan —— 它会等到扫完（最长 9 分钟）；把命令超时放宽到 10 分钟，或放到后台运行并查看输出；被打断就重跑，已建成的不用再扫';
  // 扫码建机器人：每建成一个立即写进 .env；管理员助手建成后私聊扫码的人报到
  const scan = async roles => {
    feishu ??= await d.loadFeishu();
    feishu.installRetry(feishu.lark.defaultHttpInstance, { log });
    const results = await register(feishu, {
      lark: feishu.lark, qrcode: feishu.qrcode, roles: roles.map(role => ({ ...role, mode: resolveTeamMode({ root, env: readEnv(envFile) }) })), qrDir: path.join(root, 'qr'), log,
      save: async (role, r) => {
        if (role.key === 'admin') {
          if (!r.openId) throw new Error('没拿到扫码人的身份，请用飞书手机版重扫这一张码');
          updateEnv(envFile, { [`${role.prefix}APP_ID`]: r.appId, [`${role.prefix}APP_SECRET`]: r.appSecret, [`${role.prefix}OPEN_ID`]: r.openId });
          try { await feishu.greetAdmin({ client: new feishu.lark.Client({ appId: r.appId, appSecret: r.appSecret, logger: createFeishuLogger({ error: log }) }), openId: r.openId, card: adminIntroCard() }); }
          catch (error) { log(`AI 管理员助手的报到消息没发出去（${error.message}），不影响使用`); }
          return;
        }
        updateEnv(envFile, { [`${role.prefix}APP_ID`]: r.appId, [`${role.prefix}APP_SECRET`]: r.appSecret });
        if (role.key === 'product' && r.openId) saveProgress(root, { ownerOpenId: r.openId });
      },
    });
    return results.filter(r => !r.ok);
  };

  for (let round = 0; round < 10; round += 1) {
    const fileEnv = readEnv(envFile);
    const progress = readProgress(root);
    const stage = nextStage({ env: fileEnv, progress, depsReady: depsOk(), serviceRunning: serviceRunning() });
    if (command === 'status') {
      if (!['done', 'admin'].includes(stage)) return finish(0, ['运行 node setup.mjs 继续']);
      const stuck = await stuckLines(fileEnv);
      const extra = stage === 'admin' ? ['还没建 AI 管理员助手：运行 node setup.mjs 补扫一张码'] : [];
      return finish(0, stuck.length || extra.length ? [...stuck, ...extra] : ['都好了，不用再做什么']);
    }

    if (['service', 'admin', 'done'].includes(stage) && !d.managedService(root)) {
      try {
        const installed = await d.installBackground(root);
        serviceStarted = false;
        log(`✓ 已安装系统常驻服务：${installed.scope}；异常退出将自动拉起。`);
        if (installed.platform === 'linux' && !installed.linger) log('尚未启用开机用户服务：在运行账号下执行 loginctl enable-linger，再检查 loginctl show-user "$USER" -p Linger；失败时由系统管理员授权。');
      } catch (error) { return finish(1, [`常驻服务尚未装好：${error.message}`, '保留现有配置，处理后重新运行 node setup.mjs；不要把临时后台运行说成已启用自启动。']); }
      continue;
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
      // 第一次搭建时 3 个同事和管理员助手一起扫（4 张码）
      const roles = [...missingBots(fileEnv), ...(missingAdmin(fileEnv) ? [admin] : [])];
      if (command !== 'scan') return finish(0, [
        `接下来扫码创建飞书机器人（还差：${roles.map(r => r.name).join('、')}）`,
        `先告诉用户：马上会在浏览器里弹出二维码页面，请用飞书手机版逐个扫码，并在手机上确认创建（大约 1 分钟）${roles.includes(admin) ? '；AI 管理员助手只在私聊里帮扫码的人照看团队，扫它的人就是管理员' : ''}`,
        SCAN_LINE,
      ]);
      const failed = await scan(roles);
      if (failed.length) return finish(0, [`还有 ${failed.length} 个没建成：${failed.map(f => `${f.role.name}（${why(f.error)}）`).join('、')}`, '重跑 node setup.mjs scan 会给没建成的出新码，已建成的不用再扫']);
      continue;
    }
    if (stage === 'group') {
      await ensurePort(fileEnv);
      feishu ??= await d.loadFeishu();
      const appIds = Object.fromEntries(team.map(r => [r.key, fileEnv[`${r.prefix}APP_ID`]]));
      const clients = Object.fromEntries(team.map(r => [r.key, new feishu.lark.Client({ appId: fileEnv[`${r.prefix}APP_ID`], appSecret: fileEnv[`${r.prefix}APP_SECRET`], logger: createFeishuLogger({ error: log }) })]));
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
    if (stage === 'admin') {
      if (command !== 'scan') return finish(0, [
        ...await stuckLines(fileEnv),
        '接下来扫最后一张码，创建 AI 管理员助手：它只在飞书私聊里帮扫码的人照看团队（看现状、提醒停下的项目、重启服务），扫码的人就是管理员',
        '先告诉用户：马上会在浏览器里弹出二维码页面，请用飞书手机版扫码，并在手机上确认创建',
        SCAN_LINE,
      ]);
      const failed = await scan([admin]);
      if (failed.length) return finish(0, [`AI 管理员助手没建成（${why(failed[0].error)}）`, '重跑 node setup.mjs scan 会出一张新码']);
      // 团队服务要重启一次，管理员助手才会上线；有项目在干活就不打断它
      const busy = (await d.workbenchState(portOf(fileEnv)))?.projects?.filter(p => p.busy) ?? [];
      const later = '告诉用户：AI 管理员助手建好了。团队服务要重启一次，之后才能在飞书私聊里找到它；';
      if (busy.length) return finish(0, [`${later}${busy.map(p => `#${p.number} ${p.name}`).join('、')}正在干活，等这一步做完后运行 npm stop && npm start`]);
      // 这次刚起的服务却查不到进程（比如沙箱里看不到）：不冒险再起一份，请用户自己重启
      if (!d.serviceStatus(root).running) return finish(0, [`${later}请用户运行 npm stop && npm start`]);
      const stopped = await d.stopService(root);
      if (stopped.denied) return finish(0, [`${later}请用户在自己的终端里进入项目目录运行 npm stop && npm start（助手这里没有权限停止团队服务）`]);
      const r = await d.startService(root);
      if (!r.ok) return finish(1, [`团队服务没起来：${r.error}`, '日志在 data/service.log；修好后运行 npm start']);
      serviceStarted = true;
      log('✓ 已重启团队服务，可以私聊 AI 管理员助手了');
      continue;
    }
    if (d.managedService(root)?.platform === 'linux' && !d.lingerStatus()) return finish(0, [
      '团队服务已启动，但开机自启动尚未完成：在服务运行账号下执行 loginctl enable-linger，再运行 node setup.mjs。',
      '如果系统拒绝此操作，请系统管理员为该账号启用 linger。不要把“登录后能跑”当作“开机后无人登录也能跑”。',
    ]);
    return finish(0, [
      ...await stuckLines(fileEnv),
      '都好了。告诉用户：',
      resolveTeamMode({ root, env: fileEnv }) === 'projects'
        ? '1. 私聊产品经理提需求并确认开工，它会新建独立项目群；工作台从可信扫码记录识别发起人。已有机器人需补权限时运行 node setup.mjs upgrade-projects。'
        : '1. 打开飞书群「AI 团队」，@AI 产品经理 说一句需求，比如“做一个记录读书笔记的小网页”；它回一张“要开始做吗？”卡片，点“就按这个开始”后在原群开工，之后按卡片提示点按钮',
      progress.ownerSet ? null : progress.joinLink ? `   还不在群里的话，先打开这个链接进群：${progress.joinLink}` : '   还不在群里的话：在飞书里新建一个群，把 3 个机器人拉进来（群设置 → 群机器人 → 添加机器人）',
      `2. 本机工作台：${workbenchOf(readEnv(envFile))}`,
      '3. 飞书里私聊「AI 管理员助手」：发“状态”看团队现状；项目停下、团队服务出问题时它会私聊提醒',
      !fileEnv.TEAM_REVIEW_MODE ? '首次启用团队包前，请问用户采用人工确认（推荐）还是自动审核；运行 node setup.mjs review human 或 auto。基础版原有四个关口保持人工确认。' : null,
      '4. 想改某个角色或技能，直接说（照 AGENTS.md「改角色和技能」改）',
      '停止服务 npm stop；查看状态 npm run status',
    ]);
  }
  return finish(1, ['流程没有推进，请把上面的输出告诉维护者']);
}
