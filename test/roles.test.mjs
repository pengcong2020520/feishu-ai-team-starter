import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { roles } from '../src/agents/roles.mjs';

// 用户让助手改角色或技能后，这里先拦住"引用了不存在的文件"这类错误
test('每个角色的说明文件和技能文件都存在', () => {
  assert.ok(existsSync('prompts/shared.md'), '缺少 prompts/shared.md');
  for (const [key, role] of Object.entries(roles)) {
    assert.ok(existsSync(`prompts/${role.promptFile}`), `${role.name}（${key}）的说明文件 prompts/${role.promptFile} 不存在`);
    for (const skill of role.skills) {
      const [plugin, name] = skill.split(':');
      assert.equal(plugin, 'team', `${role.name} 的技能 ${skill} 不在插件 team 里`);
      assert.ok(existsSync(`team-skills/skills/${name}/SKILL.md`), `${role.name} 的技能 ${skill} 缺少 team-skills/skills/${name}/SKILL.md`);
    }
  }
});

test('技能插件名是 team', () => {
  assert.equal(JSON.parse(readFileSync('team-skills/.claude-plugin/plugin.json', 'utf8')).name, 'team');
});
