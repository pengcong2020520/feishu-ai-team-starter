// 管家：AI 管理员助手背后的智能体。只有一个持续的会话（会话号存在 data/admin/session.json，重启后接着用），
// 能看整个仓库（密钥除外），只能改工作副本 .admin-work/，没有命令行；调度同事、交改动、重启、回退都走固定工具
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { acquireCapacity } from '../agents/capacity.mjs';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { classify, WORK_DIR } from './changes.mjs';

export const STEWARD_TIMEOUT_MS = 15 * 60000;
const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const WRITE_TOOLS = ['Write', 'Edit'];
// 密钥和别人的配置：看都不能看
const SECRET = [/^\.env/, /(^|\/)\.env[^/]*$/, /^data\/model-key\.txt$/, /^\.claude-agent-config(\/|$)/, /^qr(\/|$)/];

const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
async function resolved(target) {
  const tail = [];
  let current = target;
  while (true) {
    try { await lstat(current); return path.resolve(await realpath(current), ...tail.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}
const deny = message => ({ behavior: 'deny', message });

export async function stewardPermission(root, tool, input = {}, readOnly = false) {
  if (tool === 'StructuredOutput' || tool.startsWith('mcp__admin__')) {
    if (readOnly && !['mcp__admin__team_status', 'mcp__admin__ask_colleague', 'StructuredOutput'].includes(tool)) return deny('这次只查不改');
    return { behavior: 'allow' };
  }
  if (![...READ_TOOLS, ...WRITE_TOOLS].includes(tool)) return deny('这个工具不能用');
  if (readOnly && WRITE_TOOLS.includes(tool)) return deny('这次只查不改');
  if (tool === 'Glob' && (typeof input.pattern !== 'string' || path.isAbsolute(input.pattern) || input.pattern.split(/[\\/]/).includes('..') || /\.env/.test(input.pattern))) return deny('搜索范围越界');
  if (tool === 'Grep' && /\.env|model-key/.test(`${input.glob ?? ''} ${input.path ?? ''}`)) return deny('不能搜密钥文件');
  const supplied = tool === 'Read' || WRITE_TOOLS.includes(tool) ? input.file_path : (input.path ?? '.');
  if (typeof supplied !== 'string' || !supplied) return deny('缺少文件路径');
  const real = realpathSync(root);
  const target = await resolved(path.resolve(root, supplied));
  if (!inside(real, target)) return deny('文件超出仓库');
  const rel = path.relative(real, target).split(path.sep).join('/');
  // Grep 不许从仓库根目录或 data 整个搜：指定 src、data/messages 之类的子目录
  if (tool === 'Grep' && (rel === '' || rel === 'data')) return deny('请指定更具体的子目录，比如 src、prompts、data/messages');
  if (SECRET.some(rule => rule.test(rel))) return deny('密钥和配置文件不能看');
  if (WRITE_TOOLS.includes(tool)) {
    if (!rel.startsWith(`${WORK_DIR}/`)) return deny(`只能改工作副本 ${WORK_DIR}/ 里的文件`);
    const inWork = rel.slice(WORK_DIR.length + 1);
    if (inWork.startsWith('.git')) return deny('不能改 git 的文件');
    const { blocked } = classify([inWork]);
    if (blocked.length) return deny(`${inWork} 在禁区或不能改的地方：需要改的话写一段开发任务交给管理员`);
  }
  return { behavior: 'allow' };
}

export function stewardActivity({ tool, input = {} }, root) {
  const rel = value => { const text = String(value ?? ''); return (path.isAbsolute(text) ? path.relative(root, text) : text).replace(/[*`<>\[\]]/g, ''); };
  const names = { product: 'AI 产品经理', designer: 'AI 设计', developer: 'AI 程序员' };
  switch (tool) {
    case 'Read': return `📖 在看 ${rel(input.file_path)}`;
    case 'Glob': return '🔍 在找文件';
    case 'Grep': return '🔍 在搜仓库';
    case 'Write': case 'Edit': return `✏️ 在改 ${rel(input.file_path).replace(`${WORK_DIR}/`, '')}`;
    case 'mcp__admin__team_status': return '📋 在看团队现状';
    case 'mcp__admin__ask_colleague': return `💬 在问${names[input.role] ?? '同事'}`;
    case 'mcp__admin__tell_colleague': return `📨 在代你给${names[input.role] ?? '同事'}发话`;
    case 'mcp__admin__press_button': return '👆 在代你点按钮';
    case 'mcp__admin__submit_change': return '🧪 在检查、测试改动';
    case 'mcp__admin__restart_team': return '🔄 在重启团队服务';
    case 'mcp__admin__revert_change': return '↩️ 在撤销改动';
    default: return '💭 在思考';
  }
}

// 干活时的输入通道：管理员插话以 priority 'now' 插进当前这一步；第一个结果到了就关上
function inputChannel(prompt) {
  const inbox = [];
  let wake = null;
  let closed = false;
  const notify = () => { const fn = wake; wake = null; fn?.(); };
  return {
    async *messages() {
      yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
      while (true) {
        while (inbox.length) yield inbox.shift();
        if (closed) return;
        await new Promise(resolve => { wake = resolve; });
      }
    },
    push(text) {
      if (closed) return false;
      inbox.push({ type: 'user', message: { role: 'user', content: `管理员在你干活时插话：${text}` }, parent_tool_use_id: null, priority: 'now' });
      notify();
      return true;
    },
    close() { closed = true; notify(); },
  };
}

export function createSteward({ root, tools = [], queryImpl = query, createServer = createSdkMcpServer }) {
  const sessionFile = path.join(root, 'data/admin/session.json');
  const readSession = () => { try { return JSON.parse(readFileSync(sessionFile, 'utf8')).sessionId ?? null; } catch { return null; } };
  const writeSession = sessionId => {
    mkdirSync(path.dirname(sessionFile), { recursive: true });
    writeFileSync(`${sessionFile}.tmp`, `${JSON.stringify({ sessionId, at: new Date().toISOString() })}\n`);
    renameSync(`${sessionFile}.tmp`, sessionFile);
  };

  return {
    async run({ prompt, onProgress, control, readOnly = false, timeoutMs = STEWARD_TIMEOUT_MS }) {
      const started = Date.now();
      const stats = { turns: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 };
      const abortController = new AbortController();
      let timedOut = false;
      let stopped = false;
      let timer, release;
      const channel = inputChannel(prompt);
      let running = null;
      if (control) {
        control.steer = text => channel.push(text);
        control.stop = async () => {
          if (stopped) return;
          stopped = true;
          channel.close();
          try { if (typeof running?.interrupt === 'function') await running.interrupt(); else abortController.abort(); } catch { abortController.abort(); }
        };
      }
      const resume = readSession();
      try {
        for (const name of ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']) if (!process.env[name]) throw new Error(`缺少配置：${name}`);
        if (queryImpl === query) release = await acquireCapacity({ root, role: 'admin', signal: abortController.signal, onQueued: waiting => { if (waiting) onProgress?.({ tool: '等待执行名额', input: {} }); } });
        abortController.signal.throwIfAborted();
        timer = setTimeout(() => { timedOut = true; abortController.abort(); }, timeoutMs);
        const configDir = path.join(root, '.claude-agent-config');
        mkdirSync(configDir, { recursive: true });
        const check = (tool, input) => stewardPermission(root, tool, input, readOnly);
        const options = {
          systemPrompt: { type: 'custom', prompt: readFileSync(path.join(root, 'src/admin/prompt.md'), 'utf8') },
          tools: readOnly ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS],
          mcpServers: { admin: createServer({ name: 'admin', version: '1.0.0', alwaysLoad: true, tools }) },
          canUseTool: check,
          hooks: { PreToolUse: [{ hooks: [async input => {
            const decision = await check(input.tool_name, input.tool_input ?? {});
            return decision.behavior === 'allow' ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.message } };
          }], onFailure: 'block' }] },
          settingSources: [],
          cwd: root,
          abortController,
          model: process.env.MODEL_NAME,
          maxTurns: 60,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: configDir,
            ANTHROPIC_BASE_URL: process.env.MODEL_BASE_URL,
            ANTHROPIC_AUTH_TOKEN: process.env.MODEL_API_KEY,
            CLAUDE_CONFIG_DIR: configDir,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.MODEL_NAME,
          },
          ...(resume ? { resume } : {}),
        };
        let result = null;
        let sessionId = null;
        running = queryImpl({ prompt: channel.messages(), options });
        for await (const message of running) {
          if (message.session_id && message.session_id !== sessionId) { sessionId = message.session_id; writeSession(sessionId); }
          if (message.type === 'assistant') for (const block of message.message?.content ?? []) if (block.type === 'tool_use') onProgress?.({ tool: block.name, input: block.input ?? {} });
          if (message.type === 'result') { result = message; channel.close(); }
        }
        if (timedOut) throw new Error('timeout');
        if (stopped && !(result?.subtype === 'success' && !result.is_error)) throw new Error('stopped');
        if (!result) throw new Error('智能体没有返回结果');
        stats.turns = result.num_turns ?? 0;
        stats.durationMs = result.duration_ms ?? Date.now() - started;
        const usages = Object.values(result.modelUsage ?? {});
        stats.inputTokens = usages.reduce((sum, u) => sum + (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0) || (result.usage?.input_tokens ?? 0);
        stats.outputTokens = usages.reduce((sum, u) => sum + (u.outputTokens ?? 0), 0) || (result.usage?.output_tokens ?? 0);
        if (result.subtype === 'success' && !result.is_error) return { ok: true, text: result.result ?? '', stats };
        return { ok: false, text: '', error: (result.errors ?? []).join('；') || result.subtype, stats };
      } catch (error) {
        stats.durationMs = Date.now() - started;
        if (timedOut) return { ok: false, text: '', error: `超过 ${Math.round(timeoutMs / 60000)} 分钟没做完`, timedOut: true, stats };
        if (stopped) return { ok: false, text: '', error: '你让它停下了', stopped: true, stats };
        // 续不上旧会话（会话文件丢了）：下次从新会话开始
        if (resume && /conversation|session/i.test(error.message)) { try { writeSession(null); } catch {} }
        return { ok: false, text: '', error: error.message, stats };
      } finally {
        clearTimeout(timer);
        await release?.();
        channel.close();
        if (control) control.steer = () => false;
      }
    },
  };
}

