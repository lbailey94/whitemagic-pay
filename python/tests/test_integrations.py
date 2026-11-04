import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from whitemagic_pay.cli import redact

spec=importlib.util.spec_from_file_location("agentkit_example",Path(__file__).resolve().parents[2]/"integrations/agentkit/action_provider.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Reply(io.BytesIO):
    def __init__(self,data):super().__init__(json.dumps(data).encode());self.status=200;self.headers={}
class Transport:
    def __init__(self,*rows):self.rows=list(rows);self.requests=[]
    def open(self,request,**kwargs):self.requests.append(request);return Reply(self.rows.pop(0))

class IntegrationTests(unittest.TestCase):
    def test_explicit_advance_redaction_and_wallet_scope(self):
        c=module.WhiteMagicActionProvider(auto_advance=True)
        one=SimpleNamespace(get_address=lambda:"one");two=SimpleNamespace(get_address=lambda:"two")
        _,client=c._client(one);tx=Transport({"status":"granted","session_pass":"SYNTHETIC","expires_in":600},{"result":{"content":[{"text":"context"}]}});client._opener=tx
        result=c.acquire_advance(one,{})
        self.assertNotIn("SYNTHETIC",result)
        c.recall_memory(one,{"query":"recall"})
        self.assertEqual(dict(tx.requests[1].header_items())["Authorization"],"Bearer SYNTHETIC")
        self.assertIsNot(c._client(two)[1],client)

    def test_default_advance_and_direct_settlement_disabled(self):
        c=module.WhiteMagicActionProvider()
        with self.assertRaises(ValueError):c.acquire_advance(None,{})
        with self.assertRaises(RuntimeError):c.settle_advance(None,{})

    def test_rpc_error_not_success_and_cli_redacts_nested_tokens(self):
        self.assertIn("error",module.WhiteMagicActionProvider._rpc_text({"result":{"isError":True}}))
        self.assertEqual(redact({"session_pass":"SECRET","nested":{"private_key":"SECRET"},"status":"ok"}),{"session_pass":"[redacted]","nested":{"private_key":"[redacted]"},"status":"ok"})
