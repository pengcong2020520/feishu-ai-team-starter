import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm, mkdtemp, rename, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomicJson, loadPackage, lockedPackage, listPackages, latestPackages, installPackage, exportPackage, safeFile, inside } from '../packages/store.mjs';
import { identifier, relativePath } from '../packages/schema.mjs';
import { withPackageEditLock, withDirectoryLock } from '../packages/edit-lock.mjs';

const uuid = x => { if (!/^[a-f0-9-]{36}$/.test(x || '')) throw Error('调试编号无效'); return x; };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const now = () => new Date().toISOString();
const processAlive = pid => {if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
const lockOf = p => ({ id: p.manifest.id, version: p.manifest.version, hash: p.hash });
const writePack = async (dir, files) => { for (const [name, bytes] of files) { relativePath.parse(name); await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), bytes, { mode: 0o600 }); } };

// Drafts, runs and exports never enter the live package catalogue until apply().
export function createTeamLab({ root, launch, notify = async () => {} }) {
  const base = path.join(root, 'data/admin/team-lab'), queues = new Map();
  const draftDir = id => path.join(base, 'drafts', uuid(id));
  const runDir = id => path.join(base, 'runs', uuid(id));
  const serial = (key, fn) => { const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn); queues.set(key, next); void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {}); return next; };
  const draftTransaction=(id,fn)=>serial(id,()=>withDirectoryLock(path.join(base,'draft-locks',uuid(id)),fn));
  const readDraft = async id => json(path.join(draftDir(id), 'draft.json'));
  const draftPack = async d => { const p = await loadPackage(path.join(draftDir(d.id), 'revisions', d.hash)); if (p.hash !== d.hash) throw Error('草稿内容已变化'); return p; };
  const catalog = () => listPackages(root);
  const targetHead = async id => { const latest = latestPackages((await catalog()).filter(p => p.id === id)); if (latest.length > 1) throw Error('目标团队同版本存在不同内容，请先明确版本'); return latest[0] || null; };
  async function saveRevision(id, files) {
    const parent = path.join(draftDir(id), 'revisions'); await mkdir(parent, { recursive: true });
    const temp = await mkdtemp(path.join(parent, '.editing-'));
    try { await writePack(temp, files); const p = await loadPackage(temp); const destination = path.join(parent, p.hash);
      try { await rename(temp, destination); } catch(e) { if (!['EEXIST','ENOTEMPTY'].includes(e.code)) throw e; }
      return { ...lockOf(p), directory: destination };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const view = async d => { const p = await draftPack(d); return { ...d, files: [...p.files.keys()], roles: p.manifest.roles.map(r => ({ id:r.id, name:r.name, skills:r.skills })), workflow:p.workflow, workspace:p.manifest.workspace, artifacts:p.manifest.artifacts }; };
  const launchWorker = launch || (async id => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./team-trial-worker.mjs', import.meta.url)), root, id], { cwd:root, detached:true, stdio:'ignore', env: Object.fromEntries(['PATH','HOME','LANG'].filter(k => process.env[k]).map(k => [k,process.env[k]])) });
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    // The worker's first run.json contains its PID. This extra startup receipt is optional.
    await atomicJson(path.join(runDir(id),'worker.json'),{pid:child.pid}).catch(()=>{});child.unref();return child.pid;
  });
  const api = {
    async list() {
      const entries = await readdir(path.join(base,'drafts'), {withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      const drafts=[]; for(const e of entries)if(e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)) drafts.push(await readDraft(e.name));
      return { packages: (await catalog()).map(p=>({id:p.id,name:p.name,version:p.version,hash:p.hash,roles:p.roles.map(r=>r.name)})), drafts };
    },
    async open({ source, targetId, name }) {
      identifier.parse(targetId); if(typeof name!=='string'||!name.trim()||name.length>80)throw Error('请输入 1—80 字团队名称');
      const temp = await mkdtemp(path.join(os.tmpdir(),'team-lab-import-'));
      try {
        let p;
        if(typeof source==='object') p=await lockedPackage(root,source);
        else {
          if(typeof source!=='string'||!source)throw Error('请提供团队锁定版本、本机包目录、导出文件或 GitHub 固定提交链接');
          if(!source.startsWith('https:')) {
            const resolved=await realpath(path.resolve(root,source)), repo=await realpath(root);
            const allowed=['team-packages','examples','data/admin/team-lab/exports','data/admin/team-imports'].some(prefix=>inside(path.join(repo,prefix),resolved));
            if(!allowed)throw Error('本机导入请使用 team-packages、examples、data/admin/team-imports 或调试导出目录');
            source=resolved;
          }
          const installed=await installPackage(source,temp);p=await lockedPackage(temp,installed);
        }
        const current=await targetHead(targetId);
        if(current && (p.manifest.id!==targetId||p.hash!==current.hash))throw Error('目标团队已存在，请从它的最新版本修改，或使用新的个人团队 ID');
        const id=randomUUID(), manifest=structuredClone(p.manifest);manifest.id=targetId;manifest.name=name.trim();
        manifest.version=current?current.version.split('.').map((n,i)=>String(Number(n)+(i===2?1:0))).join('.'):'1.0.0';
        const files=new Map(p.files);files.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
        const revision=await saveRevision(id,files);
        const d={id,name:manifest.name,targetId,version:manifest.version,hash:revision.hash,initialHash:revision.hash,origin:lockOf(p),baseTarget:current?{id:current.id,version:current.version,hash:current.hash}:null,createdAt:now(),updatedAt:now(),runs:[]};
        await atomicJson(path.join(draftDir(id),'draft.json'),d);return view(d);
      } finally { await rm(temp,{recursive:true,force:true}); }
    },
    async read(id, file, revision) { let d=await readDraft(id);if(revision){if(!/^[a-f0-9]{64}$/.test(revision))throw Error('历史版本编号无效');d={...d,hash:revision};}const p=await draftPack(d); if(!file)return view(d);if(!p.files.has(file))throw Error('文件不在草稿清单中');const bytes=p.files.get(file);if(bytes.length>200000)throw Error('文件过大，请用本机编辑器查看');return {draftId:id,hash:d.hash,file,text:bytes.toString()}; },
    async history(id,offset=0) {
      const d=await readDraft(id),dir=path.join(draftDir(id),'revisions');
      const entries=await readdir(dir,{withFileTypes:true});
      const rows=await Promise.all(entries.filter(e=>e.isDirectory()&&/^[a-f0-9]{64}$/.test(e.name)).map(async e=>({revision:e.name,at:(await stat(path.join(dir,e.name))).mtime.toISOString()})));
      rows.sort((a,b)=>b.at.localeCompare(a.at));return {revision:d.hash,revisions:rows.slice(offset,offset+20),nextOffset:offset+20<rows.length?offset+20:null};
    },
    async edit({draftId,expectedHash,files,remove=[]}) { return draftTransaction(draftId,async()=>{
      const d=await readDraft(draftId);if(d.hash!==expectedHash)throw Error('草稿已更新，请重新读取后修改');
      if(!Array.isArray(files)||files.length>100||!Array.isArray(remove)||remove.length>100)throw Error('文件批次无效');
      const old=await draftPack(d), next=new Map(old.files);
      for(const file of remove){relativePath.parse(file);if(file==='manifest.json')throw Error('不能删除清单');next.delete(file);}
      for(const {path:file,text} of files){relativePath.parse(file);if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw Error('文件文字无效或过大');next.set(file,Buffer.from(text));}
      if(next.size===old.files.size&&[...next].every(([file,bytes])=>old.files.get(file)?.equals(bytes)))return {draftId:d.id,hash:d.hash,version:d.version,changed:[],validated:true,unchanged:true,needsNewTrial:false};
      const m=JSON.parse(next.get('manifest.json'));if(m.id!==d.targetId||m.version!==d.version)throw Error('不能在编辑中改变团队 ID 或待应用版本');
      m.files=[...next.keys()]; next.set('manifest.json',Buffer.from(JSON.stringify(m,null,2)+'\n'));
      const revision=await saveRevision(d.id,next);
      if(revision.hash===d.hash)return {draftId:d.id,hash:d.hash,version:d.version,changed:[],validated:true,unchanged:true,needsNewTrial:false};
      if(d.application)throw Error('此草稿已经应用；请从已应用团队的最新版本复制新草稿，再修改和试跑');
      d.hash=revision.hash;d.name=m.name;d.updatedAt=now();delete d.application;
      await atomicJson(path.join(draftDir(d.id),'draft.json'),d);return {draftId:d.id,hash:d.hash,version:d.version,changed:[...new Set([...files.map(f=>f.path),...remove])],validated:true,needsNewTrial:true};
    }); },
    async validate(id) { const d=await readDraft(id),p=await draftPack(d), original=await loadPackage(path.join(draftDir(id),'revisions',d.initialHash||d.hash));
      const changed=[...new Set([...original.files.keys(),...p.files.keys()])].filter(f=>!original.files.get(f)?.equals(p.files.get(f)||Buffer.alloc(0)));
      return {draftId:id,hash:p.hash,valid:true,roles:p.manifest.roles.length,skills:p.manifest.skills.length,nodes:p.workflow.nodes.length,workspace:p.manifest.workspace,files:[...p.files.keys()],changed,runs:d.runs,origin:d.origin}; },
    async trial({draftId,expectedHash,demand}) { return draftTransaction(draftId,async()=>{
      const d=await readDraft(draftId);if(d.hash!==expectedHash)throw Error('草稿已更新，请重新读取');
      if(typeof demand!=='string'||!demand.trim()||demand.length>4000)throw Error('试跑目标应为 1—4000 字');
      for(const id of d.runs){const r=await api.result(id);if(['starting','running','stopping'].includes(r.status))throw Error('该草稿已有试跑，请先查看结果或停下');}
      const p=await draftPack(d),id=randomUUID(),dir=runDir(id),lock=await installPackage(p.dir,dir);
      const r={id,draftId,hash:d.hash,package:{id:lock.id,version:lock.version,hash:lock.hash},demand,createdAt:now(),updatedAt:now(),status:'starting',mode:'real-sdk',gateMode:'automated-test',events:[],artifacts:[]};
      await atomicJson(path.join(dir,'run.json'),r);d.runs.push(id);await atomicJson(path.join(draftDir(d.id),'draft.json'),d);
      try {await launchWorker(id);}catch(e){r.status='failed';r.finishedAt=now();r.error='试跑进程未启动：'+e.message;await atomicJson(path.join(dir,'run.json'),r);throw e;}
      return {runId:id,draftId,hash:d.hash,status:'starting',note:'真实 SDK 试跑已排队，独立工作区；人工关口由测试驱动模拟，不表示真人批准。请结束本轮回复，释放管理员执行名额，完成后会私聊通知。'};
    }); },
    async result(id) { const file=path.join(runDir(id),'run.json'),r=await json(file);
      if(!r.finishedAt&&['passed','failed','stopped'].includes(r.status))r.status='running';
      if(['starting','running','stopping'].includes(r.status)&&Date.now()-Date.parse(r.updatedAt)>90000){
        // Sleep or a delayed event loop must not reopen a second run beside a live worker.
        const pid=r.pid||(await json(path.join(runDir(id),'worker.json')).catch(()=>null))?.pid;
        if(processAlive(pid))return {...r,heartbeatDelayed:true};
        return {...r,status:'interrupted',error:'试跑心跳已中断，保留记录，请重新试跑'};
      }
      if(!r.finishedAt&&await readFile(path.join(runDir(id),'stop')).then(()=>true,()=>false))return {...r,status:'stopping'};
      return r;
    },
    async artifact(runId,artifactId) { const r=await api.result(runId);const a=r.artifacts.find(a=>a.id===artifactId);if(!a||!r.projectId)throw Error('该试跑没有此交付物');const file=await safeFile(path.join(runDir(runId),'workspace',uuid(r.projectId)),a.path);return {name:a.name,format:a.format,text:await readFile(file,'utf8')}; },
    async stop(runId) { const r=await api.result(runId);if(!['starting','running','stopping'].includes(r.status))return r;await writeFile(path.join(runDir(runId),'stop'),'管理员要求停下',{mode:0o600});return {runId,status:'stopping'}; },
    async retry(runId) {const previous=await api.result(runId);return draftTransaction(previous.draftId,async()=>{
      const r=await api.result(runId),d=await readDraft(r.draftId);
      if(!['failed','stopped','interrupted'].includes(r.status)||r.mode!=='real-sdk'||r.hash!==d.hash||!d.runs.includes(runId))throw Error('只能继续当前草稿尚未通过的真实试跑；草稿改动后请新建试跑');
      if(processAlive(r.pid))throw Error('上次试跑进程仍在收尾，请稍后继续');
      for(const id of d.runs)if(id!==runId&&['starting','running','stopping'].includes((await api.result(id)).status))throw Error('该草稿已有试跑');
      (r.retries||=[]).push({at:now(),status:r.status,error:r.error,stage:r.stage});r.attempt=(r.attempt||1)+1;r.status='starting';r.updatedAt=now();r.resumeRequested=!!r.projectId;
      for(const key of ['error','finishedAt','notifiedAt','pid'])delete r[key];
      await rm(path.join(runDir(runId),'stop'),{force:true});await rm(path.join(runDir(runId),'worker.json'),{force:true});await atomicJson(path.join(runDir(runId),'run.json'),r);
      try{await launchWorker(runId);}catch(e){r.status='failed';r.error='试跑进程未启动：'+e.message;r.finishedAt=now();await atomicJson(path.join(runDir(runId),'run.json'),r);throw e;}
      return {runId,status:'starting',note:'从原工作流失败节点继续，保留已完成步骤和失败记录。请结束回复，等待结果通知。'};
    });},
    async apply({draftId,expectedHash,runId}) { return draftTransaction(draftId,async()=>{
      const d=await readDraft(draftId),r=await api.result(runId);if(d.hash!==expectedHash||r.draftId!==draftId||r.hash!==d.hash||r.status!=='passed'||r.mode!=='real-sdk'||!r.calls?.some(c=>c.ok&&['work','plan'].includes(c.mode)))throw Error('应用必须对应当前草稿的真实试跑通过记录');
      const p=await draftPack(d);
      return withPackageEditLock(root,d.targetId,async()=>{const head=await targetHead(d.targetId);if(head?.hash===d.hash){d.application||={package:{id:head.id,version:head.version,hash:head.hash},runId,at:now()};await atomicJson(path.join(draftDir(d.id),'draft.json'),d);return {applied:true,unchanged:true,...d.application};}
        if((head?.hash||null)!==(d.baseTarget?.hash||null))throw Error('正式团队版本已更新，请从最新版本复制草稿后重新试跑');
        const installed=await installPackage(p.dir,root);d.application={package:{id:installed.id,version:installed.version,hash:installed.hash},runId,at:now()};await atomicJson(path.join(draftDir(d.id),'draft.json'),d);
        return {applied:true,...d.application,note:'新项目可以选择此版本；旧项目及原机器人绑定不变。新团队请在工作台连接自己的角色机器人。'};
      });
    }); },
    async export(id) { const d=await readDraft(id),p=await draftPack(d),file=path.join(base,'exports',`${d.targetId}-${d.version}-${d.hash.slice(0,12)}.team.json`);const result=await exportPackage(p.dir,file);const temp=await mkdtemp(path.join(os.tmpdir(),'team-lab-verify-'));
      try{const installed=await installPackage(file,temp);if(installed.hash!==p.hash)throw Error('导出重新导入摘要不一致');}finally{await rm(temp,{recursive:true,force:true});}
      return {...result,file,draft:!d.application,verified:true};
    },
    async tick() {const state=await api.list();for(const d of state.drafts)for(const id of d.runs)await serial(`notify:${id}`,async()=>{const r=await api.result(id),file=path.join(runDir(id),'notice.json'),notice=await json(file).catch(()=>null);if(['passed','failed','stopped','interrupted'].includes(r.status)&&!r.notifiedAt&&notice?.attempt!==(r.attempt||1)){await notify(r);await atomicJson(file,{attempt:r.attempt||1,notifiedAt:now()});}});},
    async close() {
      // Also stop workers inherited from a previous administrator process.
      const runs=await readdir(path.join(base,'runs'),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      for(const entry of runs)if(entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name))await api.stop(entry.name);
    },
  };
  return api;
}
