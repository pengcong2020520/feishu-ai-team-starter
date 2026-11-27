import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { listPackages } from '../packages/store.mjs';

export const approvalStages = ['clarifying', 'confirm_prd', 'confirm_design', 'accept'];
export const approvalNames = { clarifying: '需求澄清', confirm_prd: '需求确认', confirm_design: '设计确认', accept: '最终验收' };
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const scopeMatches = (text, scope) => /^[a-z0-9_-]+$/i.test(scope)
  ? new RegExp(`(^|[^a-z0-9_])${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_])`, 'i').test(text)
  : text.includes(scope);
export const matchesIdentity = (person, identity = {}) => Boolean(
  identity.unionId && person.identity?.unionId === identity.unionId ||
  identity.userId && person.identity?.userId === identity.userId ||
  identity.openId && identity.role && person.identity?.openIds?.[identity.role] === identity.openId
);
export const recipient = person => person?.identity?.unionId ? { id: person.identity.unionId, type: 'union_id' }
  : person?.identity?.userId ? { id: person.identity.userId, type: 'user_id' }
  : person?.identity?.openIds?.product ? { id: person.identity.openIds.product, type: 'open_id' } : null;

export function createDirectory(root = process.cwd()) {
  const file = path.join(root, 'data/team.json');
  let state = { people: [], ownerId: null }, queue = Promise.resolve();
  const ready = readFile(file, 'utf8').then(text => { state = JSON.parse(text); }).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const save = async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(file + '.tmp', file); };
  const mutate = fn => { const task = queue.then(async () => { await ready; const before = structuredClone(state); try { const result = await fn(); await save(); return structuredClone(result); } catch (error) { state = before; throw error; } }); queue = task.catch(() => {}); return task; };
  const api = {
    async approvalCatalog() { return { ...approvalNames, ...Object.fromEntries((await listPackages(root)).flatMap(p => p.gates.map(g => [g.approval, g.name]))) }; },
    async get() { await ready; await queue; return { ...structuredClone(state), approvalOptions: await api.approvalCatalog() }; },
    async find(identity) { await ready; await queue; return structuredClone(state.people.find(p => matchesIdentity(p, identity)) ?? null); },
    observe(identity, name) {
      return mutate(() => {
        if (!identity?.unionId && !identity?.userId && !(identity?.openId && identity?.role)) return null;
        let person = state.people.find(p => matchesIdentity(p, identity));
        if (!person) { person = { id: randomUUID(), name: clean(name) || '待填写姓名', active: true, identity: {}, responsibilities: [] }; state.people.push(person); }
        for (const key of ['unionId', 'userId']) if (validId(identity[key])) person.identity[key] = identity[key];
        if (validId(identity.openId) && /^[a-z][a-z0-9-]{0,63}$/.test(identity.role || '')) (person.identity.openIds ??= {})[identity.role] = identity.openId;
        if (name && person.name === '待填写姓名') person.name = clean(name);
        return person;
      });
    },
    upsert(input) {
      return mutate(async () => {
        const name = clean(input.name);
        if (!name) throw Error('请填写姓名');
        if (!Array.isArray(input.responsibilities) || input.responsibilities.length > 30) throw Error('职责格式不正确');
        const knownApprovals = await api.approvalCatalog();
        const responsibilities = input.responsibilities.map(row => {
          const job = clean(row.job, 40), scope = clean(row.scope, 80);
          if (!job || !scope) throw Error('每条职责都要填写岗位和负责范围');
          if (!Array.isArray(row.approvals) || row.approvals.some(x => !Object.hasOwn(knownApprovals, x))) throw Error('确认事项不正确');
          return { job, scope, approvals: [...new Set(row.approvals)] };
        });
        let person = input.id && state.people.find(p => p.id === input.id);
        if (input.id && !person) throw Error('人员不存在');
        if (!person) { person = { id: randomUUID(), identity: {} }; state.people.push(person); }
        // 飞书身份只来自已验证的入站事件或群成员接口，不能在人员编辑接口中伪造。
        Object.assign(person, { name, active: input.active !== false, responsibilities });
        if (!person.active && state.ownerId === person.id) throw Error('请先更换本机操作者，再停用这位人员');
        return person;
      });
    },
    settings({ ownerId }) { return mutate(() => { if (!state.people.some(p => p.id === ownerId && p.active)) throw Error('请选择有效的本机操作者'); state.ownerId = ownerId; return state; }); },
    async plan({ text = '', scope = '', ownerId, memberIds, approvers = {}, identity, stages = approvalStages } = {}) {
      const snapshot = await api.get();
      const people = snapshot.people.filter(p => p.active);
      const creator = identity ? people.find(p => matchesIdentity(p, identity)) : null;
      if (identity && (identity.openId || identity.unionId || identity.userId) && !creator) throw Error('没有找到已启用的发起人，请先核对人员名册中的飞书身份');
      const owner = people.find(p => p.id === (ownerId || creator?.id || snapshot.ownerId));
      if (!owner) throw Error('请先在“人员与职责”添加人员并设置本机操作者');
      const haystack = clean(scope || text, 4000).toLocaleLowerCase();
      const matched = person => person.responsibilities.filter(row => scopeMatches(haystack, row.scope.toLocaleLowerCase()));
      const selected = memberIds === undefined ? people.filter(p => matched(p).length).map(p => p.id) : memberIds;
      if (!Array.isArray(selected) || selected.some(id => !people.some(p => p.id === id))) throw Error('项目成员包含不存在或已停用的人员');
      const members = [...new Set([owner.id, ...selected])];
      const decisions = {};
      const knownApprovals = await api.approvalCatalog();
      if (!Array.isArray(stages) || stages.some(s => !Object.hasOwn(knownApprovals, s))) throw Error('团队关口声明无效');
      for (const stage of stages) {
        const explicit = approvers[stage];
        const candidates = people.filter(p => members.includes(p.id) && matched(p).some(row => row.approvals.includes(stage)));
        if (!explicit && candidates.length > 1) throw Error(`${approvalNames[stage]}有多位负责人：${candidates.map(p => p.name).join('、')}，请在新项目表单中指定一位`);
        const chosen = explicit || candidates[0]?.id || owner.id;
        if (!members.includes(chosen)) throw Error(`${approvalNames[stage]}的确认人必须是项目成员`);
        decisions[stage] = chosen;
      }
      return { ownerId: owner.id, memberIds: members, approvers: decisions, scope: clean(scope, 80), people: people.filter(p => members.includes(p.id)) };
    },
  };
  return api;
}
