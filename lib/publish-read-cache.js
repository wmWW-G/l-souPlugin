'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/** 账号隔离的发布资料缓存；只接收服务端裁剪后的只读资料，不缓存任务、凭据或写入结果。 */
class PublishReadCache {
  /**
   * @param {{directory:string,scope:string,onEvent?:function}} options 系统缓存目录、账号范围和安全日志回调。
   * @returns {PublishReadCache} scope 为空时只启用内存缓存，防止未识别账号共用磁盘资料。
   * @throws {Error} 无效参数可能抛出；文件读取延迟到首次使用。
   */
  constructor({ directory, scope, onEvent = () => {} }) {
    this.file = scope ? path.join(directory, `publish-read-cache-${crypto.createHash('sha256').update(scope).digest('hex').slice(0, 16)}.json`) : null;
    this.onEvent = onEvent;
    this.entries = new Map();
    this.pending = new Map();
    this.generation = 0;
    this.initializing = null;
    this.writing = Promise.resolve();
    this.persisted = false;
  }

  /** 无参数；返回 Promise<void>，首次恢复本账号文件。损坏或缺失文件降级为空缓存，不抛文件异常。 */
  async initialize() {
    if (!this.initializing) this.initializing = (async () => {
      if (!this.file) return;
      try {
        const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.entries)) throw new Error('Invalid cache');
        for (const [key, entry] of saved.entries) {
          if (typeof key === 'string' && entry && Number.isFinite(entry.at) && entry.at > 0 && entry.value !== undefined) {
            this.entries.set(key, entry);
          }
        }
        this.persisted = true;
        this.onEvent('恢复发布资料本地缓存', true);
      } catch (error) {
        this.entries.clear();
        if (error.code !== 'ENOENT') this.onEvent('发布资料缓存损坏，重新读取', false);
      }
    })();
    await this.initializing;
  }

  /** 无参数；返回 Promise<void>。串行、0600 临时文件原子保存；失败记录日志并保留内存资料，不抛异常。 */
  async persist() {
    if (!this.file) return;
    this.writing = this.writing.then(async () => {
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ version: 1, entries: [...this.entries] }), { mode: 0o600 });
        await fs.rename(temporary, this.file);
        this.persisted = true;
      } catch {
        this.persisted = false;
        this.onEvent('发布资料未能保存到本地，暂用内存缓存', false);
      } finally { await fs.unlink(temporary).catch(() => {}); }
    });
    await this.writing;
  }

  /**
   * @param {string} key 服务端定义的资料键；不可使用浏览器提交的任意文件路径。
   * @param {function():Promise<*>} work 仅返回成功、已裁剪资料的读取函数，失败必须抛错。
   * @param {{maxAge?:number}} options 默认一直复用；写前校验传入有限有效期。
   * @returns {Promise<*>} 独立数据副本，避免调用方编辑引用污染缓存。
   * @throws {Error} 上游读取失败时透传，旧快照保留，不能假称更新成功。
   */
  async read(key, work, { maxAge = Infinity } = {}) {
    await this.initialize();
    const entry = this.entries.get(key);
    if (entry && !entry.invalidated && Date.now() - entry.at < maxAge) return structuredClone(entry.value);
    if (!this.pending.has(key)) {
      const generation = this.generation;
      const task = (async () => {
        const value = await work();
        if (generation !== this.generation) throw new Error('店铺资料正在更新，请重试');
        this.entries.set(key, { at: Date.now(), value: structuredClone(value) });
        await this.persist();
        return value;
      })();
      this.pending.set(key, task);
      task.finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); }).catch(() => {});
    }
    return structuredClone(await this.pending.get(key));
  }

  /**
   * @param {boolean} clear true 删除快照；false 保留旧资料但要求下次访问重读。
   * @returns {Promise<void>} 失效标记已落盘；隔离旧在途请求，避免回填过期资料。
   * @throws {Error} 文件异常内部降级；不影响已有编辑中的商品。
   */
  async invalidate(clear = false) {
    await this.initialize();
    this.generation += 1;
    this.pending.clear();
    if (clear) this.entries.clear();
    else for (const entry of this.entries.values()) entry.invalidated = true;
    await this.persist();
    this.onEvent(clear ? '清除发布资料缓存' : '主动更新发布资料', true);
  }

  /** @param {string} key 资料键。@returns {object} 可公开的缓存时间/状态；不返回路径、账号或资料。@throws {Error} 不主动抛错。 */
  status(key) {
    const entry = this.entries.get(key);
    return { savedLocally: this.persisted, fetchedAt: entry ? new Date(entry.at).toISOString() : null };
  }
}

module.exports = { PublishReadCache };
