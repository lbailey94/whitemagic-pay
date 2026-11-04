import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WhiteMagicActionProvider} from '../agentkit/dist/action_provider.js';
import {recallMemoryAction,whitemagicMemoryProvider} from '../elizaos/dist/plugin.js';
function tx(replies){const old=globalThis.fetch,requests=[];globalThis.fetch=async request=>{requests.push(request);const r=replies.shift();assert.ok(r,'unexpected network action');return new Response(JSON.stringify(r.data??{}),{status:r.status??200,headers:r.headers});};return{requests,restore:()=>globalThis.fetch=old};}
const wallet=address=>({getAddress:()=>address,signTypedData:()=>{throw Error('wallet must never sign');}});
const runtime=()=>({character:{name:'same-name'},getSetting:()=>undefined});
const message={userId:'u',roomId:'r',content:{text:'recall previous context'}};
test('AgentKit example default advance and direct settlement fail before transport',async()=>{
 const c=new WhiteMagicActionProvider(),transport=tx([]);
 try{await assert.rejects(c.acquireAdvance(wallet('one'),{}));await assert.rejects(c.settleAdvance(wallet('one'),{}));assert.equal(transport.requests.length,0);}finally{transport.restore();}
});
test('advance token is redacted, cached for same wallet and isolated from another wallet',async()=>{
 const c=new WhiteMagicActionProvider({autoAdvance:true}),transport=tx([
 {data:{status:'granted',session_pass:'SYNTHETIC_SECRET',expires_in:600}},
 {data:{result:{content:[{text:'context'}]}}},{data:{result:{content:[{text:'other'}]}}}]);
 try{
 const text=await c.acquireAdvance(wallet('one'),{});assert.equal(text.includes('SYNTHETIC_SECRET'),false);
 await c.recallMemory(wallet('one'),{query:'recall'});await c.recallMemory(wallet('two'),{query:'recall'});
 assert.equal(transport.requests[1].headers.get('authorization'),'Bearer SYNTHETIC_SECRET');assert.equal(transport.requests[2].headers.get('authorization'),null);
 }finally{transport.restore();}
});
test('AgentKit HTTP 200 tool error is not success and paid arbitration is refused',async()=>{
 const c=new WhiteMagicActionProvider(),transport=tx([{data:{error:{message:'server failure'}}}]);
 try{assert.match(await c.recallMemory(wallet('one'),{query:'recall'}),/error/);await assert.rejects(c.arbitrateMutex(wallet('one'),{resource:'r',contenders:[],stakeUsd:0.01}));assert.equal(transport.requests.length,1);}finally{transport.restore();}
});
test('Eliza raw session headers are reused only by their runtime',async()=>{
 const one=runtime(),two=runtime(),transport=tx([
 {data:{result:{content:[{text:'context'}]}},headers:{'x-session-pass':'RUNTIME_TOKEN','x-session-expires-in':'600'}},
 {data:{result:{content:[{text:'context'}]}}},{data:{result:{content:[{text:'context'}]}}}]);
 try{await recallMemoryAction.handler(one,message);await recallMemoryAction.handler(one,message);await recallMemoryAction.handler(two,message);
 assert.equal(transport.requests[1].headers.get('authorization'),'Bearer RUNTIME_TOKEN');assert.equal(transport.requests[2].headers.get('authorization'),null);
 assert.equal(transport.requests[0].headers.get('x-wm-auto-advance'),null);
 }finally{transport.restore();}
});
test('Eliza tool errors are withheld from prompt context and return false',async()=>{
 const c=runtime(),transport=tx([{data:{result:{isError:true,content:[{text:'failed'}]}}},{data:{error:{message:'failed'}}}]);
 try{assert.equal(await whitemagicMemoryProvider.get(c,message),'');assert.equal(await recallMemoryAction.handler(c,message),false);}finally{transport.restore();}
});
