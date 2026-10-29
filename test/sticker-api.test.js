const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStickerApi } = require('../src/sticker-api');

async function fixture(t, overrides = {}) {
  const calls=[];
  const http={
    async post(url,body){
      calls.push({url,body});
      if(url.endsWith('/getMe'))return {data:{ok:true,result:{id:1}}};
      if(url.endsWith('/getStickerSet'))return {data:{ok:true,result:{name:'Cats',title:'Cats',stickers:[{file_id:'private-id',is_animated:true,emoji:'🐈'}]}}};
      return {data:{ok:true,result:{file_path:'stickers/a.tgs',file_size:4}}};
    },
    async get(){return {data:Buffer.from('test')};}
  };
  const app=express();app.use('/api/stickers',createStickerApi({token:'SECRET_TOKEN',http,...overrides}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {calls,get:path=>fetch(`http://127.0.0.1:${server.address().port}/api/stickers${path}`)};
}
test('health checks Telegram, caches the check, and exposes no credentials',async t=>{
  const f=await fixture(t);assert.deepEqual(await (await f.get('/health')).json(),{api:1,status:'connected',telegram:true});await f.get('/health');assert.equal(f.calls.length,1);
});
test('missing token reports limited without contacting Telegram',async t=>{
  const f=await fixture(t,{token:''});assert.equal((await (await f.get('/health')).json()).status,'limited');assert.equal(f.calls.length,0);assert.equal((await f.get('/packs/Cats')).status,503);
});
test('pack uses opaque tickets and downloads bounded files',async t=>{
  const f=await fixture(t);const response=await f.get('/packs/Cats');assert.equal(response.headers.get('cache-control'),'no-store');const p=await response.json();assert.equal(p.stickers[0].format,'tgs');assert.match(p.stickers[0].ticket,/^[a-f0-9]{48}$/);assert.ok(!JSON.stringify(p).includes('private-id'));assert.ok(!JSON.stringify(p).includes('SECRET_TOKEN'));assert.equal(await (await f.get('/files/'+p.stickers[0].ticket)).text(),'test');
});
test('invalid and expired tickets are rejected',async t=>{
  let time=1;const f=await fixture(t,{now:()=>time});assert.equal((await f.get('/packs/bad%20name')).status,400);assert.equal((await f.get('/files/not-a-ticket')).status,410);const p=await(await f.get('/packs/Cats')).json();time+=31*60000;assert.equal((await f.get('/files/'+p.stickers[0].ticket)).status,410);
});
test('upstream failures never expose token-bearing errors',async t=>{
  const f=await fixture(t,{http:{post:async()=>{throw new Error('https://api.telegram.org/botSECRET_TOKEN/getMe');}}});const res=await f.get('/packs/Cats');assert.equal(res.status,502);assert.ok(!(await res.text()).includes('SECRET_TOKEN'));
});
test('requests are rate limited',async t=>{
  const f=await fixture(t);for(let i=0;i<90;i++)await f.get('/files/missing');assert.equal((await f.get('/health')).status,429);
});
