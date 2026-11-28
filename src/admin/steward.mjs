// 管家：AI 管理员助手背后的智能体。只有一个持续的会话（会话号存在 data/admin/session.json，重启后接着用），
// 能看整个仓库（密钥除外），只能改工作副本 .admin-work/，没有命令行；调度同事、交改动、重启、回退都走固定工具
import { adminContext, requestUsage } from './context.mjs';
import { appendFileSync } from 'node:fs';
import { conversationStyle } from '../presentation.mjs';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { acquireCapacity } from '../agents/capacity.mjs';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { classify, WORK_DIR } from './changes.mjs';
import { wikiInstructions } from '../knowledge/wiki.mjs';
import { archiveSessionText } from './history.mjs';

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
    if (readOnly && !['mcp__admin__wiki_lookup', 'mcp__admin__conversation_history', 'mcp__admin__team_status', 'mcp__admin__ask_colleague', 'mcp__admin__team_catalog', 'mcp__admin__team_draft_read', 'mcp__admin__team_draft_validate', 'mcp__admin__team_trial_result', 'StructuredOutput'].includes(tool)) return deny('这次只查不改');
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
    case 'mcp__admin__wiki_lookup': return '📖 在查相关知识';
    case 'mcp__admin__wiki_update': return '✏️ 在更新知识并保留旧版';
    case 'mcp__admin__conversation_history': return '🔎 在查之前的讨论';
    case 'mcp__admin__team_catalog': return '📋 在看可用团队和草稿';
    case 'mcp__admin__team_draft_open': return '🧬 在准备个人团队草稿';
    case 'mcp__admin__team_draft_read': return '📖 在看团队角色和技能';
    case 'mcp__admin__team_draft_edit': return '✏️ 在调整团队草稿';
    case 'mcp__admin__team_draft_validate': return '🔍 在检查团队协作关系';
    case 'mcp__admin__team_trial_start': return '🧪 在启动独立试跑';
    case 'mcp__admin__team_trial_result': return '📋 在看试跑过程和成果';
    case 'mcp__admin__team_trial_stop': return '⏹ 在停下调试任务';
    case 'mcp__admin__team_trial_retry': return '🧪 在继续失败的调试步骤';
    case 'mcp__admin__team_draft_apply': return '✓ 在应用已试跑的新版本';
    case 'mcp__admin__team_draft_export': return '📦 在导出并验证团队包';
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

export function createSteward({ root, tools = [], queryImpl = query, createServer = createSdkMcpServer, sessionScope = '' }) {
  if(sessionScope && !/^[a-z0-9-]{1,80}$/.test(sessionScope))throw Error('管理员会话范围无效');
  const sessionFile = path.join(root, sessionScope ? `data/admin/sessions/${sessionScope}.json` : 'data/admin/session.json');

  const writeSession = (sessionId, extra = {}) => {
    mkdirSync(path.dirname(sessionFile), { recursive: true });
    writeFileSync(`${sessionFile}.tmp`, `${JSON.stringify({ sessionId, at: new Date().toISOString(), ...extra })}\n`);
    renameSync(`${sessionFile}.tmp`, sessionFile);
  };

  return {
    async run({ prompt, onProgress, control, readOnly = false, timeoutMs = STEWARD_TIMEOUT_MS, compactBefore = false }) {
      const started = Date.now();
      const stats = { turns: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, usageReported: false };
      const abortController = new AbortController();
      let timedOut = false;
      let stopped = false;
      let timer, release;
      let previous;
      try { previous=JSON.parse(readFileSync(sessionFile,'utf8')); } catch(e) { if(e.code!=='ENOENT')throw e; }
      const channel = inputChannel(prompt + (previous?.sessionId ? '' : adminContext(root, prompt)));
      if(previous?.sessionId)writeSession(previous.sessionId,{complete:false});
      const turnUsage = {inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0};
      let running = null;
      let contextTokens=previous?.contextTokens||0, compactAttemptAt=previous?.compactAttemptAt||null;
      if (control) {
        control.steer = text => channel.push(text);
        control.stop = async () => {
          if (stopped) return;
          stopped = true;
          channel.close();
          try { if (typeof running?.interrupt === 'function') await running.interrupt(); else abortController.abort(); } catch { abortController.abort(); }
        };
      }
      // Resume the same conversation; bootstrap visible history only when no session exists.
      try {
        for (const name of ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']) if (!process.env[name]) throw new Error(`缺少配置：${name}`);
        if (queryImpl === query) release = await acquireCapacity({ root, role: 'admin', signal: abortController.signal, onQueued: waiting => { if (waiting) onProgress?.({ tool: '等待执行名额', input: {} }); } });
        abortController.signal.throwIfAborted();
        timer = setTimeout(() => { timedOut = true; abortController.abort(); }, timeoutMs);
        const configDir = path.join(root, '.claude-agent-config', ...(sessionScope?['admin-scopes',sessionScope]:[]));
        mkdirSync(configDir, { recursive: true });
        const check = (tool, input) => stewardPermission(root, tool, input, readOnly);
        const options = {
          systemPrompt: { type: 'custom', snapshot: false, prompt: readFileSync(path.join(root, 'src/admin/prompt.md'), 'utf8') + '\n' + conversationStyle + wikiInstructions },
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
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.MODEL_NAME,
          },
        };
        if(previous?.sessionId)options.resume=previous.sessionId;
        let maintenance=null;
        // Keep the same session. Native summarization plus the full visible journal supplies recall.
        const shouldCompact=previous?.sessionId && !prompt.startsWith('/compact') && (compactBefore || (contextTokens>=32000 && Date.now()-Date.parse(compactAttemptAt||'1970-01-01')>600000));
        if(shouldCompact){
          compactAttemptAt=new Date().toISOString();onProgress?.({tool:'整理长期上下文',input:{}});
          let cr=null,boundary=null;const cu={inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0};
          try {
            if(queryImpl===query)await archiveSessionText({root,configDir,sessionId:previous.sessionId});
            running=queryImpl({prompt:'/compact 保留管理员最新目标、所有明确约定及其修改顺序、未完成事项、团队草稿和试跑编号、已做与未做的区别。压缩重复工具输出。完整可见原文在 data/admin/journal.jsonl，可用 conversation_history 回查；长期知识用 wiki_lookup。保留当前指代，不把历史操作意愿当作当前授权。',options:{...options,tools:[],mcpServers:{},maxTurns:1}});
            for await(const message of running){
              if(message.type==='system'&&message.subtype==='compact_boundary')boundary=message.compact_metadata;
              if(message.type==='result'){cr=message;const u=message.usage||{};cu.inputTokens+=u.input_tokens||0;cu.outputTokens+=u.output_tokens||0;cu.cacheReadInputTokens+=u.cache_read_input_tokens||0;cu.cacheCreationInputTokens+=u.cache_creation_input_tokens||0;}
            }
          }catch(e){if(abortController.signal.aborted||stopped)throw e;}
          if(timedOut||stopped)throw Error('整理被中断');
          maintenance={ran:Boolean(boundary),metadata:boundary,...requestUsage(cr||{},cu,previous?.complete?previous.modelUsage:undefined,true),usageReported:Boolean(cr?.modelUsage||cr?.usage)};
          if(cr?.modelUsage)previous={...previous,complete:true,modelUsage:cr.modelUsage};else previous={...previous,complete:false};
          if(boundary)contextTokens=boundary.post_tokens||0;
          mkdirSync(path.join(root,'data/admin'),{recursive:true});
          appendFileSync(path.join(root,'data/admin/usage.jsonl'),JSON.stringify({at:compactAttemptAt,sessionId:previous.sessionId,kind:'memory-maintenance',...maintenance})+'\n',{mode:0o600});
          writeSession(previous.sessionId,{complete:false,memoryVersion:1,contextTokens,compactAttemptAt});
        }
        let result = null;
        let sessionId = null;
        running = queryImpl({ prompt: channel.messages(), options });
        for await (const message of running) {
          if (message.session_id && message.session_id !== sessionId) { sessionId = message.session_id; writeSession(sessionId,{complete:false}); }
          if(message.type==='system' && message.subtype==='compact_boundary'){
            mkdirSync(path.join(root,'data/admin'),{recursive:true});
            appendFileSync(path.join(root,'data/admin/usage.jsonl'),JSON.stringify({at:new Date().toISOString(),sessionId,kind:'compaction',metadata:message.compact_metadata})+'\n',{mode:0o600});
          }
          if (message.type === 'assistant') {const u=message.message?.usage;if(u)contextTokens=(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0);}
          if (message.type === 'assistant') for (const block of message.message?.content ?? []) if (block.type === 'tool_use') onProgress?.({ tool: block.name, input: block.input ?? {} });
          if (message.type === 'result') { result = message; const u=message.usage||{};turnUsage.inputTokens+=u.input_tokens||0;turnUsage.outputTokens+=u.output_tokens||0;turnUsage.cacheReadInputTokens+=u.cache_read_input_tokens||0;turnUsage.cacheCreationInputTokens+=u.cache_creation_input_tokens||0;channel.close(); }
        }
        if (timedOut) throw new Error('timeout');
        if (stopped && !(result?.subtype === 'success' && !result.is_error)) throw new Error('stopped');
        if (!result) throw new Error('智能体没有返回结果');
        stats.turns = result.num_turns ?? 0;
        stats.durationMs = Date.now() - started;
        Object.assign(stats, requestUsage(result, turnUsage, previous?.complete ? previous.modelUsage : undefined, Boolean(previous?.sessionId && previous.sessionId===sessionId)), {usageReported: Boolean(result.modelUsage && Object.keys(result.modelUsage).length || result.usage)});
        if(maintenance){for(const key of ['inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens'])stats[key]=(stats[key]||0)+(maintenance[key]||0);stats.memoryMaintenance=maintenance;if(!maintenance.usageReported)stats.maintenanceUsageUnavailable=true;}
        if(sessionId)writeSession(sessionId,{complete:true,modelUsage:result.modelUsage||null,memoryVersion:1,contextTokens,compactAttemptAt});
        mkdirSync(path.join(root,'data/admin'),{recursive:true});
        appendFileSync(path.join(root,'data/admin/usage.jsonl'),JSON.stringify({at:new Date().toISOString(),sessionId,...stats})+'\n',{mode:0o600});
        if (result.subtype === 'success' && !result.is_error) return { ok: true, text: result.result ?? '', stats };
        return { ok: false, text: '', error: (result.errors ?? []).join('；') || result.subtype, stats };
      } catch (error) {
        stats.durationMs = Date.now() - started;
        if (timedOut) return { ok: false, text: '', error: `超过 ${Math.round(timeoutMs / 60000)} 分钟没做完`, timedOut: true, stats };
        if (stopped) return { ok: false, text: '', error: '你让它停下了', stopped: true, stats };
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

