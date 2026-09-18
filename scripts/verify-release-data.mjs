import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 核验交付目录不含开发账号快照、固定行业样本和静态商品图。
 * directory 为待打包目录；返回检查文件数；发现污染或IO失败时抛错并阻止打包。
 * 规则针对已知泄漏入口，不代替对新业务数据源的人工审查。
 */
export async function assertCleanRelease(directory, { internalTest = false } = {}) {
  let checked = 0;
  const forbiddenText = /smart[\s_-]*watch|智能手表|MODULE_LIVE_DEMO|workctl-demo|127734059|127684037|https?:\/\/[^\s"']*alicdn\.com\/kf\//i;
  /** 递归检查文件；dir 是本层目录；无返回值，遇禁止项直接抛错。 */
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.name === 'internal-test-dify.json' && !internalTest) throw new Error('普通交付禁止携带内部测试密钥');
      if (entry.isSymbolicLink()) throw new Error('交付目录不能含未审查的符号链接');
      if (/demo-data|workctl-command-audit|startup-status|\.log$|^\.env$|desktop\.env|credentials|gateway-cli\.json/i.test(entry.name)) {
        throw new Error(`交付包含禁止的数据文件：${path.relative(directory, file)}`);
      }
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:js|cjs|mjs|json|html)$/i.test(entry.name)) {
        const content = await fs.readFile(file, 'utf8');
        if (forbiddenText.test(content) || /fetch\(['"]\/api\/demo/.test(content)) {
          throw new Error(`交付包含开发样本或固定行业默认值：${path.relative(directory, file)}`);
        }
        checked++;
      }
    }
  }
  await visit(directory);
  return checked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('请指定待检查的交付目录');
  console.log(`交付数据检查通过：${await assertCleanRelease(directory, { internalTest: process.argv.includes('--internal-test') })} 个文本文件`);
}
