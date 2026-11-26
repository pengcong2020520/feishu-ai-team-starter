import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeishuLogger } from '../src/feishu-logger.mjs';

test('SDK 错误不展开请求头、密钥或请求体，保留可定位的错误码', () => {
  const lines = [];
  const logger = createFeishuLogger({ error: value => lines.push(value) });
  const error = Object.assign(new Error('secret-in-message'), {
    config: { headers: { Authorization: 'Bearer secret-in-header' }, data: { app_secret: 'secret-in-body' } },
    response: { data: { code: 230027, msg: 'secret-in-response' } },
  });
  logger.error(['request failed', error]);
  logger.warn(error);
  logger.fatal('secret-in-string');
  logger.info(error);
  logger.debug(error);
  logger.trace(error);
  assert.deepEqual(lines, ['飞书 SDK 请求或连接异常（code 230027）', '飞书 SDK 请求或连接异常（code 230027）', '飞书 SDK 请求或连接异常']);
  assert.ok(lines.every(line => !line.includes('secret')));
});
