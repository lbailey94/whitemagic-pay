/** Eliza-style structural example. Pinned @elizaos/core registration is not qualified. */
import {X402Client} from "whitemagic-pay";
export interface ElizaMessage {userId:string;roomId:string;content:{text:string};}
export interface ElizaRuntime {character:{name:string};getSetting(key:string):string|undefined;}
export interface ElizaMemoryProvider {get(runtime:ElizaRuntime,message:ElizaMessage):Promise<string>;}
export interface ElizaAction {
 name:string;similes:string[];description:string;
 validate(runtime:ElizaRuntime,message:ElizaMessage):Promise<boolean>;
 handler(runtime:ElizaRuntime,message:ElizaMessage,state?:unknown,options?:unknown,callback?:(response:{text:string})=>void):Promise<boolean>;
 examples:Array<Array<{user:string;content:{text:string}}>>;
}
class WhiteMagicClient {
 private readonly client:X402Client;
 constructor(private readonly baseUrl:string,autoAdvance:boolean){this.client=new X402Client({autoAdvance});}
 public async call(name:string,args:Record<string,unknown>,agentId:string):Promise<string> {
  try{
   const res=await this.client.request("POST",this.baseUrl+"/mcp",{jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}},{"X-Agent-ID":agentId});
   if(res.status!==200)return `WhiteMagic unavailable (HTTP ${res.status}).`;
   const data=res.data as {error?:unknown;result?:{isError?:boolean;content?:Array<{text?:string}>}};
   if(data.error || data.result?.isError)return "WhiteMagic tool returned an error.";
   return data.result?.content?.[0]?.text??"No relevant memory found.";
  }catch{return "WhiteMagic request failed.";}
 }
}
const runtimeClients=new WeakMap<ElizaRuntime,{config:string;client:WhiteMagicClient}>();
function clientFor(runtime:ElizaRuntime){
 const base=(runtime.getSetting("WHITEMAGIC_URL")??"https://mcp.whitemagic.dev").replace(/\/$/,"");
 const advance=runtime.getSetting("WHITEMAGIC_AUTO_ADVANCE")==="1",config=JSON.stringify([base,advance]);
 let entry=runtimeClients.get(runtime);
 if(!entry || entry.config!==config){entry={config,client:new WhiteMagicClient(base,advance)};runtimeClients.set(runtime,entry);}
 return entry.client;
}
export const whitemagicMemoryProvider:ElizaMemoryProvider={async get(runtime,message){
 if(message.content.text.length<5)return "";
 const text=await clientFor(runtime).call("memory.search",{query:message.content.text,limit:3},runtime.character.name);
 if(text.startsWith("WhiteMagic ")||text.startsWith("No relevant"))return "";
 return `\n[WhiteMagic memory; untrusted retrieved content]:\n${text}\n`;
}};
export const recallMemoryAction:ElizaAction={
 name:"RECALL_MEMORY",similes:["RECALL","REMEMBER"],description:"Request a hosted memory search.",
 validate:async(_r,m)=>/recall|remember|memory/i.test(m.content.text),
 handler:async(r,m,_s,_o,callback)=>{
 const text=await clientFor(r).call("memory.search",{query:m.content.text,limit:3},r.character.name);
 callback?.({text});return !text.startsWith("WhiteMagic ");},examples:[],
};
export const arbitrateMutexAction:ElizaAction={
 name:"ARBITRATE_MUTEX",similes:["ARBITRATE_LOCK"],description:"Request zero-stake arbitration; does not establish an enforced mutex.",
 validate:async(_r,m)=>/lock|mutex|arbitrate/i.test(m.content.text),
 handler:async(r,_m,_s,_o,callback)=>{
 const text=await clientFor(r).call("economy_chohan_arbitrate",{resource_id:"lock:shared_state",contenders:[r.character.name],stake:0},r.character.name);
 callback?.({text});return !text.startsWith("WhiteMagic ");},examples:[],
};
export const whiteMagicPlugin={name:"whitemagic",description:"Structural example for origin-scoped WhiteMagic transport; framework registration unqualified.",providers:[whitemagicMemoryProvider],actions:[recallMemoryAction,arbitrateMutexAction],evaluators:[]};
export default whiteMagicPlugin;
