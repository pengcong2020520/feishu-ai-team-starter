// 文档只通过当前团队协调机器人的 SDK 调用；凭据不进入 Agent。
import { createHash } from 'node:crypto';

export function documentBatches(blocks, roots) {
  const map = new Map(blocks.map(b => [b.block_id, structuredClone(b)])), seen = new Set(), batches = [];
  if (map.size !== blocks.length) throw Error('文档转换返回重复块');
  let batch = { children_id: [], descendants: [], index: -1 };
  const collect = (id, list) => {
    const block = map.get(id); if (!block || seen.has(id)) throw Error('文档块缺失或层级重复');
    seen.add(id); list.push(block);
    for (const child of block.children || []) collect(child, list);
    delete block.parent_id; if (block.table?.property) delete block.table.property.merge_info;
  };
  for (const id of roots) {
    const tree = []; collect(id, tree);
    // 一张表必须保持完整；预先检查全部树，不能写到中途才发现无法拆分。
    if (tree.length > 1000) throw Error('单张表格或嵌套段落超过 1000 块，请拆分该段内容');
    if (batch.children_id.length >= 50 || batch.descendants.length + tree.length > 1000) { batches.push(batch); batch = { children_id: [], descendants: [], index: -1 }; }
    batch.children_id.push(id); batch.descendants.push(...tree);
  }
  if (seen.size !== blocks.length) throw Error('文档转换包含未关联的块');
  if (batch.children_id.length) batches.push(batch);
  return batches;
}
function batchToken(token, index) {
  if (!index) return token;
  const b = createHash('sha256').update(`${token}:${index}`).digest().subarray(0, 16); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
  const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function documentTransport(client, call) {
  return {
    async create(title) {
      const r = await call(() => client.docx.v1.document.create({ data: { title } }));
      if (!r.data?.document?.document_id) throw Error('创建文档未返回编号');
      return r.data.document.document_id;
    },
    async share(id, chatId) {
      await call(() => client.drive.v1.permissionMember.batchCreate({ path: { token: id }, params: { type: 'docx', need_notification: false }, data: { members: [{ member_type: 'openchat', member_id: chatId, type: 'chat', perm: 'edit' }] } }));
    },
    async append(id, markdown, token, { state = {}, save = async () => {} } = {}) {
      if (!state.batches) {
        const converted = await call(() => client.docx.v1.document.convert({ data: { content_type: 'markdown', content: markdown } }));
        const { blocks, first_level_block_ids: roots } = converted.data || {};
        if (!blocks?.length || !roots?.length) throw Error('文档转换没有返回内容');
        state.batches = documentBatches(blocks, roots); state.next = 0; await save();
      }
      for (let i = state.next; i < state.batches.length; i++) {
        await call(() => client.docx.v1.documentBlockDescendant.create({ path: { document_id: id, block_id: id }, params: { document_revision_id: -1, client_token: batchToken(token, i) }, data: state.batches[i] }));
        state.next = i + 1; await save();
      }
    },
    async comments(id) {
      const result = []; let page_token;
      do {
        const r = await call(() => client.drive.v1.fileComment.list({ path: { file_token: id }, params: { file_type: 'docx', page_size: 50, page_token } }));
        for (const comment of r.data?.items || []) {
          // 单条评论的回复也可能分页，不能只取首页。
          if (comment.has_more) {
            let cursor = comment.page_token;
            do {
              const replies = await call(() => client.drive.v1.fileCommentReply.list({ path: { file_token: id, comment_id: comment.comment_id }, params: { file_type: 'docx', page_size: 50, page_token: cursor } }));
              (comment.reply_list ||= { replies: [] }).replies.push(...replies.data?.items || []);
              cursor = replies.data?.has_more ? replies.data.page_token : null;
            } while (cursor);
          }
          result.push(comment);
        }
        page_token = r.data?.has_more ? r.data.page_token : null;
      } while (page_token);
      return result;
    },
  };
}
