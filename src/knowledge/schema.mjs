import { z } from 'zod';

export const pageId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const pageMeta = z.object({
  id: pageId, title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  sources: z.array(z.string().min(1).max(400)).min(1).max(20),
  status: z.enum(['proposed', 'confirmed', 'superseded']).default('proposed'),
  links: z.array(pageId).max(30).default([]),
}).strict();
export const pageInput = pageMeta.extend({ body: z.string().trim().min(1).max(32000) });
export const knowledgeManifest = z.object({
  format: z.literal('wiki/1'),
  pages: z.array(pageMeta.extend({
    path: z.string().regex(/^knowledge\/[a-z][a-z0-9-]{0,63}\.md$/),
    updatedAt: z.string().datetime().optional(),
  })).max(200),
}).strict();
