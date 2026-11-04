import io
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import whitemagic_pay.client as module
from whitemagic_pay import SpendGrant, X402Client
from whitemagic_pay.policy import atomic_amount

ORIGIN = "https://issuer.example"
URL = ORIGIN + "/mcp"
ASSET = "0x" + "1" * 40
PAYEE = "0x" + "2" * 40


def challenge(**changes):
    offer = {"scheme": "exact", "network": "eip155:8453", "asset": ASSET,
             "payTo": PAYEE, "amount": "10000"}
    offer.update(changes)
    return {"x402Version": 2, "resource": {"url": URL}, "accepts": [offer]}


def client(grants=True, **options):
    grant = SpendGrant(ORIGIN, "eip155:8453", ASSET, PAYEE, ("10000",), "20000")
    c = X402Client(spend_grants=[grant] if grants else [], **options)
    c.signatures = []
    def sign(msg):
        c.signatures.append(msg)
        return SimpleNamespace(signature=bytes(65))
    c.account = SimpleNamespace(address="0x" + "3" * 40, sign_message=sign)
    return c


class Reply(io.BytesIO):
    def __init__(self, status, data=None, headers=None):
        super().__init__(json.dumps(data or {}).encode())
        self.status = status
        self.headers = headers or {}


class Transport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
    def open(self, request, **kwargs):
        self.requests.append(request)
        return self.responses.pop(0)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.encoder = patch.object(module, "encode_typed_data", create=True, side_effect=lambda **k: k)
        self.encoder.start()
    def tearDown(self):
        self.encoder.stop()

    def test_no_grant_never_signs(self):
        c = client(False)
        with self.assertRaises(ValueError):
            c.create_payment_payload(challenge(), request_url=URL)
        self.assertEqual(c.signatures, [])

    def test_policy_binding_rejects_each_changed_field(self):
        for changes in ({"network": "eip155:137"}, {"amount": "1000000000000000"},
                        {"asset": "0x" + "4" * 40}, {"payTo": "0x" + "5" * 40},
                        {"extra": {"name": "Other Coin"}}, {"scheme": "upto"}):
            with self.subTest(changes=changes):
                c = client()
                with self.assertRaises(ValueError):
                    c.create_payment_payload(challenge(**changes), request_url=URL)
                self.assertEqual(c.signatures, [])

    def test_resource_origin_path_query_and_version_are_bound(self):
        for resource in ("https://other.example/mcp", ORIGIN + "/different", URL + "?new=1"):
            c = client(); ch = challenge(); ch["resource"] = resource
            with self.assertRaises(ValueError): c.create_payment_payload(ch, request_url=URL)
        c = client(); ch = challenge(); ch["x402Version"] = True
        with self.assertRaises(ValueError): c.create_payment_payload(ch, request_url=URL)
        with self.assertRaises(ValueError): c.create_payment_payload(challenge())

    def test_malformed_atomic_values(self):
        for value in (True, 0, -1, 1.5, "1.5", "1e4", "0010000", "-1", "0", None, 2**256):
            with self.subTest(value=value), self.assertRaises(ValueError): atomic_amount(value)
        self.assertEqual(atomic_amount("9007199254740993"), 9007199254740993)

    def test_signer_receives_exact_integer_and_budget_is_reserved(self):
        c = client()
        p, _ = c.create_payment_payload(challenge(), request_url=URL)
        self.assertEqual(p["payload"]["authorization"]["value"], "10000")
        self.assertEqual(c.signatures[0]["full_message"]["message"]["value"], 10000)
        c.create_payment_payload(challenge(), request_url=URL)
        with self.assertRaises(ValueError): c.create_payment_payload(challenge(), request_url=URL)
        self.assertEqual(len(c.signatures), 2)

    def test_concurrent_budget_cannot_double_spend(self):
        c = client(); outcomes = []
        def issue():
            try: c.create_payment_payload(challenge(), request_url=URL); outcomes.append(True)
            except ValueError: outcomes.append(False)
        threads = [threading.Thread(target=issue) for _ in range(5)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(outcomes.count(True), 2)

    def test_ambiguous_signer_failure_keeps_reservation(self):
        c = client()
        c.account.sign_message = lambda _: (_ for _ in ()).throw(RuntimeError("signer unavailable"))
        for _ in range(2):
            with self.assertRaises(RuntimeError): c.create_payment_payload(challenge(), request_url=URL)
        with self.assertRaises(ValueError): c.create_payment_payload(challenge(), request_url=URL)

    def test_origin_cache_and_caller_authorization(self):
        c = X402Client()
        c.adopt_session_pass(URL, "SYNTHETIC", "600")
        tx = Transport(Reply(200), Reply(200), Reply(200))
        c._opener = tx
        c.request("GET", URL)
        c.request("GET", "https://other.example/path")
        c.request("GET", URL, headers={"aUtHoRiZaTiOn": "Bearer CALLER"})
        hdrs = [dict(req.header_items()) for req in tx.requests]
        self.assertEqual(hdrs[0]["Authorization"], "Bearer SYNTHETIC")
        self.assertNotIn("Authorization", hdrs[1]); self.assertNotIn("X-session-pass", hdrs[1])
        self.assertEqual(hdrs[2]["Authorization"], "Bearer CALLER")
        self.assertNotIn("X-session-pass", hdrs[2])

    def test_lowercase_lease_headers_and_expiry(self):
        c = X402Client()
        c._opener = Transport(Reply(200, headers={"x-session-pass": "TOKEN", "x-session-expires-in": "600"}))
        c.request("GET", URL)
        self.assertTrue(c.is_pass_active(URL)); self.assertFalse(c.is_pass_active("https://other.example"))
        with patch.object(module.time, "time", return_value=10**12): self.assertFalse(c.is_pass_active(URL))
        with self.assertRaises(ValueError): c.adopt_session_pass(URL, "TOKEN", "9999999")

    def test_auto_lease_false_disables_signing_advance_and_cache(self):
        c = client(auto_lease=False, auto_advance=True)
        c._opener = Transport(Reply(402, challenge(), {"x-session-pass": "TOKEN", "x-session-expires-in": "600"}))
        self.assertEqual(c.request("POST", URL, {})[0], 402)
        self.assertEqual(c.signatures, []); self.assertFalse(c.is_pass_active(URL))
        self.assertNotIn("X-wm-auto-advance", dict(c._opener.requests[0].header_items()))

    def test_only_one_402_retry_and_identical_body(self):
        c = client(); c._opener = Transport(Reply(402, challenge()), Reply(402, challenge()))
        self.assertEqual(c.request("POST", URL, {"id": "stable"})[0], 402)
        self.assertEqual(len(c._opener.requests), 2)
        self.assertEqual(c._opener.requests[0].data, c._opener.requests[1].data)
        self.assertEqual(len(c.signatures), 1)

    def test_lowercase_header_challenge(self):
        import base64
        c = client(); encoded = base64.b64encode(json.dumps(challenge()).encode()).decode()
        c._opener = Transport(Reply(402, {"message": "pay"}, {"payment-required": encoded}), Reply(200))
        self.assertEqual(c.request("POST", URL, {})[0], 200)
        self.assertEqual(len(c.signatures), 1)

    def test_redirect_is_returned_no_signing_and_no_cache(self):
        c = client(); c._opener = Transport(Reply(307, headers={"location": "https://other.example"}))
        self.assertEqual(c.request("POST", URL, {})[0], 307)
        self.assertEqual(len(c._opener.requests), 1); self.assertEqual(c.signatures, [])
        self.assertIsNone(module.NoRedirect().redirect_request(None,None,307,"",{},"https://other.example"))

    def test_caller_credentials_suppress_paid_retry(self):
        c = client(); c._opener = Transport(Reply(402, challenge()))
        self.assertEqual(c.request("POST", URL, {}, {"authorization":"Bearer CALLER"})[0],402)
        self.assertEqual(c.signatures, [])

    def test_untrusted_url_refused_before_transport(self):
        c = X402Client(); c._opener = Transport()
        for url in ("http://public.example/mcp", "https://user:secret@example.com", URL+"#fragment"):
            with self.assertRaises(ValueError): c.request("GET",url)
        self.assertEqual(c._opener.requests, [])

    def test_readme_notarize_parameters(self):
        c = X402Client(); c._opener = Transport(Reply(200,{"status":"fixture"}))
        c.notarize_context(context_digest="sha256:fixture",prompt_hash="sha256:fixture",action="fixture",model="fixture")
        payload=json.loads(c._opener.requests[0].data)
        self.assertEqual(set(payload),{"context_digest","prompt_hash","action","model"})
