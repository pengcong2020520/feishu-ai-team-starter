import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roles } from './roles.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tools = ['Read', 'Write', 'Edit', 'Glob', 'Skill'];

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

async function permissionFor(role, projectDir, tool, input) {
  if (tool === 'Skill') {
    return roles[role].skills.includes(input.skill) ? { behavior: 'allow' } : denied('此角色不能使用该技能');
  }
  if (!tools.includes(tool)) return denied('工具不在白名单中');
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

export function createRunAgent(queryImpl = query) {
  return async function runAgent({ role, prompt, projectDir, resume, onProgress }) {
    const started = Date.now();
    const stats = { turns: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 };
    let sessionId = null;
    try {
      if (!roles[role]) throw new Error('未知角色');
      if (typeof prompt !== 'string' || !prompt) throw new Error('任务不能为空');
      const cwd = path.resolve(projectDir);
      if (!inside(root, cwd)) throw new Error('项目目录必须在当前仓库内');
      await mkdir(cwd, { recursive: true });
      if (!inside(await realpath(root), await realpath(cwd))) throw new Error('项目目录不能经软链接越界');
      await mkdir(path.join(cwd, roles[role].writeDir), { recursive: true });
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
        tools: [...tools],
        plugins: [{ type: 'local', path: path.join(root, 'team-skills') }],
        skills: [...roles[role].skills],
        canUseTool: (tool, input) => permissionFor(role, cwd, tool, input),
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              const decision = await permissionFor(role, cwd, input.tool_name, input.tool_input ?? {});
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
        model: process.env.MODEL_NAME,
        maxTurns: 30,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: configDir,
          ANTHROPIC_BASE_URL: process.env.MODEL_BASE_URL,
          ANTHROPIC_AUTH_TOKEN: process.env.MODEL_API_KEY,
          CLAUDE_CONFIG_DIR: configDir,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.MODEL_NAME,
        },
      };
      if (resume) options.resume = resume;
      let result;
      for await (const message of queryImpl({ prompt, options })) {
        if (message.session_id) sessionId = message.session_id;
        if (message.type === 'assistant') {
          for (const block of message.message?.content ?? []) {
            if (block.type === 'tool_use') onProgress?.(progressFrom(block, cwd));
          }
        }
        if (message.type === 'result') result = message;
      }
      if (!result) throw new Error('智能体没有返回结果');
      stats.turns = result.num_turns ?? 0;
      stats.durationMs = result.duration_ms ?? Date.now() - started;
      Object.assign(stats, tokenTotals(result));
      return result.subtype === 'success' && !result.is_error
        ? { ok: true, text: result.result ?? '', sessionId, stats }
        : { ok: false, text: '', sessionId, error: (result.errors ?? []).join('；') || result.subtype, stats };
    } catch (error) {
      stats.durationMs = Date.now() - started;
      return { ok: false, text: '', sessionId, error: error.message, stats };
    }
  };
}

export const runAgent = createRunAgent();
