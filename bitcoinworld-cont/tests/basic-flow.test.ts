// tests/basic-flow.test.ts
import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

/* ---- CV helpers ---- */
function cvToUint(cv: any): number {
  if (!cv) throw new Error("cvToUint: empty");
  if (cv.type === "uint") return Number(cv.value);
  if (cv.type === "ok")   return cvToUint(cv.value);
  throw new Error(`cvToUint: unexpected ${cv.type}`);
}
function cvToAscii(cv: any): string {
  if (cv.type === "string-ascii" || cv.type === "ascii") return cv.value;
  if (cv.type === "ok") return cvToAscii(cv.value);
  return "";
}
function showResult(label: string, res: any) {
  const flat =
    res?.type === "ok"
      ? `ok(${res.value?.type === "uint" ? Number(res.value.value) : JSON.stringify(res.value)})`
      : res?.type === "err"
      ? `err(${JSON.stringify(res.value)})`
      : JSON.stringify(res);
  console.log(`${label}: ${flat}`);
}

describe("Basic flow with LMSR: create -> buy-yes -> resolve YES -> redeem", () => {
  it("runs the full flow and logs balances, pool, and b", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const w1       = accounts.get("wallet_1")!;

    // getters
    const yesBal      = () => simnet.callReadOnlyFn("market", "get-yes-balance", [Cl.principal(w1)], w1).result;
    const yesSupply   = () => simnet.callReadOnlyFn("market", "get-yes-supply", [], w1).result;
    const pool        = () => simnet.callReadOnlyFn("market", "get-pool", [], w1).result;
    const qYes        = () => simnet.callReadOnlyFn("market", "get-q-yes", [], w1).result;
    const status      = () => simnet.callReadOnlyFn("market", "get-status", [], w1).result;
    const outcome     = () => simnet.callReadOnlyFn("market", "get-outcome", [], w1).result;
    const bValue      = () => simnet.callReadOnlyFn("market", "get-b", [], w1).result;
    const sbtcBalW1   = () => simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(w1)], w1).result;

    // contract principal (market) to read its sBTC on-ledger
    const marketPrincipal = Cl.contractPrincipal(deployer, "market");
    const sbtcBalMarket = () =>
      simnet.callReadOnlyFn("sbtc", "get-balance", [marketPrincipal], w1).result;

    function logState(tag: string) {
      console.log(
        `${tag} -> yesBal=${cvToUint(yesBal())}, yesSupply=${cvToUint(yesSupply())}, qYes=${cvToUint(qYes())}, pool=${cvToUint(pool())}, b=${cvToUint(bValue())}, sBTC[w1]=${cvToUint(sbtcBalW1())}, sBTC[market]=${cvToUint(sbtcBalMarket())}, status=${cvToAscii(status())}, outcome=${cvToAscii(outcome())}`
      );
    }

    console.log("=== INITIAL STATE ===");
    logState("start");

    // 1) seed sBTC to deployer and w1
    showResult("mint(deployer,5000)",
      simnet.callPublicFn("sbtc", "mint", [Cl.uint(5000), Cl.principal(deployer)], deployer).result);
    showResult("mint(w1,2000)",
      simnet.callPublicFn("sbtc", "mint", [Cl.uint(2000), Cl.principal(w1)],       deployer).result);

    // 2) create market with initial liquidity
    const createRes = simnet.callPublicFn("market", "create", [Cl.uint(1000)], deployer);
    showResult("create(1000)", createRes.result);
    logState("after create");

    // 3) progressive buy-yes: try amounts until one succeeds
    const tryAmts = [1, 5, 10, 20, 50, 100];
    let chosenAmt: number | null = null;
    let buyCost = 0;

    for (const amt of tryAmts) {
      const attempt = simnet.callPublicFn("market", "buy-yes", [Cl.uint(amt)], w1);
      showResult(`buy-yes(${amt})`, attempt.result);
      if (attempt.result.type === "ok") {
        chosenAmt = amt;
        buyCost = cvToUint(attempt.result);
        console.log(`--> chosen buy amount = ${chosenAmt}, LMSR cost = ${buyCost}`);
        break;
      }
    }

    if (chosenAmt === null) {
      throw new Error("All attempted buy-yes amounts failed (err). Consider lowering amount or adjusting b/liquidity.");
    }

    logState("after buy-yes");

    // 4) resolve YES
    const resolveRes = simnet.callPublicFn("market", "resolve", [Cl.stringAscii("YES")], deployer);
    showResult('resolve("YES")', resolveRes.result);
    logState("after resolve");

    // 5) redeem (w1)
    const poolAtResolve = cvToUint(pool());
    const redeemRes = simnet.callPublicFn("market", "redeem", [], w1);
    showResult("redeem()", redeemRes.result);
    const payout = cvToUint(redeemRes.result);
    logState("after redeem");

    // --- Assertions ---
    // payout equals pool at resolve (only YES minted)
    expect(payout).toBe(poolAtResolve);

    // YES burned, supply 0
    expect(yesBal()).toBeUint(0);
    expect(yesSupply()).toBeUint(0);

    // pool drained and market sBTC back to 0
    expect(cvToUint(pool())).toBe(0);
    expect(cvToUint(sbtcBalMarket())).toBe(0);

    // final sanity checks (non-negative)
    expect(cvToUint(sbtcBalW1())).toBeGreaterThanOrEqual(0);
    expect(cvToUint(bValue())).toBeGreaterThanOrEqual(0);
  });
});
