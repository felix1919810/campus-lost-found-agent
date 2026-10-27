import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const items = JSON.parse(await readFile(path.join(ROOT, 'data/items.json'), 'utf8'));
const guide = JSON.parse(await readFile(path.join(ROOT, 'data/claim-guide.json'), 'utf8'));
const skill = await readFile(path.join(ROOT, 'skills/lost-found-checklist/SKILL.md'), 'utf8');
const text = z.string().max(160);
const definitions = {
  load_skill: { description: '读取失物查询与清单生成 Skill。查询或导出前先读取一次。', schema: z.object({}).strict() },
  search_items: { description: '按类别、颜色、地点搜索待认领物品。各非空条件取交集；无结果时不要擅自放宽条件。', schema: z.object({ category: text, color: text, location: text }).strict() },
  get_item: { description: '读取一个候选物品的权威公开详情；编号例如 LF-001。', schema: z.object({ id: z.string().regex(/^LF-\d{3}$/) }).strict() },
  get_claim_guide: { description: '获取有来源标注的演示领取核对指引，不代表学校实际制度。', schema: z.object({}).strict() },
  export_checklist: { description: '将已经检索过的待认领物品生成本地 Markdown 核对清单。必须先读取 Skill 和领取指引。不是认领操作。', schema: z.object({ ids: z.array(z.string().regex(/^LF-\d{3}$/)).min(1).max(10) }).strict() }
};
export const toolSpecs = Object.entries(definitions).map(([name, d]) => ({type:'function', function:{name, description:d.description, parameters:z.toJSONSchema(d.schema)}}));
const escapeMd = s => String(s).replace(/[\r\n]/g, ' ').replace(/[<>]/g, '');

export async function executeTool(name, args, ctx) {
  if (!Object.hasOwn(definitions, name)) throw new Error('未知工具');
  const parsed = definitions[name].schema.safeParse(args);
  if (!parsed.success) throw new Error('工具参数不符合约定，请检查字段和编号');
  const a = parsed.data;
  if (name === 'load_skill') { ctx.skillLoaded = true; return {name:'lost-found-checklist', content:skill}; }
  if (name === 'search_items') {
    const aliases = { '伞':'雨伞', '杯子':'水杯', '蓝':'蓝色', '黑':'黑色', '白':'白色' };
    const normalized = Object.fromEntries(Object.entries(a).map(([k,v]) => [k, aliases[v.trim()] || v.trim()]));
    const found = items.filter(item => item.status === '待认领' && Object.entries(normalized).every(([k,v]) => !v || item[k].includes(v)));
    found.forEach(i => ctx.observed.add(i.id));
    return {source:'本地虚构样例 data/items.json', filters:normalized, count:found.length, items:found, note:'匹配仅代表候选，不证明所有权。'};
  }
  if (name === 'get_item') {
    const item = items.find(i => i.id === a.id);
    if (!item) throw new Error('未找到该物品编号');
    ctx.observed.add(item.id);
    return {source:'本地虚构样例 data/items.json', item};
  }
  if (name === 'get_claim_guide') {ctx.guideLoaded = true; return guide;}
  if (!ctx.skillLoaded || !ctx.guideLoaded) throw new Error('请先读取 Skill 和领取指引再生成清单');
  const ids = [...new Set(a.ids)];
  if (ids.some(id => !ctx.observed.has(id))) throw new Error('只能导出已检索并核对的候选物品');
  const selected = ids.map(id => items.find(i => i.id === id));
  if (selected.some(i => !i || i.status !== '待认领')) throw new Error('候选物品不存在或已归还');
  const filename = `checklist-${randomUUID()}.md`;
  const content = ['# 校园失物领取核对清单', '', '> 全部物品和地点均为课程演示样例。此清单不是认领凭证。', '',
    `生成时间：${new Date().toISOString()}`, '', '## 候选物品', '',
    ...selected.flatMap(i => [`### ${i.id} · ${escapeMd(i.name)}`, `- 拾获地点：${i.location}`, `- 拾获日期：${i.foundAt}`, `- 公开特征：${i.description}`, `- 核对地点：${i.desk}`, '- [ ] 由工作人员核验非公开特征与所有权', '']),
    '## 核对步骤', '', ...guide.steps.map(s => `- [ ] ${s}`), '', `来源：${guide.source}（${guide.version}）`, '', guide.notice, ''].join('\n');
  const dir = path.join(ctx.runtime, 'exports', ctx.sessionId);
  await mkdir(dir, {recursive:true});
  await writeFile(path.join(dir, filename), content, 'utf8');
  return {filename, url:`/api/files/${ctx.sessionId}/${filename}`, ids, note:'已写入本地工作目录，未提交认领、未对外发送。'};
}
