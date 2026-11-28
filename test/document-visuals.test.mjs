import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareDocumentVisuals, figureSvg, readDocumentImage } from '../src/document-visuals.mjs';
import { documentTransport } from '../src/feishu-documents.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8X8AAAAASUVORK5CYII=', 'base64');
const flow = { kind:'flow', title:'从需求到交付', steps:[{name:'确认目标',note:'由负责人确认范围'},{name:'交付成果',note:'按原工作流验收'}], caption:'只有确认后的需求进入正式执行。', source:'来源：本项目 workflow' };
const fixture = async fn => { const dir=await mkdtemp(path.join(os.tmpdir(),'doc-visuals-'));try {await mkdir(path.join(dir,'project/docs'),{recursive:true});await fn(dir);}finally{await rm(dir,{recursive:true,force:true});} };
const options = dir => ({projectDir:path.join(dir,'project'),artifactPath:'docs/report.md',cacheDir:path.join(dir,'cache')});

test('图形只由有界数据生成，转义文本并拒绝无效口径',()=>{
 const drawing=figureSvg({...flow,title:'<script>不是代码</script>'});assert.ok(drawing.svg.includes('&lt;script&gt;'));assert.ok(!drawing.svg.includes('<script>'));
 assert.equal(figureSvg({kind:'bar',title:'任务数量',unit:'项',data:[{label:'甲',value:2},{label:'乙',value:3}],caption:'仅测试数据。',source:'来源：测试夹具'}).width,1000);
 assert.throws(()=>figureSvg({...flow,steps:[flow.steps[0]]}),/2–6/);
 assert.throws(()=>figureSvg({kind:'bar',title:'无效',unit:'项',data:[{label:'甲',value:-1},{label:'乙',value:3}],caption:'说明',source:'测试'}),/非负/);
 assert.match(figureSvg({kind:'bar',title:'微小数值',unit:'米',data:[{label:'甲',value:1e-9},{label:'乙',value:2e-9}],caption:'不能舍入成零',source:'测试夹具'}).svg,/1\.00e-9/);
});

test('配图定义渲染为真实图片，图注与来源保留；同版本复用缓存',()=>fixture(async dir=>{
 let rendered=0;const capture=async({pngFile})=>{rendered++;await writeFile(pngFile,png);};
 const markdown='# 标题\n\n```team-figure\n'+JSON.stringify(flow)+'\n```\n\n## 专业章节\nFR-001 保持';
 const first=await prepareDocumentVisuals({...options(dir),markdown,capture}),second=await prepareDocumentVisuals({...options(dir),markdown,capture});
 assert.equal(rendered,1);assert.equal(first.digest,second.digest);assert.ok(first.markdown.includes('FR-001 保持'));assert.ok(!first.markdown.includes('```team-figure'));
 assert.ok(first.markdown.includes(flow.caption));assert.ok(first.markdown.includes(flow.source));assert.equal(Object.keys(first.assets).length,1);
 assert.deepEqual(await readFile(Object.values(first.assets)[0].file),png);
 const sample='````markdown\n'+markdown+'\n````';assert.equal((await prepareDocumentVisuals({...options(dir),markdown:sample,capture})).markdown,sample);
 const inline='语法 `![例子](missing.png)` 与 \\![转义](missing.png) 是文字。';assert.equal((await prepareDocumentVisuals({...options(dir),markdown:inline,capture})).markdown,inline);
}));

test('图片限于当前项目，冻结当前版本；拒绝网络、越界、伪装格式与不完整图形',()=>fixture(async dir=>{
 const file=path.join(dir,'project/docs/image.png');await writeFile(file,png);
 const a=await prepareDocumentVisuals({...options(dir),markdown:'![流程](image.png)'});await writeFile(file,Buffer.from('changed'));
 assert.deepEqual(await readFile(Object.values(a.assets)[0].file),png);
 await assert.rejects(prepareDocumentVisuals({...options(dir),markdown:'![流程](image.png)'}),/实际的 PNG/);
 await assert.rejects(prepareDocumentVisuals({...options(dir),markdown:'![图](https://example.org/a.png)'}),/相对路径/);
 await writeFile(path.join(dir,'other.png'),png);await symlink(path.join(dir,'other.png'),file+'.link');
 await assert.rejects(prepareDocumentVisuals({...options(dir),markdown:'![图](image.png.link)'}),/超出当前项目/);
 await assert.rejects(prepareDocumentVisuals({...options(dir),markdown:'```team-figure\n{}'}),/尚未写完/);
 const cached=Object.values(a.assets)[0];await writeFile(cached.file,'changed');await assert.rejects(readDocumentImage(cached),/已变化/);
}));

test('图片创建、上传、绑定和回读可恢复；绑定失败不会重复插入正文或重复上传',()=>fixture(async dir=>{
 await writeFile(path.join(dir,'project/docs/image.png'),png);
 const visual=await prepareDocumentVisuals({...options(dir),markdown:'![流程](image.png)'}),url=Object.keys(visual.assets)[0];
 let created=0,uploaded=0,patches=0,persisted={},state={};
 const client={docx:{v1:{
  document:{convert:async()=>({data:{blocks:[{block_id:'tmp',block_type:27,image:{}}],first_level_block_ids:['tmp'],block_id_to_image_urls:[{block_id:'tmp',image_url:url}]}})},
  documentBlockDescendant:{create:async()=>{created++;return{data:{block_id_relations:[{temporary_block_id:'tmp',block_id:'real'}]}};}},
  documentBlock:{patch:async payload=>{assert.equal(payload.path.block_id,'real');if(++patches===1)throw Error('绑定失败');return{};},get:async()=>({data:{block:{image:{token:'media'}}}})},
 }},drive:{v1:{media:{uploadAll:async payload=>{uploaded++;assert.equal(payload.data.parent_node,'real');assert.equal(payload.data.parent_type,'docx_image');assert.deepEqual(payload.data.file,png);return{file_token:'media'};}}}}};
 const remote=documentTransport(client,fn=>fn()),save=async()=>{persisted=structuredClone(state);};
 await assert.rejects(remote.append('doc',visual.markdown,'token',{assets:visual.assets,state,save}),/绑定失败/);
 state=structuredClone(persisted);await remote.append('doc',visual.markdown,'token',{assets:visual.assets,state,save});
 assert.equal(created,1);assert.equal(uploaded,1);assert.equal(state.next,1);assert.equal(state.images[0].done,true);
 await remote.append('doc',visual.markdown,'token',{assets:visual.assets,state,save});assert.equal(patches,2);
}));

test('没有素材映射的图片在插入前拒绝，不能把空图片当已同步',async()=>{
 let created=false;const client={docx:{v1:{document:{convert:async()=>({data:{blocks:[{block_id:'a',block_type:27,image:{}}],first_level_block_ids:['a']}})},documentBlockDescendant:{create:async()=>{created=true;}}}}};
 await assert.rejects(documentTransport(client,fn=>fn()).append('d','![x](x)','token'),/图片块/);assert.equal(created,false);
});

test('上传超时和回读不符均不得把图片标成完成，恢复后不重复正文',()=>fixture(async dir=>{
 await writeFile(path.join(dir,'project/docs/image.png'),png);
 const visual=await prepareDocumentVisuals({...options(dir),markdown:'![图](image.png)'}),url=Object.keys(visual.assets)[0];
 let mode='timeout',created=0,uploads=0;const state={};
 const client={docx:{v1:{document:{convert:async()=>({data:{blocks:[{block_id:'tmp',block_type:27,image:{}}],first_level_block_ids:['tmp'],block_id_to_image_urls:[{block_id:'tmp',image_url:url}]}})},documentBlockDescendant:{create:async()=>{created++;return{data:{block_id_relations:[{temporary_block_id:'tmp',block_id:'real'}]}};}},documentBlock:{patch:async()=>({}),get:async()=>({data:{block:{image:{token:mode==='bad-read'?'wrong':'token'}}}})}}},drive:{v1:{media:{uploadAll:async()=>{uploads++;return mode==='timeout'?new Promise(()=>{}):{file_token:'token'};}}}}};
 const remote=documentTransport(client,fn=>fn(),{uploadMs:5}),args={assets:visual.assets,state};
 await assert.rejects(remote.append('doc',visual.markdown,'uuid',args),/上传超时/);assert.equal(state.next,0);
 mode='bad-read';await assert.rejects(remote.append('doc',visual.markdown,'uuid',args),/回读未确认/);assert.equal(state.images[0].done,undefined);
 mode='ok';await remote.append('doc',visual.markdown,'uuid',args);assert.equal(created,1);assert.equal(uploads,2);assert.equal(state.images[0].done,true);
}));
