import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {X402Client,atomicAmount} from '../dist/index.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const origin='https://issuer.example',url=origin+'/mcp',asset='0x'+'1'.repeat(40),payTo='0x'+'2'.repeat(40);
const grant={origin,network:'eip155:8453',asset,payTo,allowedAmounts:['10000'],maxTotalAmount:'20000'};
const challenge=(changes={})=>({x402Version:2,resource:{url},accepts:[{scheme:'exact',network:'eip155:8453',asset,payTo,amount:'10000',...changes}]});
function client(options={}) {
 const c=new X402Client({spendGrants:[grant],...options}); c.signatures=[];
 c.signerPromise=Promise.resolve({address:'0x'+'3'.repeat(40),signTypedData:async args=>{c.signatures.push(args);return '0x'+'00'.repeat(65);}});
 return c;
}
function mockFetch(replies) {
 const requests=[]; const original=globalThis.fetch;
 globalThis.fetch=async input=>{requests.push(input); const r=replies.shift(); assert.ok(r,'unexpected request');return new Response(JSON.stringify(r.data??{}),{status:r.status??200,headers:r.headers});};
 return {requests,restore:()=>globalThis.fetch=original};
}
test('default signing authority is empty',async()=>{
 const c=client({spendGrants:[]});await assert.rejects(c.createPaymentPayload(challenge(),undefined,url));assert.equal(c.signatures.length,0);
});
test('changed rail price asset payee domain scheme refuse before signer',async()=>{
 for(const changes of [{network:'eip155:137'},{amount:'1000000000000000'},{asset:'0x'+'4'.repeat(40)},{payTo:'0x'+'5'.repeat(40)},{extra:{name:'Other Coin'}},{scheme:'upto'}]){
  const c=client();await assert.rejects(c.createPaymentPayload(challenge(changes),undefined,url));assert.equal(c.signatures.length,0);
 }
});
test('resource and version binding',async()=>{
 for(const resource of ['https://other.example/mcp',origin+'/different',url+'?new=1']) await assert.rejects(client().createPaymentPayload({...challenge(),resource},undefined,url));
 await assert.rejects(client().createPaymentPayload({...challenge(),x402Version:true},undefined,url));
 await assert.rejects(client().createPaymentPayload(challenge()));
});
test('unsafe and coerced atomic values refused; large decimal remains exact',()=>{
 for(const amount of [true,0,-1,1.5,'1.5','1e4','0010000','-1','0',null,2**53,1n<<256n]) assert.throws(()=>atomicAmount(amount));
 assert.equal(atomicAmount('9007199254740993'),9007199254740993n);
});
test('bigint signing and concurrent reservations cap signatures',async()=>{
 const c=client();const outcomes=await Promise.allSettled(Array.from({length:5},()=>c.createPaymentPayload(challenge(),undefined,url)));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);assert.equal(c.signatures.length,2);
 assert.equal(c.signatures[0].message.value,10000n);assert.equal(outcomes.find(r=>r.status==='fulfilled').value.payment.payload.authorization.value,'10000');
});
test('ambiguous signer failure retains reservation',async()=>{
 const c=client();let attempts=0;c.signerPromise=Promise.resolve({address:'0x'+'3'.repeat(40),signTypedData:async()=>{attempts++;throw Error('ambiguous');}});
 for(let i=0;i<3;i++) await assert.rejects(c.createPaymentPayload(challenge(),undefined,url));assert.equal(attempts,2);
});
test('lease origin scope caller auth and Request headers are preserved',async()=>{
 const c=new X402Client();c.adoptSessionPass(url,'SYNTHETIC','600');const tx=mockFetch([{}, {}, {}]);
 try {
 await c.request('GET',url);await c.request('GET','https://other.example/path');
 await c.fetch(new Request(url,{headers:{aUtHoRiZaTiOn:'Bearer CALLER'}}));
 assert.equal(tx.requests[0].headers.get('authorization'),'Bearer SYNTHETIC');assert.equal(tx.requests[1].headers.get('authorization'),null);
 assert.equal(tx.requests[2].headers.get('authorization'),'Bearer CALLER');assert.equal(tx.requests[2].headers.get('x-session-pass'),null);
 assert.equal(tx.requests[0].redirect,'manual');assert.equal(tx.requests[2].redirect,'manual');
 }finally{tx.restore();}
});
test('header casing cache actual expiry and redacted status',async()=>{
 const c=new X402Client(),tx=mockFetch([{headers:{'x-session-pass':'TOKEN','x-session-expires-in':'600'}}]);
 try{await c.request('GET',url);assert.equal(c.sessionStatus(url).active,true);assert.equal(c.isPassActive('https://other.example'),false);assert.equal(JSON.stringify(c.sessionStatus(url)).includes('TOKEN'),false);
 assert.throws(()=>c.adoptSessionPass(url,'TOKEN','9999999'));c.passes.get(origin).expiresAt=0;assert.equal(c.isPassActive(url),false);
 }finally{tx.restore();}
});
test('autoLease false forbids paid retry advance and cache',async()=>{
 const c=client({autoLease:false,autoAdvance:true}),tx=mockFetch([{status:402,data:challenge(),headers:{'x-session-pass':'TOKEN','x-session-expires-in':'600'}}]);
 try{assert.equal((await c.request('POST',url,{})).status,402);assert.equal(c.signatures.length,0);assert.equal(c.isPassActive(url),false);assert.equal(tx.requests[0].headers.get('x-wm-auto-advance'),null);}finally{tx.restore();}
});
test('one 402 retry replays exact body and then stops',async()=>{
 const c=client(),tx=mockFetch([{status:402,data:challenge()},{status:402,data:challenge()}]);
 try{assert.equal((await c.request('POST',url,{id:'stable'})).status,402);assert.equal(tx.requests.length,2);assert.equal(await tx.requests[0].text(),await tx.requests[1].text());assert.equal(c.signatures.length,1);}finally{tx.restore();}
});
test('lowercase challenge header works',async()=>{
 const c=client(),tx=mockFetch([{status:402,headers:{'payment-required':btoa(JSON.stringify(challenge()))}},{}]);
 try{assert.equal((await c.request('POST',url,{})).status,200);assert.equal(c.signatures.length,1);}finally{tx.restore();}
});
test('caller authorization suppresses signed retries',async()=>{
 const c=client(),tx=mockFetch([{status:402,data:challenge()}]);
 try{assert.equal((await c.request('POST',url,{}, {authorization:'Bearer CALLER'})).status,402);assert.equal(c.signatures.length,0);}finally{tx.restore();}
});
test('redirect returned without signing or following',async()=>{
 const c=client(),tx=mockFetch([{status:307,headers:{location:'https://other.example'}}]);
 try{assert.equal((await c.request('POST',url,{})).status,307);assert.equal(tx.requests.length,1);assert.equal(tx.requests[0].redirect,'manual');assert.equal(c.signatures.length,0);}finally{tx.restore();}
});
test('transport failure is never retried',async()=>{
 const c=client();const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('connection lost');};
 try{await assert.rejects(c.request('POST',url,{}));assert.equal(calls,1);assert.equal(c.signatures.length,0);}finally{globalThis.fetch=old;}
});
test('untrusted URL rejected before transport',async()=>{
 const c=new X402Client(),tx=mockFetch([]);
 try{for(const target of ['http://public.example/mcp','https://user:secret@example.com',url+'#fragment']) await assert.rejects(c.request('GET',target));assert.equal(tx.requests.length,0);}finally{tx.restore();}
});
