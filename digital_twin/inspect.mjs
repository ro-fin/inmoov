import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
const runtime=JSON.parse(fs.readFileSync('../studio_runtime.json','utf8'));
await page.goto(runtime.url);
await page.waitForFunction(()=>window.studioDebug,{timeout:90000});
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(()=>{
 const d=window.studioDebug; const robot=d.robot;
 return {title:document.title,joints:Object.keys(robot.joints),size:document.querySelector('canvas').getBoundingClientRect().toJSON(),parts:d.renderer.info.render,firstJoint:robot.joints[d.keys[0]].limit,materials:[...new Set(Object.values(robot.links).flatMap(l=>l.children.map(o=>o.name)))].slice(0,10)};
}),null,2));
await page.screenshot({path:'preview.png',fullPage:true});
console.log({errors});
await browser.close();

