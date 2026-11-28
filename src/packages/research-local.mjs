import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
export async function readPdf({ url, startPage = 1, endPage, query }, fetcher) {
  const page = await fetcher(url, 0, true);
  if (!page.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('内容不是有效 PDF');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-pdf-'));
  try {
    const file = path.join(dir, 'source.pdf'); await writeFile(file, page.bytes, { mode: 0o600 });
    const { stdout } = await exec('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { timeout: 45000, maxBuffer: 20 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' } });
    const pages = stdout.split('\f'); if (!pages.at(-1).trim()) pages.pop();
    if (!stdout.trim()) throw Error('PDF 没有可提取文字；扫描件需要 OCR，未读取到内容');
    if (query) {
      const matches = pages.flatMap((text, i) => { const at = text.toLowerCase().indexOf(query.toLowerCase()); return at < 0 ? [] : [{ page: i + 1, snippet: text.slice(Math.max(0, at - 200), at + 1000) }]; }).slice(0, 25);
      return { url: page.url, fetchedAt: page.fetchedAt, totalPages: pages.length, query, text: matches.map(m => `[物理页 ${m.page}]\n${m.snippet}`).join('\n\n') || '未找到关键词', matches };
    }
    endPage ??= Math.min(startPage + 9, pages.length);
    if (startPage > pages.length || endPage > pages.length || endPage < startPage || endPage - startPage >= 20) throw Error(`页码无效或超过 20 页；文档共 ${pages.length} 个物理页`);
    const text = pages.slice(startPage - 1, endPage).map((text, i) => `[物理页 ${startPage + i}]\n${text}`).join('\n\n');
    if (text.length > 90000) throw Error('选取页数内容过多，请缩小页码范围');
    return { url: page.url, fetchedAt: page.fetchedAt, totalPages: pages.length, startPage, endPage, text };
  } catch (e) { if (e.code === 'ENOENT') throw Error('本机未安装 pdftotext（Poppler），请安装后重试'); throw Error(e.message?.startsWith('Command failed') ? 'PDF 提取失败或超时' : e.message); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
export function calculate({ op, values: v, rate, terminalGrowth = 0, sources = [] }) {
  if (!Array.isArray(v) || !v.length || v.length > 10000 || v.some(x => typeof x !== 'number' || !Number.isFinite(x))) throw Error('输入必须为有限数字数组');
  let result, formula;
  if (['subtract','divide','power','growth'].includes(op) && v.length !== 2) throw Error('此运算需要两个数');
  switch (op) {
    case 'add': result = v.reduce((a,b)=>a+b,0); formula='sum(values)'; break;
    case 'subtract': result=v[0]-v[1]; formula='a-b'; break;
    case 'multiply': result=v.reduce((a,b)=>a*b,1); formula='product(values)'; break;
    case 'divide': if(v[1]===0)throw Error('分母不能为零'); result=v[0]/v[1]; formula='a/b'; break;
    case 'power': result=v[0]**v[1]; formula='a^b'; break;
    case 'growth': if(v[0]<=0)throw Error('增长率基数必须为正；负基数请单独解释'); result=v[1]/v[0]-1; formula='期末/期初-1（比率，乘100才是百分数）'; break;
    case 'returns': {
      if(v.length<2||v.some(x=>x<=0))throw Error('收益计算需要至少两个正价格，按时间升序、同一复权口径');
      const returns=v.slice(1).map((x,i)=>x/v[i]-1);let peak=v[0],drawdown=0;for(const x of v){peak=Math.max(peak,x);drawdown=Math.min(drawdown,x/peak-1);}
      result={totalReturn:v.at(-1)/v[0]-1,periodReturns:returns,maxDrawdown:drawdown};formula='总收益=末/初-1；回撤=min(价格/此前最高价-1)，不含未计入价格的分红，不年化';break;
    }
    case 'dcf': {
      if(!Number.isFinite(rate)||!Number.isFinite(terminalGrowth)||rate<=terminalGrowth||rate<=0||terminalGrowth<=-1)throw Error('DCF 要求折现率 > 永续增长率，折现率 > 0，永续增长率 > -1');
      const present=v.reduce((sum,x,i)=>sum+x/(1+rate)**(i+1),0),terminal=v.at(-1)*(1+terminalGrowth)/(rate-terminalGrowth)/(1+rate)**v.length;
      result={presentCashFlows:present,presentTerminal:terminal,total:present+terminal};formula='年末现金流折现 + Gordon 永续终值折现；结果不是自动得到的股权每股价值';break;
    }
    default: throw Error('不支持的运算');
  }
  if(JSON.stringify(result).includes('null') || typeof result==='number'&&!Number.isFinite(result)) throw Error('计算溢出或结果非有限数');
  return { engine:'local-finance/1', inputs:{op,values:v,rate,terminalGrowth}, formula,result,sources, limitation:'仅验证数学运算；来源真实性、币种、期间、重述口径和假设需研究者核对。' };
}
