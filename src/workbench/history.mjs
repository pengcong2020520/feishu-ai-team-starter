// File positions are stable when new events are appended. Card updates retain the
// original position so old cards don't jump into the latest conversation page.
export function messagePage(events, { projectId, after, before, cursor, loadedFrom, limit = 50 } = {}) {
  const cards = new Map(), rows = [];
  events.forEach((event, index) => {
    if (event.projectId ? projectId && event.projectId !== projectId : (after && event.at < after) || (before && event.at >= before)) return;
    if (event.kind === 'action_result') return;
    if (event.kind === 'card_update' && event.messageId && cards.has(event.messageId)) {
      const row = cards.get(event.messageId);
      Object.assign(row, { card: event.card || row.card, title: event.title || row.title, updatedAt: event.at });
      return;
    }
    const row = { ...event, index };
    rows.push(row);
    if (['card', 'card_update'].includes(row.kind) && row.messageId) cards.set(row.messageId, row);
  });
  if (cursor != null && (!Number.isSafeInteger(Number(cursor)) || Number(cursor) < 0)) throw Error('消息游标无效');
  const eligible = rows.filter(r => cursor == null || r.index < Number(cursor));
  const items = eligible.slice(-Math.min(100, Math.max(1, Number(limit) || 50)));
  return { items, updates: loadedFrom != null && Number.isSafeInteger(Number(loadedFrom)) ? rows.filter(r => r.updatedAt && r.index >= Number(loadedFrom)) : [], nextCursor: eligible.length > items.length ? items[0].index : null, total: rows.length };
}
