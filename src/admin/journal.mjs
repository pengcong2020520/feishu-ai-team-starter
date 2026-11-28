// Administrator instructions and observable results only. Never record SDK reasoning.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPackage } from '../packages/store.mjs';

export function createAdminJournal({ root, secrets = Object.entries(process.env).filter(([k]) => /KEY|SECRET|TOKEN/.test(k)).map(([,v]) => v) }) {
  const file = path.join(root, 'data/admin/journal.jsonl'), scope = new AsyncLocalStorage();
  const redact = value => {
    let text = String(value ?? '');
    for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 6)) text = text.split(secret).join('[已隐藏密钥]');
    return text.replace(/\b(?:oc_sk_|sk-)[A-Za-z0-9_-]{12,}/g, '[已隐藏密钥]')
      .replace(/((?:api[_ -]?key|access_token|refresh_token|app_secret|authorization)\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[已隐藏密钥]');
  };
  const clean = x => typeof x === 'string' ? redact(x).slice(0, 40000) : Array.isArray(x) ? x.map(clean) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k, clean(v)])) : x;
  const events = () => {
    let raw; try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return raw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  };
  const record = (type, data, context = scope.getStore()) => {
    const entry = clean({ ...data, id: randomUUID(), at: new Date().toISOString(), type, turnId: context?.turnId || null });
    mkdirSync(path.dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(entry)+'\n', { mode: 0o600 }); return entry;
  };
  const api = {
    events, record, redact, context: () => scope.getStore(), run: (context, fn) => scope.run(context, fn),
    async receive(input, fn) {
      const real = input.source === 'feishu-private' && input.messageId && input.chatId && input.senderOpenId;
      // Metadata comes exclusively from the authorized bot ingress, not model arguments.
      if (real && events().some(e => e.type === 'instruction' && e.messageId === input.messageId)) return;
      const context = { turnId: randomUUID() };
      return scope.run(context, async () => {
        record('instruction', { text: input.displayText ?? input.text, source: real ? 'feishu-private' : 'internal', messageId: input.messageId || null, chatId: input.chatId || null, senderOpenId: input.senderOpenId || null, platformTime: input.platformTime || null, kind: input.kind || 'text' });
        try { return await fn(); } catch (e) { record('error', { text: e.message }); throw e; }
      });
    },
    async operation(name, args, fn, context = scope.getStore()) {
      const start = record('operation-start', { name, draftId: args.draftId, runId: args.runId, beforeHash: args.expectedHash, file: args.file, paths: args.files?.map(f => f.path), remove: args.remove }, context);
      try {
        // SDK tools can arrive outside the original message's async scope.
        // Carry the captured turn into nested replies (for example an exported file).
        const result = await scope.run(context, fn);
        record('operation', { operationId: start.id, name, ok: true, draftId: args.draftId || (name === 'team_draft_open' ? result.id : result.draftId), runId: result.runId || args.runId,
          beforeHash: args.expectedHash, afterHash: result.hash, changed: result.changed, targetId: result.targetId, package: result.package,
          file: args.file, status: result.status, valid: result.valid ?? result.validated, verified: result.verified, applied: result.applied, unchanged: result.unchanged }, context);
        return result;
      } catch (e) { record('operation', { operationId: start.id, name, ok: false, draftId: args.draftId, runId: args.runId, error: e.message }, context); throw e; }
    },
    wrapBot(bot) {
      const wrapped = Object.create(bot);
      const cardText = card => { const parts=[]; const visit=items=>{for(const e of items||[]){if(e.text?.content)parts.push(e.text.content);else if(e.tag==='markdown')parts.push(e.content);visit(e.elements);visit(e.columns);}};visit(card.elements||card.body?.elements);return parts.join('\n'); };
      const inProgress = card => JSON.stringify(card).includes('stop_steward');
      wrapped.sendText = async text => { const id = await bot.sendText(text); record('reply', { messageId: id, text, kind: 'text' }); return id; };
      wrapped.sendCard = async card => { const id = await bot.sendCard(card); record('reply', { messageId: id, title: card.header?.title?.content, text: cardText(card), kind: 'card', pending: inProgress(card) }); return id; };
      wrapped.patchCard = async (id, card) => { const result = await bot.patchCard(id, card); if (!inProgress(card)) record('reply', { messageId: id, title: card.header?.title?.content, text: cardText(card), kind: 'card', pending: false }); return result; };
      wrapped.sendFile = async file => { const id = await bot.sendFile(file); record('reply', { messageId: id, text: path.basename(file), kind: 'file' }); return id; };
      return wrapped;
    },
    async diff(operationId) {
      const op = events().find(e => e.id === operationId && e.type === 'operation' && e.name === 'team_draft_edit' && e.ok);
      if (!op || !/^[a-f0-9-]{36}$/.test(op.draftId) || ![op.beforeHash, op.afterHash].every(h => /^[a-f0-9]{64}$/.test(h))) throw Error('找不到这次修改');
      const dir = path.join(root, 'data/admin/team-lab/drafts', op.draftId, 'revisions');
      const [before, after] = await Promise.all([loadPackage(path.join(dir, op.beforeHash)), loadPackage(path.join(dir, op.afterHash))]);
      if (before.hash !== op.beforeHash || after.hash !== op.afterHash) throw Error('历史版本摘要不一致');
      return { operation: op, files: [...new Set([...before.files.keys(), ...after.files.keys()])].filter(f => !before.files.get(f)?.equals(after.files.get(f) || Buffer.alloc(0))).map(file => {
        const a = before.files.get(file), b = after.files.get(file), large = Math.max(a?.length || 0,b?.length || 0) > 200000;
        return { file, before: large ? '文件过大，请在本机查看该历史版本' : redact(a?.toString() || ''), after: large ? '文件过大，请在本机查看该历史版本' : redact(b?.toString() || ''), added: !a, removed: !b };
      }) };
    },
  };
  return api;
}
