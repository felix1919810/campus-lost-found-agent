import { chromium } from 'playwright';
import { createApp } from '../src/server.mjs';
import { ROOT } from '../src/tools.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const out=path.join(ROOT,'runtime','qa');await mkdir(out,{recursive:true});
const server=await createApp({runtime:path.join(out,'app-runtime'),config:{mode:'demo',model:'none'}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'蓝色雨伞 → 查询并导出'}).click();
  await page.locator('.message.assistant').waitFor();
  assert.match(await page.locator('.message.assistant').textContent(),/LF-011/);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:/下载领取核对清单/}).click();const download=await downloadPromise;await download.saveAs(path.join(out,'downloaded-checklist.md'));
  await page.screenshot({path:path.join(out,'app-desktop.png'),fullPage:true});
  await page.reload();await page.locator('.message.assistant').waitFor();assert.match(await page.locator('.message.assistant').textContent(),/LF-001/);
  await page.getByRole('button',{name:'红色背包 → 无结果'}).click();await page.getByText(/没有匹配结果。我没有扩大/).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'app-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:900});await page.goto(pathToFileURL(path.join(ROOT,'presentation.html')).href);
  const slides=[];
  for(let i=0;i<10;i++){
    const active=page.locator('.slide.active');const overflow=await active.evaluate(el=>({x:el.scrollWidth>el.clientWidth,y:el.scrollHeight>el.clientHeight}));assert.deepEqual(overflow,{x:false,y:false});
    await active.screenshot({path:path.join(out,`slide-${String(i+1).padStart(2,'0')}.png`)});
    slides.push({page:i+1,overflow:false});if(i<9)await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Home');await page.locator('[aria-label="姓名"]').fill('演示姓名');
  const savedPromise=page.waitForEvent('download');await page.getByRole('button',{name:'保存填写后的 HTML'}).click();const saved=await savedPromise;await saved.saveAs(path.join(out,'personalized-test.html'));
  assert.equal(errors.length,0);
  await writeFile(path.join(out,'browser-results.json'),JSON.stringify({testedAt:new Date().toISOString(),browser:'Microsoft Edge (Playwright headless)',app:{query:true,download:true,reload:true,noMatch:true,mobileNoHorizontalOverflow:true},slides,errors},null,2));
  console.log('浏览器验证通过：查询、下载、刷新恢复、零结果、390px 手机布局、10 页幻灯片、封面编辑保存。');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
