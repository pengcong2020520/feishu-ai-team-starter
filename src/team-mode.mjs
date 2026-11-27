import { readFileSync } from 'node:fs';
import path from 'node:path';

export const teamModeNames = { basic: '启航版', projects: '领航版' };

export function resolveTeamMode({ root = process.cwd(), env = process.env } = {}) {
  const read = name => {
    try { return JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const state = read('state.json'), registry = read('project-registry.json');
  const hasProjects = [...Object.values(state.groups || {}), ...(state.archived || [])].some(p => p.dedicated)
    || Object.keys(registry.requests || {}).length > 0;
  // 未配置的旧安装保持原模式；已有独立项目不能通过切基础版绕过分工权限。
  const mode = env.TEAM_MODE || (hasProjects ? 'projects' : 'basic');
  if (!Object.hasOwn(teamModeNames, mode)) throw Error('TEAM_MODE 只能是 basic（启航版）或 projects（领航版）');
  if (mode === 'basic' && hasProjects) throw Error('此目录已有独立项目，请保留领航版；体验启航版请使用新目录，不要删除原项目数据');
  return mode;
}
