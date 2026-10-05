/**
 * Smoke test against the live hosted lane (no wallet required).
 *
 *   node scripts/smoke.mjs
 *
 * 1. Fresh client with no pass: expect a 402 challenge that parses to tiers.
 * 2. Claim the faucet pass: expect a session pass.
 * 3. Call memory.search with the pass: expect HTTP 200.
 */
import { X402Client, TIER_PRICES } from "../dist/index.js";

const BASE = "https://mcp.whitemagic.dev";
const call = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "memory.search", arguments: { query: "white magic" } },
};

const fresh = new X402Client();
const challengeRes = await fresh.request("POST", `${BASE}/mcp`, call);
console.log("fresh request status:", challengeRes.status);
if (challengeRes.status === 402) {
  const accepts = challengeRes.data.accepts ?? [];
  console.log("challenge parsed: accepts =", accepts.length);
  for (const a of accepts) {
    console.log("  tier:", a.amount, a.network, "->", a.payTo?.slice(0, 10) + "...");
  }
  const expected = Object.values(TIER_PRICES);
  const got = accepts.map((a) => Number(a.amount));
  if (!expected.every((p) => got.includes(p))) {
    console.error("MISSING TIERS: expected", expected, "got", got);
    process.exit(1);
  }
  console.log("all four tiers present in the challenge");
} else if (challengeRes.status === 200) {
  console.log("(anonymous tier answered 200; challenge skipped)");
} else {
  console.error("unexpected status:", challengeRes.status, JSON.stringify(challengeRes.data).slice(0, 300));
  process.exit(1);
}

const client = new X402Client();
const faucet = await client.claimFaucet(BASE);
console.log("faucet:", JSON.stringify(faucet).slice(0, 200));
if (!client.isPassActive()) {
  console.error("faucet did not yield an active pass");
  process.exit(1);
}

const paidRes = await client.request("POST", `${BASE}/mcp`, call);
console.log("pass request status:", paidRes.status);
if (paidRes.status !== 200) {
  console.error("expected 200 with the faucet pass, got", paidRes.status, JSON.stringify(paidRes.data).slice(0, 300));
  process.exit(1);
}
console.log("SMOKE OK");
