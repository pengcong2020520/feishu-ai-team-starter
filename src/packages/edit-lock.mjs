import path from 'node:path';
import { mkdir, mkdtemp, rename, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { identifier } from './schema.mjs';

const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
const owner=async dir=>{try{return JSON.parse(await readFile(path.join(dir,'owner.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}};
const busy=()=>Error('该团队正在保存，请稍后重试');

// Both prompt editing and administrator publishing use the same recoverable lock.
export async function withDirectoryLock(dir,fn){
  const token=randomUUID();
  await mkdir(path.dirname(dir),{recursive:true});
  const pending=await mkdtemp(path.join(path.dirname(dir),'.pending-'));
  try{
    // Publish the complete owner atomically: there is no ownerless live lock.
    await writeFile(path.join(pending,'owner.json'),JSON.stringify({pid:process.pid,token}),{mode:0o600});
    for(let attempt=0;;attempt++){
      const info=await stat(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(!info){try{await rename(pending,dir);break;}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;if(attempt>1)throw busy();continue;}}
      const previous=await owner(dir),age=Date.now()-(info.birthtimeMs||info.mtimeMs||Date.now());
      if(previous?alive(previous.pid):age<30000)throw busy();
    // A single reaper owns recovery; recheck its exact owner before deleting.
    const reap=path.join(dir,'reaping');try{await mkdir(reap);}catch{throw busy();}
    let removed=false;
    try{const held=await owner(dir);
      if(held?(held.token!==previous?.token||alive(held.pid)):previous||age<30000)throw busy();
      await rm(dir,{recursive:true,force:true});removed=true;
    }finally{if(!removed)await rm(reap,{recursive:true,force:true});}
      if(attempt>1)throw busy();
    }
    try{return await fn();}finally{if((await owner(dir))?.token===token)await rm(dir,{recursive:true,force:true});}
  }finally{await rm(pending,{recursive:true,force:true});}
}
export async function withPackageEditLock(root,id,fn){
  identifier.parse(id);
  return withDirectoryLock(path.join(root,'data/package-edit-locks',id),fn);
}
