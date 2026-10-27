import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { executeTool } from '../src/tools.mjs';
import { runAgent, DEMOS, callModel } from '../src/agent.mjs';
import { createApp } from '../src/server.mjs';

async function setup(t){const runtime=await mkdtemp(path.join(os.tmpdir(),'xunhui-test-'));t.after(()=>rm(runtime,{recursive:true,force:true}));return {runtime,sessionId:randomUUID(),observed:new Set(),skillLoaded:false,guideLoaded:false};}
test('检索条件取交集、排除已归还物品，并支持常见别称',async t=>{
  const ctx=await setup(t);
  const r=await executeTool('search_items',{category:'伞',color:'蓝',location:'图书馆'},ctx);
  assert.deepEqual(r.items.map(i=>i.id),['LF-001','LF-011']);
  const returned=await executeTool('search_items',{category:'耳机',color:'黑色',location:''},ctx);assert.equal(returned.count,0);
});
test('导出校验先决条件、候选编号与状态；不能把任意路径作为参数',async t=>{
  const ctx=await setup(t);
  await assert.rejects(executeTool('export_checklist',{ids:['LF-001']},ctx),/Skill/);
  await executeTool('load_skill',{},ctx);await executeTool('get_claim_guide',{},ctx);
  await assert.rejects(executeTool('export_checklist',{ids:['LF-001']},ctx),/已检索/);
  await executeTool('get_item',{id:'LF-001'},ctx);
  await assert.rejects(executeTool('export_checklist',{ids:['LF-001'],path:'../../x'},ctx),/参数/);
  const r=await executeTool('export_checklist',{ids:['LF-001','LF-001']},ctx);
  const content=await readFile(path.join(ctx.runtime,'exports',ctx.sessionId,r.filename),'utf8');assert.match(content,/LF-001/);assert.match(content,/不是认领凭证/);assert.equal(r.ids.length,1);
  await executeTool('get_item',{id:'LF-010'},ctx);
  await assert.rejects(executeTool('export_checklist',{ids:['LF-010']},ctx),/已归还/);
});
test('离线演练实际执行 LangGraph 工具循环并创建文件',async t=>{
  const ctx=await setup(t);const r=await runAgent({...ctx,prompt:DEMOS[0],config:{mode:'demo'}});
  assert.deepEqual(r.events.filter(e=>e.type==='tool_end').map(e=>e.name),['load_skill','search_items','get_claim_guide','export_checklist']);
  assert.match(r.answer,/未调用模型/);assert.equal((await readdir(path.join(ctx.runtime,'exports',ctx.sessionId))).length,1);
});
test('零结果不生成文件，不支持的话术不伪装成 AI 对话',async t=>{
  const ctx=await setup(t);const r=await runAgent({...ctx,prompt:DEMOS[2],config:{mode:'demo'}});
  assert.match(r.answer,/没有匹配/);assert.ok(!r.events.some(e=>e.name==='export_checklist'));
  const other=await runAgent({...ctx,prompt:'随便查一查',config:{mode:'demo'}});assert.match(other.answer,/不进行自然语言理解/);
});
test('OpenAI 兼容适配器发送工具定义，并把模型选出的工具结果反馈给模型（本地桩）',async t=>{
  const ctx=await setup(t);const requests=[];
  const stub=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const data=JSON.parse(body);requests.push(data);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:requests.length===1?{role:'assistant',content:null,tool_calls:[{id:'call-test',type:'function',function:{name:'get_item',arguments:'{"id":"LF-003"}'}}]}:{role:'assistant',content:'候选 LF-003 是白色耳机盒。'}}]}));});
  await new Promise(r=>stub.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>stub.close(r)));
  const r=await runAgent({...ctx,prompt:'帮我查 LF-003',config:{mode:'live',baseURL:`http://127.0.0.1:${stub.address().port}/v1`,apiKey:'test-only',model:'stub'}});
  assert.equal(requests[0].tools.length,5);const toolResult=requests[1].messages.findLast(m=>m.role==='tool');assert.equal(toolResult.tool_call_id,'call-test');assert.match(toolResult.content,/白色无线耳机盒/);assert.match(r.answer,/LF-003/);
});
test('无密钥明确报错，未知工具反馈错误，模型循环有上限',async t=>{
  await assert.rejects(callModel([],{apiKey:''}),/未配置/);
  const ctx=await setup(t);const provider=async()=>({role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'not_a_tool',arguments:'{}'}}]});
  const events=[];await assert.rejects(runAgent({...ctx,prompt:'test',config:{mode:'live'},provider,onEvent:e=>events.push(e)}),/上限/);assert.ok(events.some(e=>e.result?.error==='未知工具'));
});
test('HTTP 完整流程：会话保存、文件下载、重启恢复、跨站访问限制',async t=>{
  const ctx=await setup(t);let server=await createApp({runtime:ctx.runtime,config:{mode:'demo',model:'none'}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(r=>server.close(r)));
  const session=await (await fetch(`${base}/api/sessions`,{method:'POST'})).json();
  const response=await fetch(`${base}/api/chat`,{method:'POST',body:JSON.stringify({sessionId:session.id,prompt:DEMOS[0]})});
  const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done');
  const file=events.find(e=>e.result?.url);assert.equal((await fetch(base+file.result.url)).status,200);
  assert.equal((await fetch(base+'/api/sessions',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  await new Promise(r=>server.close(r));server=await createApp({runtime:ctx.runtime,config:{mode:'demo',model:'none'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  const restored=await (await fetch(`${base}/api/sessions/${session.id}`)).json();assert.equal(restored.turns.length,1);assert.match(restored.turns[0].answer,/LF-001/);
});
