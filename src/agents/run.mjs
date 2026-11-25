import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roles } from './roles.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tools = ['Read', 'Write', 'Edit', 'Glob', 'Skill'];
// 对话模式：群里 @ 角色时用，只读不写、不用技能，按固定格式返回“回复 + 提议”
const chatTools = ['Read', 'Glob'];
export const chatSchema = {
  type: 'object', additionalProperties: false, required: ['reply', 'proposal'],
  properties: {
    reply: { type: 'string', description: '发到群里的回复：纯文本，120 字以内' },
    proposal: {
      type: 'object', additionalProperties: false, required: ['action', 'detail'],
      properties: {
        action: { type: 'string', enum: ['none', 'start', 'revise', 'answer', 'retry', 'end'] },
        detail: { type: 'string', description: 'start 写一句话需求；revise 写要改什么；answer 写用户的回答；其余可留空' },
      },
    },
  },
};

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function resolvedTarget(target) {
  let ancestor = target;
  const tail = [];
  while (true) {
    try {
      await lstat(ancestor);
      return path.resolve(await realpath(ancestor), ...tail.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function denied(message) { return { behavior: 'deny', message }; }

async function permissionFor(role, projectDir, tool, input, allowed = tools) {
  // 对话模式按固定格式回复时，SDK 让模型调用 StructuredOutput 工具交结果，要放行
  if (tool === 'StructuredOutput' && allowed === chatTools) return { behavior: 'allow' };
  if (!allowed.includes(tool)) return denied('工具不在白名单中');
  if (tool === 'Skill') {
    return roles[role].skills.includes(input.skill) ? { behavior: 'allow' } : denied('此角色不能使用该技能');
  }
  if (tool === 'Glob') {
    const pattern = input.pattern;
    if (typeof pattern !== 'string' || path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) return denied('搜索范围越界');
  }
  const supplied = tool === 'Glob' ? (input.path ?? '.') : input.file_path;
  if (typeof supplied !== 'string' || !supplied) return denied('缺少文件路径');
  if (supplied.split(/[\\/]/).includes('..')) return denied('路径不能包含 ..');
  const project = await realpath(projectDir);
  const target = await resolvedTarget(path.resolve(projectDir, supplied));
  if (!inside(project, target)) return denied('文件超出项目目录');
  if ((tool === 'Write' || tool === 'Edit') && !inside(path.join(project, roles[role].writeDir), target)) {
    return denied('不能写其他角色的目录');
  }
  return { behavior: 'allow' };
}

function progressFrom(block, projectDir) {
  const tool = block.name;
  const input = block.input ?? {};
  let file = tool === 'Skill' ? input.skill : (input.file_path ?? input.path ?? input.pattern);
  if (typeof file !== 'string') file = '';
  if (tool !== 'Skill' && path.isAbsolute(file)) file = path.relative(projectDir, file);
  return { tool, file };
}

function tokenTotals(result) {
  const usages = Object.values(result.modelUsage ?? {});
  if (usages.length) return {
    inputTokens: usages.reduce((sum, u) => sum + (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0),
    outputTokens: usages.reduce((sum, u) => sum + (u.outputTokens ?? 0), 0),
  };
  return { inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 };
}

// 干活时的输入通道：先送任务，之后用户的引导以 priority 'now' 插进当前这一步；第一个结果到了就关上
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
      inbox.push({ type: 'user', message: { role: 'user', content: `用户在你干活时插话引导：${text}` }, parent_tool_use_id: null, priority: 'now' });
      notify();
      return true;
    },
    close() { closed = true; notify(); },
  };
}

export function createRunAgent(queryImpl = query) {
  return async function runAgent({ role, prompt, projectDir, resume, onProgress, timeoutMs, mode = 'work', control }) {
    const started = Date.now();
    const stats = { turns: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 };
    let sessionId = null;
    // 到时间还没做完就中止，交给编排按“停下了”处理
    const abortController = new AbortController();
    let timedOut = false;
    let stopped = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; abortController.abort(); }, timeoutMs) : null;
    // control：编排传进来一个空对象，这里填上 steer(text) 和 stop()；这一步结束后 steer 一律返回 false
    const channel = control ? inputChannel(prompt) : null;
    let running = null;
    if (control) {
      control.steer = text => channel.push(text);
      control.stop = async () => {
        if (stopped) return;
        stopped = true;
        channel.close();
        try { if (typeof running?.interrupt === 'function') await running.interrupt(); else abortController.abort(); }
        catch { abortController.abort(); }
      };
    }
    try {
      if (!roles[role]) throw new Error('未知角色');
      if (typeof prompt !== 'string' || !prompt) throw new Error('任务不能为空');
      const cwd = path.resolve(projectDir);
      if (!inside(root, cwd)) throw new Error('项目目录必须在当前仓库内');
      await mkdir(cwd, { recursive: true });
      if (!inside(await realpath(root), await realpath(cwd))) throw new Error('项目目录不能经软链接越界');
      const chat = mode === 'chat';
      const allowed = chat ? chatTools : tools;
      if (!chat) await mkdir(path.join(cwd, roles[role].writeDir), { recursive: true });
      const configDir = path.join(root, '.claude-agent-config');
      await mkdir(configDir, { recursive: true });
      if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
      for (const name of ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']) {
        if (!process.env[name]) throw new Error(`缺少配置：${name}`);
      }
      const shared = await readFile(path.join(root, 'prompts/shared.md'), 'utf8');
      const rolePrompt = await readFile(path.join(root, 'prompts', roles[role].promptFile), 'utf8');
      const options = {
        systemPrompt: { type: 'custom', prompt: `${shared}\n\n${rolePrompt}` },
        tools: [...allowed],
        ...(chat ? { outputFormat: { type: 'json_schema', schema: chatSchema } } : { plugins: [{ type: 'local', path: path.join(root, 'team-skills') }], skills: [...roles[role].skills] }),
        canUseTool: (tool, input) => permissionFor(role, cwd, tool, input, allowed),
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              const decision = await permissionFor(role, cwd, input.tool_name, input.tool_input ?? {}, allowed);
              if (decision.behavior === 'allow') return {};
              return { hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: decision.message,
              } };
            }],
            onFailure: 'block',
          }],
        },
        settingSources: [],
        cwd,
        abortController,
        model: process.env.MODEL_NAME,
        maxTurns: chat ? 6 : 30,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: configDir,
          ANTHROPIC_BASE_URL: process.env.MODEL_BASE_URL,
          ANTHROPIC_AUTH_TOKEN: process.env.MODEL_API_KEY,
          CLAUDE_CONFIG_DIR: configDir,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.MODEL_NAME,
        },
      };
      if (resume && !chat) options.resume = resume;
      let result;
      running = queryImpl({ prompt: channel ? channel.messages() : prompt, options });
      // 中途插话时会先出一个结果再接着干，以最后一个结果为准
      for await (const message of running) {
        if (message.session_id) sessionId = message.session_id;
        if (message.type === 'assistant') {
          for (const block of message.message?.content ?? []) {
            if (block.type === 'tool_use') onProgress?.(progressFrom(block, cwd));
          }
        }
        if (message.type === 'result') { result = message; channel?.close(); }
      }
      if (timedOut) throw new Error('timeout');
      // 刚好做完时才点停下：活已经干完，按做完算
      if (stopped && !(result?.subtype === 'success' && !result.is_error)) throw new Error('stopped');
      if (!result) throw new Error('智能体没有返回结果');
      stats.turns = result.num_turns ?? 0;
      stats.durationMs = result.duration_ms ?? Date.now() - started;
      Object.assign(stats, tokenTotals(result));
      return result.subtype === 'success' && !result.is_error
        ? { ok: true, text: result.result ?? '', ...(chat ? { structured: result.structured_output ?? null } : {}), sessionId, stats }
        : { ok: false, text: '', sessionId, error: (result.errors ?? []).join('；') || result.subtype, stats };
    } catch (error) {
      stats.durationMs = Date.now() - started;
      if (timedOut) return { ok: false, text: '', sessionId, error: `超过 ${Math.round(timeoutMs / 60000)} 分钟没做完`, timedOut: true, stats };
      if (stopped) return { ok: false, text: '', sessionId, error: '用户让它停下了', stopped: true, stats };
      return { ok: false, text: '', sessionId, error: error.message, stats };
    } finally {
      clearTimeout(timer);
      channel?.close();
      if (control) control.steer = () => false;
    }
  };
}

export const runAgent = createRunAgent();
