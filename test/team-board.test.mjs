import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus, roleStates, selectTeam, teamProjects } from '../web/team-board.mjs';
const pack = n => ({id:'team',coordinator:'r0',roles:Array.from({length:n},(_,i)=>({id:'r'+i,name:'角色'+i}))});
const project = (id,extra={}) => ({id,name:id,package:{id:'team'},stage:'work',stageName:'研究',busy:true,running:['r0'],activities:{r0:{status:'running',name:'资料分析',text:'读取公开资料'}},...extra});

test('3、5、8 人都完整显示；历史完成或过时的 running 记录不冒充当前执行',()=>{
 for(const n of [3,5,8]){
  const roles=roleStates(pack(n),[project('done',{stage:'done',busy:false}),project('old',{busy:false,running:[],stageType:'gate',definition:{workflow:{nodes:[{id:'work',role:'r1'}]}}})]);
  assert.equal(roles.length,n);assert.equal(roles[0].status,'idle');assert.equal(roles[1].status,'waiting');assert.equal(roles.filter(r=>r.status==='running').length,0);
 }
});
test('跨项目同一角色保留全部任务；并行其他角色、等待名额与恢复分开显示',()=>{
 const a=project('a'),b=project('b',{running:['r0','r2'],activities:{r0:{status:'queued',name:'排队任务'},r2:{status:'running',name:'并行任务'}}});
 let roles=roleStates(pack(5),[a,b]);assert.equal(roles[0].tasks.length,2);assert.deepEqual(roles[0].tasks.map(t=>t.status),['running','queued']);assert.equal(roles[2].status,'running');
 b.activities.r0.status='running';roles=roleStates(pack(5),[b]);assert.equal(roles[0].status,'running');
});
test('项目分类区分运行、待确认、业务暂停、主动结束与已完成',()=>{
 assert.equal(projectStatus(project('retry',{error:'上次失败'})),'active');
 assert.equal(projectStatus(project('fail',{busy:false,error:'失败'})),'blocked');
 assert.equal(projectStatus(project('gate',{busy:false,stageType:'gate'})),'waiting');
 assert.equal(projectStatus(project('review',{pendingReview:{label:'检查'}})),'active');
 assert.equal(projectStatus(project('end',{ended:true,error:'停下'})),'done');
 assert.equal(projectStatus(project('done',{stage:'done'})),'done');
});
test('独立审核、群聊排队和已完成项目中的讨论显示真实活动，不改项目分类',()=>{
 const p=project('p',{busy:false,stage:'done',running:[],liveActivities:[{role:'r3',kind:'chat',status:'queued',name:'回复项目讨论'},{role:'r3',kind:'chat',status:'running',name:'回复项目讨论'}]});
 const r=roleStates(pack(8),[p]);assert.equal(r[3].tasks.length,2);assert.equal(r[3].status,'running');assert.equal(projectStatus(p),'done');
 const review=project('review',{running:[],pendingReview:{tasks:[{role:'r1'}]},liveActivities:[{role:'r0',kind:'review',status:'running',name:'独立审核'}]});
 assert.equal(roleStates(pack(3),[review])[0].tasks.length,1);assert.equal(roleStates(pack(3),[review])[1].status,'idle');
});
test('计划依赖待派工可见；完成任务与人工审核期间不误报待执行',()=>{
 const p=project('plan',{running:['r0'],plan:{node:'work',tasks:[{id:'a'},{id:'b'}],completed:['a']},definition:{workflow:{nodes:[{id:'work',tasks:[{id:'a',role:'r1',name:'已完成'},{id:'b',role:'r2',name:'下游任务'}]}]}}});
 const r=roleStates(pack(3),[p]);assert.equal(r[1].status,'idle');assert.equal(r[2].status,'pending');
 p.pendingReview={tasks:[{role:'r0'}]};assert.equal(roleStates(pack(3),[p])[2].tasks.length,0);
});
test('当前团队隔离与选择持久化；旧链接优先绑定项目团队；旧网页保留',()=>{
 const packs=[{...pack(3),id:'web-studio'},{...pack(5),id:'invest'}],projects=[project('i',{package:{id:'invest'}})],old=[{id:'legacy',stage:'done'}];
 assert.equal(selectTeam(packs,projects,{}).id,'web-studio');assert.equal(selectTeam(packs,projects,{saved:'invest'}).id,'invest');
 assert.equal(selectTeam(packs,projects,{team:'web-studio',project:'i'}).id,'invest');assert.equal(selectTeam(packs,projects,{saved:'removed'}).id,'web-studio');
 assert.deepEqual(teamProjects(packs[1],projects,[...old,{...projects[0],stage:'stale'}]).map(p=>[p.id,p.stage]),[['i','work']]);
 assert.deepEqual(teamProjects(packs[0],projects,old).map(p=>p.id),['legacy']);
 const legacy={id:'l',stage:'building',busy:true,activeRole:'developer',queuedForAgent:true};assert.equal(roleStates({roles:[{id:'developer'}]},[legacy])[0].status,'queued');
});
test('旧版本仍在用的角色保留，角色详情来自项目锁定定义',()=>{
 const p=project('old',{running:['retired'],activities:{retired:{status:'running',name:'旧版本任务'}},definition:{roles:[{id:'retired',name:'旧角色'}]}});
 assert.equal(roleStates(pack(3),[p]).at(-1).name,'旧角色');assert.equal(roleStates(pack(3),[p]).at(-1).status,'running');
});
