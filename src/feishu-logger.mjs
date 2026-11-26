// SDK 的默认错误日志会展开 Axios 请求，包含 Authorization 和请求体。
// 这里只保留错误码；业务调用层另行记录飞书 code/msg，不输出原始请求。
export function createFeishuLogger(logger = console) {
  const report = (...items) => {
    const codes = [...new Set(items.flat(3).map(item => item?.response?.data?.code ?? item?.code).filter(Number.isFinite))];
    logger.error(`飞书 SDK 请求或连接异常${codes.length ? `（code ${codes.join('、')}）` : ''}`);
  };
  return { fatal: report, error: report, warn: report, info() {}, debug() {}, trace() {} };
}
