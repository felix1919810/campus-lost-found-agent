import { configFromEnv, runAgent, DEMOS } from '../src/agent.mjs';
import { ROOT } from '../src/tools.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const config=configFromEnv();
if(config.mode!=='live' || !config.apiKey){console.error('尚未完成真实模型验收：请在 .env 设置 AGENT_MODE=live 和有效模型凭据，然后重新运行。不要将密钥发到聊天或写入 Git。');process.exitCode=1;}
else {
  const sessionId=randomUUID();
  try {
    const result=await runAgent({prompt:DEMOS[0],config,sessionId,runtime:path.join(ROOT,'runtime'),onEvent:e=>{if(e.type==='tool_end') console.log(`${e.name}: ${e.result.error?'失败':'完成'}`);}});
    const completed=result.events.filter(e=>e.type==='tool_end'&&!e.result.error).map(e=>e.name);
    if(!['load_skill','search_items','get_claim_guide','export_checklist'].every(n=>completed.includes(n)))throw new Error('模型没有完成要求的检索→指引→导出主路径，请检查日志与模型工具调用能力。');
    await mkdir(path.join(ROOT,'runtime'),{recursive:true});await writeFile(path.join(ROOT,'runtime','live-verification.json'),JSON.stringify({timestamp:new Date().toISOString(),model:config.model,events:result.events,answer:result.answer},null,2));
    console.log('真实模型主路径通过。验收记录：runtime/live-verification.json');
  }catch(e){console.error(e.message);process.exitCode=1;}
}
