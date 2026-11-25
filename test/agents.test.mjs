import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunAgent } from '../src/agents/run.mjs';
import { roles } from '../src/agents/roles.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// 不依赖本机 .env：给一组假的模型配置，fakeQuery 不会真的发请求
process.env.MODEL_BASE_URL ??= 'https://model.test';
process.env.MODEL_API_KEY ??= 'test-key';
process.env.MODEL_NAME ??= 'test-model';

test('query 选项、进度与返回值', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  let captured;
  try {
    const fakeQuery = async function* (args) {
      captured = args;
      yield { type: 'assistant', session_id: 's1', message: { content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'team:clarify' } },
        { type: 'tool_use', name: 'Write', input: { file_path: path.join(project, 'docs/questions.json') } },
      ] } };
      yield { type: 'result', subtype: 'success', is_error: false, result: '需要澄清', session_id: 's1', num_turns: 2, duration_ms: 1234,
        modelUsage: { model: { inputTokens: 10, cacheReadInputTokens: 3, cacheCreationInputTokens: 2, outputTokens: 7 } } };
    };
    const progress = [];
    const result = await createRunAgent(fakeQuery)({ role: 'product', prompt: '做一个读书会报名页', projectDir: project, onProgress: x => progress.push(x) });
    assert.equal(result.ok, true);
    assert.equal(result.text, '需要澄清');
    assert.equal(result.sessionId, 's1');
    assert.deepEqual(result.stats, { turns: 2, durationMs: 1234, inputTokens: 15, outputTokens: 7 });
    assert.deepEqual(progress, [{ tool: 'Skill', file: 'team:clarify' }, { tool: 'Write', file: 'docs/questions.json' }]);
    assert.equal(captured.prompt, '做一个读书会报名页');
    const o = captured.options;
    assert.deepEqual(o.tools, ['Read', 'Write', 'Edit', 'Glob', 'Skill']);
    assert.deepEqual(o.plugins, [{ type: 'local', path: path.join(root, 'team-skills') }]);
    assert.deepEqual(o.skills, roles.product.skills);
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.cwd, project);
    assert.equal(o.maxTurns, 30);
    assert.equal(o.systemPrompt.type, 'custom');
    assert.match(o.systemPrompt.prompt, /你是 AI 产品经理/);
    assert.deepEqual(Object.keys(o.env).sort(), ['PATH', 'HOME', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'].sort());
    assert.equal(Object.keys(o.env).some(k => k.startsWith('FEISHU_')), false);
    assert.equal(await o.canUseTool('Read', { file_path: 'site/index.html' }).then(x => x.behavior), 'allow');
    assert.equal(await o.canUseTool('Write', { file_path: 'docs/questions.json' }).then(x => x.behavior), 'allow');
    assert.equal(await o.canUseTool('Skill', { skill: 'team:clarify' }).then(x => x.behavior), 'allow');
    assert.equal(await o.canUseTool('Write', { file_path: 'design/theme.json' }).then(x => x.behavior), 'deny');
    assert.equal(await o.canUseTool('Read', { file_path: '../AGENTS.md' }).then(x => x.behavior), 'deny');
    assert.equal(await o.canUseTool('Glob', { pattern: '../*' }).then(x => x.behavior), 'deny');
    assert.equal(await o.canUseTool('Skill', { skill: 'team:frontend-design' }).then(x => x.behavior), 'deny');
    assert.equal(await o.canUseTool('Bash', { command: 'pwd' }).then(x => x.behavior), 'deny');
    const guard = o.hooks.PreToolUse[0];
    assert.equal(guard.onFailure, 'block');
    assert.deepEqual(await guard.hooks[0]({ tool_name: 'Read', tool_input: { file_path: 'docs/questions.json' } }), {});
    const blocked = await guard.hooks[0]({ tool_name: 'Read', tool_input: { file_path: '../AGENTS.md' } });
    assert.equal(blocked.hookSpecificOutput.permissionDecision, 'deny');
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('软链接不能越过项目边界', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  const outside = await mkdtemp(path.join(root, 'test-outside-'));
  try {
    await mkdir(path.join(project, 'docs'), { recursive: true });
    await symlink(outside, path.join(project, 'docs/link'));
    let options;
    const fakeQuery = async function* (args) {
      options = args.options;
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's', num_turns: 0, duration_ms: 1, modelUsage: {} };
    };
    await createRunAgent(fakeQuery)({ role: 'product', prompt: '任务', projectDir: project });
    assert.equal((await options.canUseTool('Write', { file_path: 'docs/link/file.md' })).behavior, 'deny');
    assert.equal((await options.canUseTool('Read', { file_path: 'docs/link/file.md' })).behavior, 'deny');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('到时间还没做完就中止，返回 timedOut', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  try {
    let signal;
    const slowQuery = async function* ({ options }) {
      signal = options.abortController.signal;
      yield { type: 'assistant', session_id: 's9', message: { content: [] } };
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    };
    const result = await createRunAgent(slowQuery)({ role: 'designer', prompt: '画线框', projectDir: project, timeoutMs: 30 });
    assert.equal(signal.aborted, true);
    assert.deepEqual([result.ok, result.timedOut, result.sessionId], [false, true, 's9']);
  } finally { await rm(project, { recursive: true, force: true }); }
});
