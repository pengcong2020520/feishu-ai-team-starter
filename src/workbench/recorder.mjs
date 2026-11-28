import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const plain = value => String(value ?? '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
export function cardView(card) {
  const view = { title: card.header?.title?.content ?? '卡片', color: card.header?.template ?? 'blue', text: [], links: [], buttons: [], questions: [] };
  const visit = elements => {
    for (const item of elements ?? []) {
      if (item.tag === 'div' || item.tag === 'markdown') view.text.push(plain(item.text?.content ?? item.content));
      if (item.tag === 'button') (item.url ? view.links : view.buttons).push({ label: item.text?.content ?? '', ...(item.url ? { url: item.url } : { value: item.value ?? item.behaviors?.find(b => b.type === 'callback')?.value }) });
      if (item.tag === 'select_static') view.questions.push({ id: item.name, options: item.options?.map(o => o.text?.content) ?? [], recommended: (item.initial_index ?? 1) - 1 });
      if (item.tag === 'input') view.extra = item.name;
      visit(item.actions); visit(item.elements); visit(item.columns);
    }
  };
  visit(card.elements); visit(card.body?.elements);
  const action = view.buttons.find(button => button.value?.projectId)?.value;
  const linked = view.links.find(link => /\/p\/[^/]+\/(site|wireframe|walkthrough)/.test(link.url));
  const linkedId = linked?.url.match(/\/p\/([^/]+)\//)?.[1];
  const projectId = action?.projectId ?? linkedId;
  const kind = action?.stage === 'confirm_prd' ? 'outline' : action?.stage === 'confirm_design' ? 'design' : action?.stage === 'accept' ? 'walkthrough' : linked?.url?.endsWith('/site') ? 'site' : null;
  if (projectId && kind) view.imageUrl = `/p/${encodeURIComponent(projectId)}/shot/${kind}`;
  return view;
}
export function createRecorder(root = process.cwd()) {
  const directory = path.join(root, 'data/messages');
  const file = chatId => path.join(directory, `${createHash('sha256').update(chatId).digest('hex')}.jsonl`);
  const listeners = new Set();
  const writes = new Map();
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add(chatId, event) {
      const task = (writes.get(chatId) || Promise.resolve()).catch(() => {}).then(async () => {
        await mkdir(directory, { recursive: true });
        const record = { at: new Date().toISOString(), chatId, ...event };
        await appendFile(file(chatId), JSON.stringify(record) + '\n');
        for (const fn of listeners) fn(record);
      });
      writes.set(chatId, task);
      void task.finally(() => { if (writes.get(chatId) === task) writes.delete(chatId); }).catch(() => {});
      return task;
    },
    async list(chatId, { role, limit = 300 } = {}) {
      try {
        await writes.get(chatId);
        const rows = (await readFile(file(chatId), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        return rows.filter(row => !role || row.role === role).slice(-limit);
      } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
  };
}
