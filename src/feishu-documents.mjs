// 文档只通过当前团队协调机器人的 SDK 调用；凭据不进入 Agent。
import { createHash } from 'node:crypto';
import { readDocumentImage } from './document-visuals.mjs';

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
export function documentTransport(client, call, { uploadMs = 60000 } = {}) {
  const upload = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('文档图片上传超时，请重试同步')), uploadMs); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    async create(title) {
      const r = await call(() => client.docx.v1.document.create({ data: { title } }));
      if (!r.data?.document?.document_id) throw Error('创建文档未返回编号');
      return r.data.document.document_id;
    },
    async share(id, chatId) {
      await call(() => client.drive.v1.permissionMember.batchCreate({ path: { token: id }, params: { type: 'docx', need_notification: false }, data: { members: [{ member_type: 'openchat', member_id: chatId, type: 'chat', perm: 'edit' }] } }));
    },
    async append(id, markdown, token, { assets = {}, state = {}, save = async () => {} } = {}) {
      if (!state.batches) {
        const converted = await call(() => client.docx.v1.document.convert({ data: { content_type: 'markdown', content: markdown } }));
        const { blocks, first_level_block_ids: roots } = converted.data || {};
        if (!blocks?.length || !roots?.length) throw Error('文档转换没有返回内容');
        const images = converted.data.block_id_to_image_urls || [];
        for (const image of images) if (!assets[image.image_url]) throw Error('文档包含未准备的图片，已停止写入，请使用本项目图片或受支持的配图定义');
        const imageIds = new Set(blocks.filter(b => b.block_type === 27).map(b => b.block_id));
        if (imageIds.size !== images.length || new Set(images.map(i => i.block_id)).size !== images.length || images.some(i => !imageIds.has(i.block_id))) throw Error('图片块与素材映射不完整，已停止写入');
        state.images = images.map(i => ({ temporary: i.block_id, url: i.image_url }));
        state.batches = documentBatches(blocks, roots); state.next = 0; await save();
      }
      for (let i = state.next; i < state.batches.length; i++) {
        state.inserted ||= {};
        if (!state.inserted[i]) {
          const inserted = await call(() => client.docx.v1.documentBlockDescendant.create({ path: { document_id: id, block_id: id }, params: { document_revision_id: -1, client_token: batchToken(token, i) }, data: state.batches[i] }));
          const ids = new Set(state.batches[i].descendants.map(b => b.block_id));
          for (const image of (state.images || []).filter(image => ids.has(image.temporary))) {
            image.blockId = inserted.data?.block_id_relations?.find(r => r.temporary_block_id === image.temporary)?.block_id;
            if (!image.blockId) throw Error('图片插入回执缺少原生块编号，请保留同步状态后重试');
          }
          state.inserted[i] = true; await save();
        }
        for (const image of (state.images || []).filter(image => image.blockId && !image.done)) {
          const asset = assets[image.url]; if (!asset) throw Error('待同步版本缺少图片缓存');
          if (!image.fileToken) {
            const file = await readDocumentImage(asset);
            const uploaded = await upload(call(() => client.drive.v1.media.uploadAll({ data: { file_name: asset.name, parent_type: 'docx_image', parent_node: image.blockId, size: file.length, file } })));
            image.fileToken = uploaded?.file_token || uploaded?.data?.file_token;
            if (!image.fileToken) throw Error('图片上传没有返回素材编号');
            await save();
          }
          await call(() => client.docx.v1.documentBlock.patch({ path: { document_id: id, block_id: image.blockId }, params: { document_revision_id: -1 }, data: { replace_image: { token: image.fileToken } } }));
          const verified = await call(() => client.docx.v1.documentBlock.get({ path: { document_id: id, block_id: image.blockId } }));
          if (verified.data?.block?.image?.token !== image.fileToken) throw Error('图片已上传但飞书回读未确认绑定，请重试同步');
          image.done = true; await save();
        }
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
