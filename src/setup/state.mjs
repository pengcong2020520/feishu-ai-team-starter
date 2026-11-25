import { team } from './team.mjs';

export const MODEL_KEYS = ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME'];
// 模板里的占位符（xxx、cli_xxx、example.com）算没填
const blank = value => !value || value === 'xxx' || value === 'cli_xxx' || value.includes('example.com');

export const missingModel = env => MODEL_KEYS.filter(name => blank(env[name]));
export const missingBots = env => team.filter(role => blank(env[`${role.prefix}APP_ID`]) || blank(env[`${role.prefix}APP_SECRET`]));

export function nextStage({ env, progress, depsReady, serviceRunning }) {
  if (missingModel(env).length) return 'model';
  if (!progress.modelOk) return 'model-check';
  if (!depsReady) return 'deps';
  if (missingBots(env).length) return 'feishu';
  if (!progress.groupReady) return 'group';
  if (!serviceRunning) return 'service';
  return 'done';
}
