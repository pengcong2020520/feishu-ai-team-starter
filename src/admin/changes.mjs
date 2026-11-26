// 管家改东西：只在工作副本（.admin-work，git worktree）里改，由代码按固定顺序检查、提交、测试、上线、回退。
// 每次改动在工作副本里压成一个提交（作者“AI 管理员助手”），线上目录只做快进合并和 git revert，只提交在本地、不推送
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORK_DIR = '.admin-work';
// 文字类：改了下次干活就生效，测试过了直接上线
export const TEXT_AREAS = ['prompts/', 'team-skills/', 'docs/'];
// 代码类：要管理员签字，上线后重启团队服务
export const CODE_AREAS = ['src/', 'web/', 'test/'];
// 禁区：工作模式、权限和密钥、管家自己、依赖和部署、运行数据。碰到一个，整次改动作废
export const FORBIDDEN = ['src/flow/stages.mjs', 'src/agents/run.mjs', 'src/setup/', 'src/admin/', 'setup.mjs', '.env', 'package.json', 'package-lock.json', 'Dockerfile', 'compose.yaml', '.github/', 'data/', 'workspace/'];
const AUTHOR = ['-c', 'user.name=AI 管理员助手', '-c', 'user.email=admin-assistant@localhost'];
export const MAX_TRIES = 3;

const under = (file, rule) => rule.endsWith('/') ? file.startsWith(rule) : rule === '.env' ? file.startsWith('.env') : file === rule;
export function classify(files) {
  const blocked = files.filter(f => FORBIDDEN.some(rule => under(f, rule)) || ![...TEXT_AREAS, ...CODE_AREAS].some(area => under(f, area)));
  if (blocked.length || !files.length) return { level: null, blocked };
  return { level: files.every(f => TEXT_AREAS.some(area => under(f, area))) ? 'text' : 'code', blocked: [] };
}

export function exec(cmd, args, { cwd, env, timeoutMs = 60000 } = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, env, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut: Boolean(error?.killed) });
    });
  });
}

// 测试输出很长：只留失败的部分和最后的汇总，交给管家或卡片
export function testSummary(output) {
  const lines = output.split('\n');
  const failed = lines.filter(line => /^✖|not ok|AssertionError|Error:/.test(line.trim())).slice(0, 30);
  const tail = lines.filter(line => /^ℹ (tests|pass|fail)/.test(line.trim()));
  return [...failed, ...tail].join('\n').slice(0, 3000) || output.slice(-3000);
}

export function createChanges({ root, runTests: runTestsImpl } = {}) {
  const work = path.join(root, WORK_DIR);
  const file = path.join(root, 'data/admin/changes.json');
  const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { pending: null, history: [], tries: 0 }; } };
  let state = load();
  const save = () => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`); renameSync(`${file}.tmp`, file); };
  const git = (cwd, args, opts) => exec('git', args, { cwd, ...opts });
  const must = async (cwd, args) => {
    const r = await git(cwd, args);
    if (r.code) throw new Error(`git ${args.find(a => !a.startsWith('-') && !a.includes('=')) ?? ''} 没成功：${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    return r.stdout.trim();
  };
  const liveHead = () => must(root, ['rev-parse', 'HEAD']);
  // 线上目录里别人改了还没提交的文件（不算没纳入 git 的新文件）
  const dirtyFiles = async () => (await git(root, ['status', '--porcelain', '--untracked-files=no'])).stdout.split('\n').filter(Boolean).map(line => line.slice(3));
  // 只在确认是自己的工作副本时才丢弃改动
  const ownWork = async () => {
    const top = (await git(work, ['rev-parse', '--show-toplevel'])).stdout.trim();
    return top && realpathSync(top) === realpathSync(work);
  };
  const discard = async () => {
    if (!existsSync(work) || !await ownWork()) return;
    await must(work, ['reset', '-q', '--hard', await liveHead()]);
    await must(work, ['clean', '-fdq']);
  };
  const runTests = runTestsImpl ?? (async cwd => {
    // 测试在干净的环境变量里跑：不带飞书和模型密钥
    const r = await exec(process.execPath, ['--test', '--test-timeout=60000', 'test/*.test.mjs'], { cwd, env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8' }, timeoutMs: 600000 });
    return { ok: r.code === 0, output: `${r.stdout}\n${r.stderr}`, timedOut: r.timedOut };
  });

  const api = {
    work,
    state: () => structuredClone(state),

    // 管家开工前：确保有工作副本；工作副本没有改动、线上又往前走了，就跟上线上
    async ensure() {
      if ((await exec('git', ['--version'])).code) throw new Error('这台机器上没有 git，管家没法改东西');
      if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).code) throw new Error('这个目录不是 git 仓库，管家没法改东西');
      if (!existsSync(path.join(work, '.git'))) {
        await git(root, ['worktree', 'prune']);
        await must(root, ['worktree', 'add', '--detach', '-q', WORK_DIR, 'HEAD']);
      }
      const head = await liveHead();
      const clean = !(await must(work, ['status', '--porcelain']));
      if (clean && !state.pending && (await must(work, ['rev-parse', 'HEAD'])) !== head) await must(work, ['checkout', '-q', '--detach', head]);
    },

    // 交改动：算出相对线上的全部改动 → 禁区检查 → 定级别 → 压成一个提交
    async prepare({ title, why }) {
      await api.ensure();
      if (state.pending && ['testing', 'waiting', 'going'].includes(state.pending.status)) return { ok: false, error: `上一次改动「${state.pending.title}」正在${state.pending.status === 'testing' ? '跑测试' : '等上线'}，等它处理完再交` };
      const head = await liveHead();
      await must(work, ['add', '-A']);
      await must(work, ['reset', '-q', '--soft', head]);
      const files = (await must(work, ['diff', '--cached', '--name-only', head])).split('\n').filter(Boolean);
      if (!files.length) return { ok: false, error: '工作副本里没有改动' };
      const { level, blocked } = classify(files);
      if (!level) {
        await discard();
        state.pending = null; state.tries = 0; save();
        return { ok: false, blocked, error: `改动碰到了不能改的地方：${blocked.join('、')}。这次改动已整个作废。需要改这些的，写一段开发任务（问题、证据、建议改法、怎么验证）交给管理员，转给本机的 AI 编程助手` };
      }
      await must(work, [...AUTHOR, 'commit', '-q', '--no-verify', '-m', `管理员助手：${title}\n\n${why}`]);
      const sha = await must(work, ['rev-parse', 'HEAD']);
      const stat = await must(work, ['diff', '--stat', head, sha]);
      return { ok: true, sha, base: head, files, level, title, why, stat };
    },

    // 跑测试；没过就把提交拆回成改动，管家能接着改
    async test(change) {
      const r = await runTests(work);
      if (r.ok) { state.tries = 0; save(); return { ok: true }; }
      state.tries = (state.tries ?? 0) + 1;
      save();
      await git(work, ['reset', '-q', '--soft', change.base]);
      return { ok: false, timedOut: r.timedOut, summary: testSummary(r.output), tries: state.tries, giveUp: state.tries >= MAX_TRIES };
    },

    setPending(pending) { state.pending = pending; save(); },
    clearPending() { state.pending = null; save(); },
    // 签字只对这一次提交有效：工作副本在那之后又变了就不算
    async stillSigned(sha) {
      if (state.pending?.sha !== sha) return false;
      return (await must(work, ['rev-parse', 'HEAD'])) === sha && !(await must(work, ['status', '--porcelain']));
    },

    // 上线：线上目录没有别人的改动、能快进，才合并
    async merge(change) {
      const dirty = await dirtyFiles();
      if (dirty.length) return { ok: false, error: `线上目录有没提交的改动（${dirty.slice(0, 5).join('、')}），先处理掉再上线` };
      const r = await git(root, ['merge', '-q', '--ff-only', change.sha]);
      if (r.code) return { ok: false, error: '线上代码在这期间变了，没法直接合并；请让管家按现在的线上代码重新改一次' };
      state.history = [...(state.history ?? []), { sha: change.sha, title: change.title, level: change.level, files: change.files, at: new Date().toISOString() }].slice(-50);
      state.pending = null;
      save();
      return { ok: true };
    },

    lastChange: () => [...(state.history ?? [])].reverse().find(c => !c.revertedBy) ?? null,
    find: sha => (state.history ?? []).find(c => c.sha === sha) ?? null,

    // 回退：在线上目录 git revert 这次提交（作者也是管理员助手）
    async revert(change) {
      if ((await dirtyFiles()).length) return { ok: false, error: '线上目录有没提交的改动，先处理掉再回退' };
      const r = await git(root, [...AUTHOR, 'revert', '--no-edit', change.sha]);
      if (r.code) {
        await git(root, ['revert', '--abort']);
        return { ok: false, error: `git revert 冲突了（之后的改动动过同样的地方），没有回退：${(r.stderr || r.stdout).trim().slice(0, 200)}` };
      }
      const entry = state.history.find(c => c.sha === change.sha);
      if (entry) entry.revertedBy = await liveHead();
      save();
      // 工作副本没有正在改的东西，就跟上线上
      if (!state.pending && !(await must(work, ['status', '--porcelain']).catch(() => 'x'))) await git(work, ['checkout', '-q', '--detach', await liveHead()]);
      return { ok: true };
    },

    discard: async () => { await discard(); state.pending = null; state.tries = 0; save(); },
  };
  return api;
}
