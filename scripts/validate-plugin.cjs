#!/usr/bin/env node
/**
 * Plugin 结构校验器
 *
 * 校验一个 plugin 目录（或解压后的 ZIP）是否符合 Plugin 规范。
 * 零外部依赖，纯 Node.js 实现。
 *
 * Usage:
 *   node validate-plugin.js <plugin-dir>
 *   node validate-plugin.js ./my-plugin
 *   node validate-plugin.js ./my-plugin.zip   (自动解压到临时目录后校验)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// ANSI colors
const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

class PluginValidator {
  constructor(pluginDir) {
    this.pluginDir = path.resolve(pluginDir);
    this.errors = [];
    this.warnings = [];
    this.passed = [];
    this.pluginJson = null;
  }

  error(check, msg) {
    this.errors.push({ check, msg });
  }

  warn(check, msg) {
    this.warnings.push({ check, msg });
  }

  pass(check) {
    this.passed.push(check);
  }

  fileExists(relativePath) {
    return fs.existsSync(path.join(this.pluginDir, relativePath));
  }

  readJson(relativePath) {
    const fullPath = path.join(this.pluginDir, relativePath);
    if (!fs.existsSync(fullPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch (e) {
      this.error(`JSON parse: ${relativePath}`, e.message);
      return null;
    }
  }

  isPathSafe(filePath) {
    const resolved = path.resolve(this.pluginDir, filePath);
    return resolved.startsWith(this.pluginDir);
  }

  // ─── Checks ───────────────────────────────────────────────

  checkPluginJson() {
    const check = 'plugin.json';

    if (!this.fileExists('plugin.json')) {
      this.error(check, 'plugin.json 不存在（唯一必填文件）');
      return false;
    }

    this.pluginJson = this.readJson('plugin.json');
    if (!this.pluginJson) return false;

    // Required fields
    if (!this.pluginJson.name || typeof this.pluginJson.name !== 'string') {
      this.error(check, '缺少必填字段 name（string）');
    }
    if (!this.pluginJson.description || typeof this.pluginJson.description !== 'string') {
      this.error(check, '缺少必填字段 description（string）');
    }

    // Version format
    if (this.pluginJson.version && !/^\d+\.\d+\.\d+/.test(this.pluginJson.version)) {
      this.warn(check, `version "${this.pluginJson.version}" 不符合语义化版本格式`);
    }

    // Category: free text, but should be present
    if (!this.pluginJson.category) {
      this.warn(check, 'category 字段未填写');
    }

    // Icon check
    if (this.pluginJson.icon && !this.pluginJson.icon.startsWith('http')) {
      const iconName = this.pluginJson.icon.replace(/^resources\//, '');
      if (!/^\p{Emoji}/u.test(this.pluginJson.icon)) {
        // Not emoji, check file exists
        if (!this.fileExists(`resources/${iconName}`)) {
          this.warn(check, `icon 文件 resources/${iconName} 不存在`);
        }
      }
    }

    if (this.errors.filter(e => e.check === check).length === 0) {
      this.pass(check);
    }
    return true;
  }

  checkSkills() {
    const check = 'skills/';
    const skillsDir = path.join(this.pluginDir, 'skills');

    if (!fs.existsSync(skillsDir)) {
      // skills/ is optional
      return;
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory());

    if (skillDirs.length === 0) {
      this.warn(check, 'skills/ 目录存在但为空');
      return;
    }

    for (const dir of skillDirs) {
      const skillName = dir.name;
      const skillMdPath = `skills/${skillName}/SKILL.md`;

      // Naming convention
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
        this.warn(`skill: ${skillName}`, '目录名应为 kebab-case（小写字母 + 数字 + 连字符）');
      }

      // SKILL.md must exist
      if (!this.fileExists(skillMdPath)) {
        this.error(`skill: ${skillName}`, `缺少 SKILL.md（skills/${skillName}/SKILL.md）`);
        continue;
      }

      // Check frontmatter
      const content = fs.readFileSync(path.join(this.pluginDir, skillMdPath), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) {
        this.error(`skill: ${skillName}`, 'SKILL.md 缺少 YAML frontmatter（---...---）');
        continue;
      }

      const fm = fmMatch[1];
      if (!fm.includes('name:')) {
        this.error(`skill: ${skillName}`, 'frontmatter 缺少必填字段 name');
      }
      if (!fm.includes('description:')) {
        this.error(`skill: ${skillName}`, 'frontmatter 缺少必填字段 description');
      }

      // Check display.txt format if exists
      const displayPath = `skills/${skillName}/display.txt`;
      if (this.fileExists(displayPath)) {
        const displayJson = this.readJson(displayPath);
        if (displayJson !== null) {
          if (!Array.isArray(displayJson)) {
            this.error(`skill: ${skillName}/display.txt`, '必须是 JSON 数组');
          } else {
            for (const entry of displayJson) {
              if (!entry.id || !entry.key || !entry.value) {
                this.error(`skill: ${skillName}/display.txt`, '每个条目必须有 id, key, value 字段');
                break;
              }
            }
          }
        }
      }
    }

    if (this.errors.filter(e => e.check.startsWith('skill')).length === 0) {
      this.pass(check);
    }
  }

  checkSubAgents() {
    const check = 'subAgents';

    if (!this.pluginJson) return;
    const declared = this.pluginJson.subAgents || [];
    if (declared.length === 0 && !fs.existsSync(path.join(this.pluginDir, 'subagents'))) {
      return; // No SubAgents, skip
    }

    for (const sa of declared) {
      const prefix = `subAgent: ${sa.id || '(no id)'}`;

      // Required fields
      if (!sa.id) {
        this.error(prefix, '缺少必填字段 id');
        continue;
      }
      if (!sa.description) {
        this.error(prefix, '缺少必填字段 description');
      }

      // Dual confirmation: directory must exist
      const dirPath = `subagents/${sa.id}`;
      if (!this.fileExists(dirPath)) {
        this.error(prefix, `物理目录 ${dirPath}/ 不存在（双重确认失败：有声明无目录）`);
        continue;
      }

      // prompt.md or systemPromptFile must be accessible
      const promptFile = sa.systemPromptFile || `subagents/${sa.id}/prompt.md`;
      if (!sa.systemPrompt && !this.fileExists(promptFile)) {
        this.warn(prefix, `systemPrompt 来源缺失：无内联 systemPrompt 且 ${promptFile} 不存在`);
      }

      // Check handler paths
      if (sa.customTools) {
        for (const tool of sa.customTools) {
          if (!tool.name) {
            this.error(prefix, 'customTools 条目缺少 name');
          }
          if (!tool.handler) {
            this.error(prefix, `customTool "${tool.name}" 缺少 handler 路径`);
          } else {
            if (!this.isPathSafe(tool.handler)) {
              this.error(prefix, `handler 路径越界：${tool.handler}`);
            } else if (!this.fileExists(tool.handler)) {
              this.error(prefix, `handler 文件不存在：${tool.handler}`);
            }
          }
          if (tool.parameters && tool.parameters.type !== 'object') {
            this.warn(prefix, `customTool "${tool.name}" 的 parameters.type 应为 "object"`);
          }
        }
      }

      // Check skills references
      if (sa.skills) {
        for (const ref of sa.skills) {
          const skillId = ref.id || ref.name;
          if (!skillId) {
            this.error(prefix, 'skills[] 条目缺少 id 或 name');
            continue;
          }
          // Only validate local skills (no colon = local)
          if (!skillId.includes(':')) {
            if (!this.fileExists(`skills/${skillId}/SKILL.md`)) {
              this.error(prefix, `引用的 Skill "${skillId}" 不存在（skills/${skillId}/SKILL.md）`);
            }
          }
          if (!['systemPrompt', 'indexed'].includes(ref.mode)) {
            this.error(prefix, `skills[].mode 必须为 "systemPrompt" 或 "indexed"，得到 "${ref.mode}"`);
          }
        }
      }
    }

    // Check for orphan directories (directory exists but no declaration)
    const subagentsDir = path.join(this.pluginDir, 'subagents');
    if (fs.existsSync(subagentsDir)) {
      const dirs = fs.readdirSync(subagentsDir, { withFileTypes: true }).filter(e => e.isDirectory());
      const declaredIds = new Set(declared.map(sa => sa.id));
      for (const dir of dirs) {
        if (!declaredIds.has(dir.name)) {
          this.warn(check, `subagents/${dir.name}/ 目录存在但未在 plugin.json → subAgents[] 中声明（会被跳过）`);
        }
      }
    }

    if (this.errors.filter(e => e.check.startsWith('subAgent')).length === 0 &&
        this.errors.filter(e => e.check === check).length === 0) {
      this.pass(check);
    }
  }

  checkCliTools() {
    const check = 'clis/';
    const clisJsonPath = 'clis/clis.json';

    if (!this.fileExists(clisJsonPath)) {
      // Check inline fallback
      if (this.pluginJson && this.pluginJson.cliTools) {
        this.warn(check, '使用了 plugin.json 内联 cliTools（推荐迁移到 clis/clis.json）');
      }
      return;
    }

    const clisJson = this.readJson(clisJsonPath);
    if (!clisJson) return;

    // Top-level must be { tools: [] }
    if (Array.isArray(clisJson)) {
      this.error(check, 'clis.json 顶层不能是数组，必须是 { "tools": [...] }');
      return;
    }
    if (!clisJson.tools || !Array.isArray(clisJson.tools)) {
      this.error(check, 'clis.json 缺少 tools 字段或 tools 不是数组');
      return;
    }

    for (const tool of clisJson.tools) {
      const prefix = `cli: ${tool.id || '(no id)'}`;

      if (!tool.id) {
        this.error(prefix, '缺少必填字段 id');
        continue;
      }
      if (!tool.source) {
        this.error(prefix, '缺少必填字段 source');
        continue;
      }

      // Validate source type
      const validTypes = ['npm-package', 'bundled-binary', 'node-cli'];
      if (!validTypes.includes(tool.source.type)) {
        this.error(prefix, `source.type 无效："${tool.source.type}"，应为 ${validTypes.join(' / ')}`);
        continue;
      }

      // Type-specific validation
      if (tool.source.type === 'npm-package') {
        if (!tool.source.packageName) {
          this.error(prefix, 'npm-package 类型缺少 packageName');
        }
      } else if (tool.source.type === 'bundled-binary') {
        if (!tool.source.platforms && !tool.source.path) {
          this.error(prefix, 'bundled-binary 类型缺少 platforms 或 path');
        }
        if (tool.source.platforms) {
          for (const [platform, config] of Object.entries(tool.source.platforms)) {
            if (config.path && !this.fileExists(config.path)) {
              this.error(prefix, `平台 ${platform} 的二进制文件不存在：${config.path}`);
            }
          }
        }
      } else if (tool.source.type === 'node-cli') {
        if (!tool.source.entry) {
          this.error(prefix, 'node-cli 类型缺少 entry');
        } else if (!this.fileExists(tool.source.entry)) {
          this.error(prefix, `entry 文件不存在：${tool.source.entry}`);
        }
      }

      // Exposure validation
      if (tool.exposure && !['declared-agents', 'all-agents'].includes(tool.exposure)) {
        this.error(prefix, `exposure 取值无效，应为 "declared-agents" 或 "all-agents"`);
      }
    }

    if (this.errors.filter(e => e.check.startsWith('cli')).length === 0) {
      this.pass(check);
    }
  }

  checkI18n() {
    const check = 'i18n';
    const i18nPath = 'resources/i18n.json';

    if (!this.fileExists(i18nPath)) return;

    const i18n = this.readJson(i18nPath);
    if (!i18n) return;

    // Must use entries format
    if (!i18n.entries || typeof i18n.entries !== 'object') {
      this.error(check, 'i18n.json 必须使用 entries 格式（{ "entries": { ... } }），不支持扁平格式');
      return;
    }

    if (!i18n.defaultLocale) {
      this.warn(check, '缺少 defaultLocale 字段');
    }

    // Validate entries structure
    for (const [key, translations] of Object.entries(i18n.entries)) {
      if (typeof translations !== 'object' || Array.isArray(translations)) {
        this.error(check, `entries["${key}"] 必须是对象 { "locale": "translation" }`);
      }
    }

    this.pass(check);
  }

  checkResources() {
    const check = 'resources/';
    const resourcesDir = path.join(this.pluginDir, 'resources');

    if (!fs.existsSync(resourcesDir)) return;

    // Check recommend.json format
    if (this.fileExists('resources/recommend.json')) {
      const recommend = this.readJson('resources/recommend.json');
      if (recommend !== null && !Array.isArray(recommend)) {
        this.error(check, 'recommend.json 必须是数组');
      }
    }

    this.pass(check);
  }

  checkPathSafety() {
    const check = 'path-safety';

    if (!this.pluginJson) return;

    // Check all file references in plugin.json
    const pathFields = [];

    if (this.pluginJson.subAgents) {
      for (const sa of this.pluginJson.subAgents) {
        if (sa.systemPromptFile) pathFields.push(sa.systemPromptFile);
        if (sa.customTools) {
          for (const t of sa.customTools) {
            if (t.handler) pathFields.push(t.handler);
          }
        }
      }
    }

    for (const p of pathFields) {
      if (!this.isPathSafe(p)) {
        this.error(check, `路径越界（穿越插件根目录）：${p}`);
      }
    }

    if (this.errors.filter(e => e.check === check).length === 0) {
      this.pass(check);
    }
  }

  // ─── Run ──────────────────────────────────────────────────

  run() {
    console.log('');
    console.log(c.bold(c.cyan('╔══════════════════════════════════════════════════════╗')));
    console.log(c.bold(c.cyan('║')) + '  🔍 Plugin Validator                         ' + c.bold(c.cyan('║')));
    console.log(c.bold(c.cyan('╚══════════════════════════════════════════════════════╝')));
    console.log('');
    console.log(c.dim(`  Target: ${this.pluginDir}`));
    console.log('');

    // Run all checks
    const hasPluginJson = this.checkPluginJson();
    if (hasPluginJson) {
      this.checkSkills();
      this.checkSubAgents();
      this.checkCliTools();
      this.checkI18n();
      this.checkResources();
      this.checkPathSafety();
    }

    // Report
    console.log(c.bold('  ─── Results ───────────────────────────────────────'));
    console.log('');

    if (this.passed.length > 0) {
      for (const p of this.passed) {
        console.log(`  ${c.green('✓')} ${p}`);
      }
    }

    if (this.warnings.length > 0) {
      console.log('');
      console.log(c.bold(c.yellow(`  ⚠ Warnings (${this.warnings.length}):`)));
      for (const w of this.warnings) {
        console.log(`    ${c.yellow('⚠')} [${w.check}] ${w.msg}`);
      }
    }

    if (this.errors.length > 0) {
      console.log('');
      console.log(c.bold(c.red(`  ✗ Errors (${this.errors.length}):`)));
      for (const e of this.errors) {
        console.log(`    ${c.red('✗')} [${e.check}] ${e.msg}`);
      }
    }

    console.log('');
    console.log('  ───────────────────────────────────────────────────');

    if (this.errors.length === 0) {
      console.log(`  ${c.bold(c.green('✅ PASS'))} — Plugin 结构校验通过`);
      console.log(`     ${c.dim(`${this.passed.length} checks passed, ${this.warnings.length} warnings`)}`);
    } else {
      console.log(`  ${c.bold(c.red('❌ FAIL'))} — 发现 ${this.errors.length} 个错误，需要修复`);
    }
    console.log('');

    return this.errors.length === 0;
  }
}

// ─── Entry Point ──────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
  Usage: node validate-plugin.js <plugin-dir-or-zip>

  Examples:
    node validate-plugin.js ./my-plugin
    node validate-plugin.js ./my-plugin.zip

  Validates a Plugin directory structure against the spec.
    `);
    process.exit(0);
  }

  let targetDir = args[0];

  // Handle ZIP files
  if (targetDir.endsWith('.zip')) {
    if (!fs.existsSync(targetDir)) {
      console.error(c.red(`  Error: File not found: ${targetDir}`));
      process.exit(1);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-validate-'));
    try {
      execSync(`unzip -q -o "${path.resolve(targetDir)}" -d "${tmpDir}"`, { stdio: 'pipe' });
    } catch (e) {
      console.error(c.red(`  Error: Failed to unzip: ${e.message}`));
      process.exit(1);
    }
    // Find the plugin root (might be nested one level)
    const contents = fs.readdirSync(tmpDir).filter(f => !f.startsWith('.'));
    if (contents.length === 1 && fs.statSync(path.join(tmpDir, contents[0])).isDirectory()) {
      targetDir = path.join(tmpDir, contents[0]);
    } else {
      targetDir = tmpDir;
    }
    console.log(c.dim(`  (Extracted ZIP to temporary directory)`));
  }

  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`  Error: Directory not found: ${targetDir}`));
    process.exit(1);
  }

  const validator = new PluginValidator(targetDir);
  const success = validator.run();
  process.exit(success ? 0 : 1);
}

main();
