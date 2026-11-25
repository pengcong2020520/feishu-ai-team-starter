export const ANTHROPIC_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];

// 终端里已有的 Anthropic 变量：返回变量名和地址给人看，值只交给 updateEnv 写入
export function anthropicEnv(env) {
  const found = ANTHROPIC_KEYS.filter(name => env[name]);
  const values = {};
  const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (key) {
    values.MODEL_API_KEY = key;
    values.MODEL_BASE_URL = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  }
  if (env.ANTHROPIC_MODEL) values.MODEL_NAME = env.ANTHROPIC_MODEL;
  return { found, baseUrl: env.ANTHROPIC_BASE_URL || null, values };
}

// 发一次 max_tokens 为 1 的请求；失败原因只写状态码和该改哪个变量
export async function checkModel({ baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 20000 }) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
  } catch (error) {
    return { ok: false, reason: `连不上 MODEL_BASE_URL（${error.cause?.code ?? error.name}）：检查地址和网络` };
  }
  if (res.ok) return { ok: true };
  let detail = '';
  try { detail = String((await res.json())?.error?.message ?? ''); } catch {}
  if (apiKey) detail = detail.replaceAll(apiKey, '***');
  detail = detail.slice(0, 120);
  const s = res.status;
  const why = s === 401 || s === 403 ? '密钥不对或没有权限：检查 MODEL_API_KEY'
    : s === 404 ? '接口地址不对：MODEL_BASE_URL 填 Anthropic 兼容入口，不带 /v1/messages'
    : s === 429 ? '额度或频率受限：稍后重试，或检查账户余额'
    : s >= 500 ? '模型服务出错：稍后重试'
    : '请求被拒绝：多半是 MODEL_NAME 不对';
  return { ok: false, reason: `${why}（HTTP ${s}${detail ? `：${detail}` : ''}）` };
}
