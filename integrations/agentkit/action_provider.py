"""Framework-neutral transport example; not registered as a Python AgentKit provider.

Use the target framework's pinned action API to register these methods. No SDK
fallback classes or decorator stubs claim compatibility when dependencies are absent.
"""
from whitemagic_pay import X402Client


class WhiteMagicActionProvider:
    def __init__(self, base_url="https://mcp.whitemagic.dev", auto_advance=False):
        self.base_url=base_url.rstrip("/")
        self.auto_advance=bool(auto_advance)
        self._clients={}

    def _client(self, wallet):
        address=wallet.get_address()
        if address not in self._clients:
            self._clients[address]=X402Client(auto_advance=self.auto_advance,preferred_tier="call")
        return address,self._clients[address]

    @staticmethod
    def _rpc_text(data):
        result=data.get("result",{})
        if data.get("error") or result.get("isError"):
            return "[WhiteMagic] Tool returned an error."
        content=result.get("content",[])
        return content[0].get("text","") if content else "[WhiteMagic] No text result returned."

    def recall_memory(self,wallet_provider,arguments):
        address,client=self._client(wallet_provider)
        limit=arguments.get("limit",5)
        if type(limit) is not int or not 1<=limit<=20:
            raise ValueError("limit must be an integer from 1 to 20")
        status,data,_=client.request("POST",self.base_url+"/mcp",{
            "jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"memory.search","arguments":{"query":arguments["query"],"limit":limit}}},
            {"X-Agent-ID":address})
        return self._rpc_text(data) if status==200 else f"[WhiteMagic] Recall returned HTTP {status}."

    def acquire_advance(self,wallet_provider,arguments):
        if not self.auto_advance:
            raise ValueError("advance acquisition requires explicit auto_advance=True host consent")
        address,client=self._client(wallet_provider)
        amount=arguments.get("amount",0.05)
        if type(amount) not in (float,int) or not 0<amount<=5:
            raise ValueError("advance amount must be positive and at most $5")
        url=self.base_url+"/lease/advance"
        status,data,_=client.request("POST",url,{"agent_id":address,"amount":amount,"request_key":True})
        if status==200 and data.get("status")=="granted" and data.get("session_pass"):
            client.adopt_session_pass(url,data["session_pass"],data.get("expires_in"),"advance")
            return "[WhiteMagic] Advance granted; origin-scoped session cached. Token redacted."
        return f"[WhiteMagic] Advance not granted (HTTP {status})."

    def settle_advance(self,*args,**kwargs):
        raise RuntimeError("direct wallet settlement is disabled; use a host-owned explicit signing policy")

    def arbitrate_mutex(self,wallet_provider,arguments):
        address,client=self._client(wallet_provider)
        if arguments.get("stake",0)!=0:
            raise ValueError("this transport example supports only zero-stake requests")
        contenders=list(dict.fromkeys([address,*arguments.get("contenders",[])]))
        status,data,_=client.request("POST",self.base_url+"/mcp",{
            "jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"economy_chohan_arbitrate","arguments":{
                    "resource_id":arguments["resource"],"contenders":contenders,"stake":0}}})
        return self._rpc_text(data) if status==200 else f"[WhiteMagic] Arbitration returned HTTP {status}."
