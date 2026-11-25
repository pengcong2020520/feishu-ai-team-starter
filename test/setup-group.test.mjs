import { test } from 'node:test';
import assert from 'node:assert/strict';
import { team } from '../src/setup/team.mjs';
import { createTeamGroup, introCard } from '../src/setup/group.mjs';

const appIds = { product: 'cli_p', designer: 'cli_d', developer: 'cli_v' };
function fakeClients({ ownerFails = false } = {}) {
  const log = [];
  const make = key => ({ im: { v1: {
    chat: {
      async create(req) { log.push(['create', key, req]); if (ownerFails && req.data.owner_id) { const e = new Error('400'); e.response = { data: { code: 232001, msg: 'invalid owner' } }; throw e; } return { code: 0, data: { chat_id: req.data.owner_id ? 'oc_owner' : 'oc_link' } }; },
      async link(req) { log.push(['link', key, req]); return { code: 0, data: { share_link: 'https://applink.test/join' } }; },
    },
    message: { async create(req) { log.push(['card', key, JSON.parse(req.data.content).header.title.content]); return { code: 0, data: { message_id: 'm' } }; } },
  } } });
  return { log, clients: Object.fromEntries(team.map(r => [r.key, make(r.key)])) };
}

test('用户当群主，拉另外两个机器人，三张报到卡片', async () => {
  const { log, clients } = fakeClients();
  const chats = [];
  const r = await createTeamGroup({ clients, appIds, team, ownerOpenId: 'ou_me', onChat: id => chats.push(id), log: () => {} });
  assert.deepEqual(r, { chatId: 'oc_owner', ownerSet: true, joinLink: null });
  assert.deepEqual(chats, [{ chatId: 'oc_owner', ownerSet: true, joinLink: null }]);
  const create = log.find(x => x[0] === 'create')[2];
  assert.deepEqual(create.data.bot_id_list, ['cli_d', 'cli_v']);
  assert.equal(create.data.owner_id, 'ou_me');
  assert.equal(create.params.uuid, 'ai-team-cli_p');
  assert.deepEqual(log.filter(x => x[0] === 'card').map(x => [x[1], x[2]]), [['product', 'AI 产品经理 · 报到'], ['designer', 'AI 设计 · 报到'], ['developer', 'AI 程序员 · 报到']]);
});

test('群主设不上就退回群分享链接', async () => {
  const { log, clients } = fakeClients({ ownerFails: true });
  const r = await createTeamGroup({ clients, appIds, team, ownerOpenId: 'ou_bad', log: () => {} });
  assert.deepEqual(r, { chatId: 'oc_link', ownerSet: false, joinLink: 'https://applink.test/join' });
  assert.ok(log.some(x => x[0] === 'link'));
});

test('已有群号时只补发卡片', async () => {
  const { log, clients } = fakeClients();
  const r = await createTeamGroup({ clients, appIds, team, ownerOpenId: 'ou_me', existing: { chatId: 'oc_old', ownerSet: true, joinLink: null }, log: () => {} });
  assert.deepEqual(r, { chatId: 'oc_old', ownerSet: true, joinLink: null });
  assert.equal(log.filter(x => x[0] === 'create').length, 0);
  assert.equal(log.filter(x => x[0] === 'card').length, 3);
});

test('产品经理的报到卡片写明怎么开始和工作台地址', () => {
  const card = introCard(team[0], { workbench: 'http://127.0.0.1:4870' });
  assert.equal(card.header.template, 'blue');
  assert.match(JSON.stringify(card), /@AI 产品经理/);
  assert.match(JSON.stringify(card), /127\.0\.0\.1:4870/);
});

test('续跑时沿用真实状态：上次没当上群主、链接也没拿到，就补一次链接并保存', async () => {
  const { log, clients } = fakeClients();
  const saved = [];
  const r = await createTeamGroup({ clients, appIds, team, ownerOpenId: 'ou_me', existing: { chatId: 'oc_link', ownerSet: false, joinLink: null }, onChat: info => saved.push(info), log: () => {} });
  assert.deepEqual(r, { chatId: 'oc_link', ownerSet: false, joinLink: 'https://applink.test/join' });
  assert.deepEqual(saved, [r]);
  assert.equal(log.filter(x => x[0] === 'create').length, 0);
});
