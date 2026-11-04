/** Framework-neutral examples, not a registered Coinbase AgentKit ActionProvider.
 * Hosts must register methods through the pinned framework's actual action API.
 * No wallet signing or settlement is performed by this adapter.
 */
import { z } from "zod";
import { X402Client } from "whitemagic-pay";

export const RecallMemorySchema = z.object({query:z.string().min(1),limit:z.number().int().min(1).max(20).default(5),tier:z.enum(["call","task","swarm"]).default("call")});
export const AcquireAdvanceSchema = z.object({amount:z.number().finite().positive().max(5).default(0.05)});
export const SettleAdvanceSchema = z.object({amount:z.number().finite().positive().max(5).default(0.05)});
export const ArbitrateMutexSchema = z.object({resource:z.string().min(1),contenders:z.array(z.string().min(1)).max(100),stakeUsd:z.literal(0).default(0)});
export interface EvmWalletProviderLike { getAddress(): Promise<string> | string; }

function rpcText(data: Record<string,unknown>): string {
  const body=data as {error?:unknown;result?:{isError?:boolean;content?:Array<{text?:string}>}};
  if (body.error || body.result?.isError) return "[WhiteMagic] Tool returned an error.";
  return body.result?.content?.[0]?.text ?? "[WhiteMagic] No text result returned.";
}
export class WhiteMagicActionProvider {
  public readonly name="whitemagic-transport-example";
  private readonly baseUrl:string;
  private readonly autoAdvance:boolean;
  private readonly clients=new Map<string,X402Client>();
  constructor(options:{baseUrl?:string;autoAdvance?:boolean}={}) {
    this.baseUrl=(options.baseUrl??"https://mcp.whitemagic.dev").replace(/\/$/,"");
    this.autoAdvance=options.autoAdvance===true;
  }
  private clientFor(address:string) {
    let client=this.clients.get(address);
    if (!client) {client=new X402Client({autoAdvance:this.autoAdvance,preferredTier:"call"});this.clients.set(address,client);}
    return client;
  }
  public supportsNetwork(network:{chainId:number}) {return [8453,42161,137].includes(network.chainId);}
  public async recallMemory(wallet:EvmWalletProviderLike,input:z.input<typeof RecallMemorySchema>) {
    const args=RecallMemorySchema.parse(input),address=await wallet.getAddress();
    const result=await this.clientFor(address).request("POST",this.baseUrl+"/mcp",{
      jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"memory.search",arguments:{query:args.query,limit:args.limit}},
    },{"X-Agent-ID":address,"X-Lease-Tier":args.tier});
    return result.status===200 ? rpcText(result.data) : `[WhiteMagic] Recall returned HTTP ${result.status}.`;
  }
  public async acquireAdvance(wallet:EvmWalletProviderLike,input:z.input<typeof AcquireAdvanceSchema>) {
    if (!this.autoAdvance) throw new Error("Advance acquisition requires explicit autoAdvance:true host consent");
    const args=AcquireAdvanceSchema.parse(input),address=await wallet.getAddress(),client=this.clientFor(address);
    const url=this.baseUrl+"/lease/advance";
    const response=await client.request("POST",url,{agent_id:address,amount:args.amount,request_key:true});
    const data=response.data;
    if (response.status===200 && data.status==="granted" && typeof data.session_pass==="string") {
      client.adoptSessionPass(url,data.session_pass,data.expires_in as string | number,"advance");
      return "[WhiteMagic] Advance granted; origin-scoped session cached. Token redacted.";
    }
    return `[WhiteMagic] Advance not granted (HTTP ${response.status}).`;
  }
  public async settleAdvance(_wallet:EvmWalletProviderLike,_input:z.input<typeof SettleAdvanceSchema>):Promise<string> {
    throw new Error("Direct wallet settlement is disabled in this unqualified example. Use a host-owned explicit signing policy.");
  }
  public async arbitrateMutex(wallet:EvmWalletProviderLike,input:z.input<typeof ArbitrateMutexSchema>) {
    const args=ArbitrateMutexSchema.parse(input),address=await wallet.getAddress();
    const result=await this.clientFor(address).request("POST",this.baseUrl+"/mcp",{
      jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"economy_chohan_arbitrate",arguments:{resource_id:args.resource,contenders:Array.from(new Set([address,...args.contenders])),stake:0}},
    });
    return result.status===200 ? rpcText(result.data) : `[WhiteMagic] Arbitration returned HTTP ${result.status}.`;
  }
}
