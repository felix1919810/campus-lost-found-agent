import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ROOT, items } from './tools.mjs';
import { configFromEnv, DEMOS, runAgent } from './agent.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (res, status, data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req) {
  let content='';
  for await (const chunk of req) {content+=chunk;if (Buffer.byteLength(content)>20000) throw new Error('请求过大');}
  return JSON.parse(content || '{}');
}
export async function createApp({runtime=path.join(ROOT,'runtime'), config=configFromEnv(), provider}={}) {
  await mkdir(path.join(runtime,'sessions'),{recursive:true});
  const busy = new Set();
  const sessionPath = id => {
    if (!UUID.test(id)) throw new Error('无效会话编号');
    return path.join(runtime,'sessions',`${id}.json`);
  };
  async function save(session) {
    const target=sessionPath(session.id), temp=`${target}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(session,null,2),'utf8');
    await rename(temp,target);
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    try {
      const host=req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(res,403,{error:'仅供本机访问'});
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res,403,{error:'不允许跨站请求'});
      const url = new URL(req.url,`http://${host}`), route=url.pathname;
      if (req.method==='GET' && route==='/api/status') return json(res,200,{mode:config.mode,model:config.model,configured:!!config.apiKey,demos:DEMOS, itemCount:items.length});
      if (req.method==='GET' && route==='/api/items') return json(res,200,{items});
      if (req.method==='GET' && route==='/api/sessions') {
        const files=(await readdir(path.join(runtime,'sessions'))).filter(f=>/^[0-9a-f-]+\.json$/.test(f));
        const sessions=await Promise.all(files.map(async f=>{const s=JSON.parse(await readFile(path.join(runtime,'sessions',f),'utf8'));return {id:s.id,title:s.title,updatedAt:s.updatedAt};}));
        return json(res,200,{sessions:sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
      }
      if (req.method==='POST' && route==='/api/sessions') {
        const session={id:randomUUID(),title:'新对话',updatedAt:new Date().toISOString(),messages:[],turns:[]};
        await save(session);return json(res,201,session);
      }
      if (req.method==='GET' && route.startsWith('/api/sessions/')) {
        const id=route.slice('/api/sessions/'.length);
        try {return json(res,200,JSON.parse(await readFile(sessionPath(id),'utf8')));}catch{return json(res,404,{error:'会话不存在'});}
      }
      if (req.method==='POST' && route==='/api/chat') {
        const input=await body(req);
        if (!UUID.test(input.sessionId || '') || typeof input.prompt!=='string' || !input.prompt.trim() || input.prompt.length>2000) return json(res,400,{error:'请提供有效会话和 1–2000 字的消息'});
        if (busy.has(input.sessionId)) return json(res,409,{error:'该会话仍在处理中，请等待完成'});
        let session;
        try {session=JSON.parse(await readFile(sessionPath(input.sessionId),'utf8'));}catch{return json(res,404,{error:'会话不存在，请新建对话'});}
        if (session.turns.length>=30) return json(res,400,{error:'本会话已达到 30 轮，请新建对话以控制上下文长度'});
        busy.add(session.id);
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        const emit = event => {if(!res.destroyed) res.write(JSON.stringify(event)+'\n');};
        try {
          const result=await runAgent({history:session.messages,prompt:input.prompt.trim(),config,runtime,sessionId:session.id,onEvent:emit,provider});
          session.messages=result.messages;
          session.turns.push({prompt:input.prompt.trim(),answer:result.answer,events:result.events,mode:config.mode});
          session.title=session.turns[0].prompt.slice(0,24);
          session.updatedAt=new Date().toISOString();
          await save(session);
          emit({type:'done',answer:result.answer});
        } catch (error) {emit({type:'error',error:error.message});}
        finally {busy.delete(session.id);res.end();}
        return;
      }
      const fileMatch=route.match(/^\/api\/files\/([0-9a-f-]+)\/(checklist-[0-9a-f-]+\.md)$/);
      if (req.method==='GET' && fileMatch && UUID.test(fileMatch[1])) {
        try {
          const file=await readFile(path.join(runtime,'exports',fileMatch[1],fileMatch[2]));
          res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${fileMatch[2]}"`});res.end(file);
        }catch{json(res,404,{error:'文件不存在'});}return;
      }
      const staticFiles={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      if (req.method==='GET' && staticFiles[route]) {
        const mime=route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html';
        res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`});res.end(await readFile(path.join(ROOT,'public',staticFiles[route])));return;
      }
      json(res,404,{error:'页面不存在'});
    }catch{if(!res.headersSent) json(res,400,{error:'请求格式错误或文件操作失败'});else res.end();}
  });
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT || 3210);
  const server=await createApp();
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用，请修改 .env 中的 PORT。`:'服务器启动失败。');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`寻回已启动：http://127.0.0.1:${port}\n运行模式：${configFromEnv().mode}。按 Ctrl+C 退出。`));
}
