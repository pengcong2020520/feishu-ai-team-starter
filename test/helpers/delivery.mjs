import { readFile } from 'node:fs/promises';
import path from 'node:path';
// 测试替身实际读取同一份受检文件；不放宽生产代码的 Read 回执要求。
export async function fakeDelivery(args) {
  const files=JSON.parse(args.prompt.split('文件清单：')[1]);
  for(const a of files){await readFile(path.join(args.projectDir,a.path));args.onProgress?.({tool:'Read',file:path.join(args.projectDir,a.path),status:'succeeded'});}
  return {ok:true,text:'已核对',structured:{passed:true,summary:'测试内容符合约定',blockers:[],artifacts:files.map(a=>({id:a.id,reason:'已读取实际测试文件'}))},stats:{turns:1,durationMs:1,inputTokens:1,outputTokens:1}};
}
