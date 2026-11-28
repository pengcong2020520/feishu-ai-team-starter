import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunAgent, runAgent } from '../src/agents/run.mjs';
import { acquireCapacity } from '../src/agents/capacity.mjs';
import { roles } from '../src/agents/roles.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
test('三个执行名额占满时，群聊排队超时与主动停止分开，尚未调用模型',async()=>{
  const runtime=await mkdtemp(path.join(root,'test-project-')),releases=[];let queued=false;
  try{
    const limit=Number(process.env.AGENT_CONCURRENCY||3);
    for(let i=0;i<limit;i++)releases.push(await acquireCapacity({root:runtime,limit,role:'busy',project:'p'}));
    const result=await runAgent({runtimeRoot:runtime,projectDir:path.join(runtime,'workspace','chat'),role:'product',mode:'chat',prompt:'你好',timeoutMs:1000,queueTimeoutMs:25,onQueued:v=>{queued=v;}});
    assert.equal(queued,true);assert.equal(result.queueTimedOut,true);assert.equal(result.stopped,undefined);assert.equal(result.stats.turns,0);assert.match(result.error,/尚未开始回答/);
  }finally{for(const release of releases)await release();await rm(runtime,{recursive:true,force:true});}
});
test('研究任务提供 PDF 与确定性计算和交付预算，聊天仍只读且隔离', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-')), captured = [];
  const fake = async function* ({ options }) { captured.push(options); yield { type: 'result', subtype: 'success', result: '完成' }; };
  const definition = { name:'研究员', tools:['Read','Write','Glob','Skill','WebFetch','WebSearch','Calculate'], write:['report'], read:['context','report'], skills:[], sharedPrompt:'', promptText:'', pluginPath:path.join(root,'team-skills'), model:'default' };
  try {
    const run = createRunAgent(fake);
    await run({ role:'quant', projectDir:project, prompt:'研究', definition });
    const o = captured[0]; assert.equal(o.maxTurns,60); assert.ok(o.mcpServers.research);
    assert.ok(!o.tools.includes('Calculate')); assert.match(o.systemPrompt.prompt,/尽早 Write/);
    assert.match(o.systemPrompt.prompt,/team-figure/);
    for (const tool of ['mcp__research__read_pdf','mcp__research__calculate']) assert.equal((await o.canUseTool(tool,{})).behavior,'allow');
    assert.equal((await o.canUseTool('Bash',{})).behavior,'deny');
    await run({ role:'quant', projectDir:project, prompt:'问答', definition, mode:'chat' });
    assert.equal(captured[1].maxTurns,6); assert.deepEqual(Object.keys(captured[1].mcpServers),['knowledge']);assert.equal((await captured[1].canUseTool('mcp__knowledge__remember',{})).behavior,'deny');
    assert.doesNotMatch(captured[1].systemPrompt.prompt,/team-figure/);
    assert.equal((await captured[1].canUseTool('mcp__research__calculate',{})).behavior,'deny');
    await run({ role:'quant', projectDir:project, prompt:'制定计划', definition, mode:'plan', outputSchema:{type:'object',properties:{tasks:{type:'array'}}} });
    const plan=captured[2];assert.deepEqual(plan.tools,['Read','Glob','Skill']);assert.deepEqual(Object.keys(plan.mcpServers),['knowledge']);assert.equal((await plan.canUseTool('mcp__knowledge__remember',{})).behavior,'deny');
    assert.equal((await plan.canUseTool('Write',{file_path:path.join(project,'report/early.md')})).behavior,'deny');
    assert.equal((await plan.canUseTool('mcp__research__calculate',{})).behavior,'deny');
    assert.equal((await plan.canUseTool('StructuredOutput',{tasks:[]})).behavior,'allow');
    assert.doesNotMatch(plan.systemPrompt.prompt,/尽早 Write/);
    assert.doesNotMatch(plan.systemPrompt.prompt,/team-figure/);
    await run({role:'quant',projectDir:project,prompt:'只读审查',definition,mode:'review'});
    assert.doesNotMatch(captured[3].systemPrompt.prompt,/team-figure|## 文档补充规范/);
  } finally { await rm(project,{recursive:true,force:true}); }
});
// 不依赖本机 .env：给一组假的模型配置，fakeQuery 不会真的发请求
process.env.MODEL_BASE_URL ??= 'https://model.test';
process.env.MODEL_API_KEY ??= 'test-key';
process.env.MODEL_NAME ??= 'test-model';

test('任务摘要与完整结果分开，结构化计划保持原契约，不放宽文件权限', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  const captured=[];
  const fakeQuery=async function*({options}) { captured.push(options); yield {type:'result',subtype:'success',is_error:false,result:'内部工具与文件交接记录',structured_output:{reply:'已更新研究结论，关键年份仍需核实。'},session_id:'summary',num_turns:1,duration_ms:1}; };
  try {
    const run=createRunAgent(fakeQuery),result=await run({role:'product',projectDir:project,prompt:'正式任务'});
    assert.equal(result.text,'已更新研究结论，关键年份仍需核实。');assert.equal(result.rawText,'内部工具与文件交接记录');
    assert.equal(captured[0].outputFormat.schema.properties.reply.maxLength,240);
    assert.doesNotMatch(captured[0].systemPrompt.prompt,/team-figure/);
    assert.equal((await captured[0].canUseTool('StructuredOutput',{reply:result.text})).behavior,'allow');
    assert.equal((await captured[0].canUseTool('Write',{file_path:'context/task-history.json'})).behavior,'deny');
    const schema={type:'object',properties:{tasks:{type:'array'}},required:['tasks']};
    const plan=await run({role:'product',projectDir:project,prompt:'结构化计划',outputSchema:schema});
    assert.equal(captured[1].outputFormat.schema,schema);assert.equal(plan.text,'内部工具与文件交接记录');
  } finally {await rm(project,{recursive:true,force:true});}
});

test('新项目的 SDK 存储按项目和角色隔离，同一角色续用原目录', async () => {
  const a=await mkdtemp(path.join(root,'test-project-')), b=await mkdtemp(path.join(root,'test-project-')), configs=[];
  const captured=[];
  const fakeQuery=async function*({options}){captured.push(options);yield {type:'result',subtype:'success',is_error:false,result:'完成',session_id:'s',num_turns:1,duration_ms:1,modelUsage:{}};};
  const run=createRunAgent(fakeQuery);
  try{
    for(const [projectDir,role,resume] of [[a,'product'],[b,'product'],[a,'designer'],[a,'product','s']])await run({projectDir,role,prompt:'隔离测试',isolateSession:true,resume});
    await run({projectDir:a,role:'product',prompt:'只读问答',mode:'chat',isolateSession:true});
    await run({projectDir:a,role:'product',prompt:'管理员代问',mode:'chat',isolateSession:true});
    configs.push(...captured.map(o=>o.env.CLAUDE_CONFIG_DIR));
    assert.equal(new Set(configs).size,5);assert.equal(configs[0],configs[3]);assert.equal(captured[3].resume,'s');
    assert.notEqual(configs[4],configs[5]);assert.notEqual(configs[0],configs[4]);
    assert.equal((await captured[0].canUseTool('Read',{file_path:path.join(b,'docs/prd.md')})).behavior,'deny');
    assert.ok(captured.every(o=>o.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY==='1'));
  }finally{await Promise.all([a,b,...new Set(configs.map(c=>path.dirname(c)))].map(p=>rm(p,{recursive:true,force:true})));}
});

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
    assert.deepEqual(result.stats, { turns: 2, durationMs: 1234, inputTokens: 10, outputTokens: 7, cacheReadInputTokens:3, cacheCreationInputTokens:2, usageScope:'request' });
    assert.deepEqual(progress, [{ tool: 'Skill', file: 'team:clarify' }, { tool: 'Write', file: 'docs/questions.json' }]);
    assert.equal(captured.prompt, '做一个读书会报名页');
    assert.equal(captured.options.systemPrompt.snapshot,false);
    const o = captured.options;
    assert.deepEqual(o.tools, ['Read', 'Write', 'Edit', 'Glob', 'Skill']);
    assert.deepEqual(o.plugins, [{ type: 'local', path: path.join(root, 'team-skills') }]);
    assert.deepEqual(o.skills, roles.product.skills);
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.cwd, project);
    assert.equal(o.maxTurns, 30);
    assert.equal(o.systemPrompt.type, 'custom');
    assert.match(o.systemPrompt.prompt, /你是 AI 产品经理/);
    assert.match(o.systemPrompt.prompt, /本次是已获确认的正式任务/);
    assert.deepEqual(Object.keys(o.env).sort(), ['PATH', 'HOME', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY'].sort());
    assert.equal(o.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
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

test('对话模式：只读、不用技能、开新会话，按固定格式返回回复和提议', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  try {
    let options;
    const fakeQuery = async function* (args) {
      options = args.options;
      yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { reply: '你好', proposal: { action: 'none', detail: '' } }, session_id: 'c1', num_turns: 1, duration_ms: 5, modelUsage: {} };
    };
    const result = await createRunAgent(fakeQuery)({ role: 'designer', mode: 'chat', prompt: '群聊对话', projectDir: project, resume: 'old', timeoutMs: 60000 });
    assert.deepEqual(result.structured, { reply: '你好', proposal: { action: 'none', detail: '' } });
    assert.deepEqual(options.tools, ['Read', 'Glob']);
    assert.match(options.systemPrompt.prompt, /本次是群聊对话：只读、不写文件/);
    assert.doesNotMatch(options.systemPrompt.prompt, /本次是已获确认的正式任务/);
    assert.equal(options.outputFormat.type, 'json_schema');
    assert.deepEqual(options.outputFormat.schema.properties.proposal.properties.action.enum, ['none', 'start', 'revise', 'answer', 'retry', 'end']);
    assert.equal(options.plugins, undefined);
    assert.equal(options.skills, undefined);
    assert.equal(options.resume, undefined);
    assert.equal(options.maxTurns, 6);
    assert.equal((await options.canUseTool('Read', { file_path: 'docs/prd.md' })).behavior, 'allow');
    assert.equal((await options.canUseTool('Write', { file_path: 'design/theme.json' })).behavior, 'deny');
    assert.equal((await options.canUseTool('Skill', { skill: 'team:theme-pick' })).behavior, 'deny');
    assert.equal((await options.canUseTool('StructuredOutput', { reply: '你好' })).behavior, 'allow');
    assert.deepEqual(await options.hooks.PreToolUse[0].hooks[0]({ tool_name: 'StructuredOutput', tool_input: {} }), {});
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('干活时插话和停下：引导以 priority now 送进这一步、以最后一个结果为准；停下调 interrupt', async () => {
  const project = await mkdtemp(path.join(root, 'test-project-'));
  try {
    const control = {};
    const seen = [];
    const result = { type: 'result', subtype: 'success', is_error: false, session_id: 's', num_turns: 1, duration_ms: 1, modelUsage: {} };
    const steerQuery = ({ prompt }) => (async function* () {
      const input = prompt[Symbol.asyncIterator]();
      seen.push((await input.next()).value);
      yield { type: 'assistant', session_id: 's', message: { content: [] } };
      assert.equal(control.steer('主色用绿色'), true);
      seen.push((await input.next()).value);
      yield { ...result, result: '' };
      yield { ...result, result: '按引导改好了' };
      assert.equal((await input.next()).done, true);
    })();
    const done = await createRunAgent(steerQuery)({ role: 'designer', prompt: '画线框', projectDir: project, control });
    assert.equal(done.text, '按引导改好了');
    assert.equal(seen[0].message.content, '画线框');
    assert.equal(seen[1].priority, 'now');
    assert.match(seen[1].message.content, /主色用绿色/);
    assert.equal(control.steer('晚了'), false);

    const stopControl = {};
    let interrupted = false;
    const stopQuery = () => {
      const run = (async function* () {
        yield { type: 'assistant', session_id: 's2', message: { content: [] } };
        await stopControl.stop();
        throw new Error('interrupted');
      })();
      run.interrupt = async () => { interrupted = true; };
      return run;
    };
    const stopped = await createRunAgent(stopQuery)({ role: 'designer', prompt: '画线框', projectDir: project, control: stopControl });
    assert.deepEqual([stopped.ok, stopped.stopped, interrupted, stopped.sessionId], [false, true, true, 's2']);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('自动审核使用独立只读会话，不复用作者 resume，不提供 Skill、写入或联网',async()=>{
 const project=await mkdtemp(path.join(root,'test-project-')),options=[];
 const run=createRunAgent(async function*({options:o}){options.push(o);yield {type:'result',subtype:'success',structured_output:{passed:true},result:'审核'};});
 const definition={name:'审核',tools:['Read','Write','Glob','Skill','WebSearch'],write:[],read:['context','report'],skills:[],sharedPrompt:'',promptText:'',pluginPath:path.join(root,'team-skills'),model:'default'};
 try{for(let i=0;i<2;i++)await run({role:'chief',projectDir:project,prompt:'审核',definition,mode:'review',isolateSession:true,resume:'author-session',outputSchema:{type:'object',properties:{passed:{type:'boolean'}}}});
  assert.notEqual(options[0].env.CLAUDE_CONFIG_DIR,options[1].env.CLAUDE_CONFIG_DIR);
  for(const o of options){assert.deepEqual(o.tools,['Read','Glob']);assert.equal(o.resume,undefined);assert.equal(o.plugins,undefined);assert.deepEqual(Object.keys(o.mcpServers),['knowledge']);assert.equal((await o.canUseTool('mcp__knowledge__remember',{})).behavior,'deny');assert.equal((await o.canUseTool('Write',{file_path:'report/a.md'})).behavior,'deny');assert.equal((await o.canUseTool('Skill',{skill:'team:test'})).behavior,'deny');assert.equal((await o.canUseTool('StructuredOutput',{passed:true})).behavior,'allow');}
 }finally{await rm(project,{recursive:true,force:true});}
});
