// Preserve user/assistant text from pre-journal sessions before native compaction.
// Thinking blocks and tool payloads are never copied into the retrieval archive.
import path from 'node:path';
import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { atomicJson, inside, safeFile } from '../packages/store.mjs';
import { createAdminJournal } from './journal.mjs';
const uuid=/^[a-f0-9-]{36}$/;
export async function archiveSessionText({root,configDir,sessionId}) {
  if(!uuid.test(sessionId))throw Error('会话编号无效，不能整理');
  const base=await realpath(root),config=await realpath(configDir);
  if(!inside(base,config))throw Error('会话配置超出安装目录');
  const dirs=await readdir(path.join(config,'projects'),{withFileTypes:true});
  const matches=[];
  for(const d of dirs)if(d.isDirectory()){
    const relative=`projects/${d.name}/${sessionId}.jsonl`;
    try{const file=await safeFile(config,relative);matches.push(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(matches.length!==1)throw Error('无法定位完整旧会话，暂不压缩；继续原会话');
  const rows=(await readFile(matches[0],'utf8')).split('\n').filter(Boolean).map(JSON.parse),redact=createAdminJournal({root}).redact;
  const events=rows.filter(e=>!e.isSidechain&&!e.isMeta&&e.sessionId===sessionId&&path.resolve(e.cwd||'')===path.resolve(root)&&['user','assistant'].includes(e.type)).flatMap(e=>{
    const content=e.message?.content,text=typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):'';
    return text?[{id:`sdk:${sessionId}:${e.uuid}`,at:e.timestamp,type:e.type==='user'?'instruction':'reply',source:'sdk-history',text:redact(text),sessionId}]:[];
  });
  if(!events.length)throw Error('未读到可追溯原文，暂不压缩');
  const directory=path.join(root,'data/admin/conversation-archive');
  // The archive itself may not be redirected into another scope.
  for(const dir of [path.join(root,'data'),path.join(root,'data/admin'),directory]){try{if((await lstat(dir)).isSymbolicLink())throw Error('历史目录不能使用软链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const target=path.join(directory,`${sessionId}.json`);
  try { if((await lstat(target)).isSymbolicLink())throw Error('历史文件不能使用软链接'); }catch(e){if(e.code!=='ENOENT')throw e;}
  const old=await readFile(target,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const all=new Map(old.map(e=>[e.id,e]));for(const e of events)all.set(e.id,e);
  await atomicJson(target,[...all.values()]);return {events:all.size};
}
export async function archivedConversation(root) {
  const dir=path.join(root,'data/admin/conversation-archive');
  const entries=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const result=[];
  for(const file of entries.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)))result.push(...JSON.parse(await readFile(await safeFile(root,`data/admin/conversation-archive/${file}`),'utf8')));
  return result;
}
