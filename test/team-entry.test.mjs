import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { qrPage } from '../src/setup/qr-page.mjs';
import { consumeArrival, arriveTeam } from '../web/team-entry.mjs';
import { rolePortrait } from '../web/role-portraits.mjs';

test('共享头像支持社区角色名，不能把角色标识插入 SVG',()=>{
  for(const id of ['constructor','__proto__','<script>alert(1)</script>']){
    const portrait=rolePortrait(id);assert.match(portrait.svg,/<svg /);assert.doesNotMatch(portrait.svg,/<script>/);
  }
  assert.notEqual(rolePortrait('writer').svg,rolePortrait('editor').svg);
});

test('转场标记只消费一次，保留团队路由，拒绝非法团队名',()=>{
  let hash='#team=newtype-editorial&arrival=1',calls=0;
  assert.equal(consumeArrival(hash,v=>{hash=v;calls++;}),'newtype-editorial');
  assert.equal(hash,'#team=newtype-editorial');assert.equal(consumeArrival(hash,()=>calls++),null);assert.equal(calls,1);
  assert.equal(consumeArrival('#team=https://other.invalid&arrival=1',()=>{}),null);
  assert.equal(consumeArrival('#team=newtype-editorial',()=>{}),null);
  assert.doesNotThrow(()=>arriveTeam({},{reduced:true})());
});

// Execute the actual standalone page script. The fake DOM only supplies layout-free APIs.
function chamber(initial,{reduced=false}={}){
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.attributes={};const values=new Set();this.classList={add:x=>values.add(x),contains:x=>values.has(x),toggle:(x,on)=>on?values.add(x):values.delete(x)};}
    append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];} querySelector(){return new Element();}
  }
  const ids=new Map(),timeouts=[],navigation=[];
  const document={getElementById:id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},createElement:()=>new Element(),body:new Element(),head:new Element()};
  const window={addEventListener(){}};
  const context={window,document,URL,encodeURIComponent,matchMedia:()=>({matches:reduced}),location:{href:'http://127.0.0.1:4870/connect/team/index.html',origin:'http://127.0.0.1:4870',assign:url=>navigation.push(url)},setTimeout:(fn,ms)=>{const t={fn,ms};timeouts.push(t);return t;},clearTimeout:t=>{if(t)t.cancelled=true;}};
  const script=qrPage(initial).match(/<script>([\s\S]*)<\/script>/)[1];vm.runInNewContext(script,context);
  const run=ms=>{const pending=timeouts.filter(t=>t.ms===ms&&!t.cancelled&&!t.ran);for(const t of pending){t.ran=true;t.fn();}};
  return {window,document,ids,run,navigation,timeouts};
}
const role=(id,state='created')=>({id,key:id,name:'AI '+id,desc:'角色职责',state});
const state=(phase,roles=[role('chief'),role('writer')])=>({phase,teamName:'测试团队',roles,returnUrl:'/#team=example-team'});

test('创建回执不等于连接成功；只在全部角色 ready 后自动转场，重复回执不重入',()=>{
  const ui=chamber(state('scanning',[role('chief'),role('writer','waiting')]));
  ui.window.receiveTeamStatus(state('created'));ui.run(900);assert.equal(ui.navigation.length,0);
  ui.window.receiveTeamStatus(state('connecting'));ui.run(900);assert.equal(ui.navigation.length,0);
  ui.window.receiveTeamStatus(state('ready'));ui.window.receiveTeamStatus(state('ready'));ui.run(900);ui.run(460);
  assert.deepEqual(ui.navigation,['http://127.0.0.1:4870/#team=example-team&arrival=1']);
});

test('唤醒舱跳过会同时跳过入场，不能继续等待或播放第二段动画',()=>{
  const ui=chamber(state('ready'));
  ui.ids.get('workbench').onclick({preventDefault(){}});
  ui.document.body.children.find(n=>n.className==='departure-skip').onclick();
  ui.run(460);
  assert.deepEqual(ui.navigation,['http://127.0.0.1:4870/#team=example-team']);
});

test('失败取消待播转场，部分创建或外站地址不能跳转；已就位页由用户点击进入',()=>{
  for(const bad of [state('error'),state('ready',[role('chief'),role('writer','error')]),{...state('ready'),returnUrl:'https://other.invalid/'}]){
    const ui=chamber(state('connecting'));ui.window.receiveTeamStatus(bad);ui.run(900);ui.run(460);assert.equal(ui.navigation.length,0);
  }
  const cancelled=chamber(state('connecting'));cancelled.window.receiveTeamStatus(state('ready'));cancelled.window.receiveTeamStatus(state('error'));cancelled.run(900);assert.equal(cancelled.navigation.length,0);
  const ui=chamber(state('ready'),{reduced:true});ui.run(900);assert.equal(ui.navigation.length,0);
  ui.ids.get('workbench').onclick({preventDefault(){}});assert.equal(ui.navigation.length,1);assert.equal(ui.timeouts.some(t=>t.ms===460),false);
});
