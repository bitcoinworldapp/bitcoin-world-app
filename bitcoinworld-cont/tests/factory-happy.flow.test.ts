// tests/factory-multi-markets.flow.test.ts
import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, cvToUint } from "./helpers";

const toU = (n: number) => Cl.uint(n);
const toP = (s: string) => Cl.principal(s);

// === IMPORTANT: ADMIN must match the constant inside the contract ===
const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";

const mint = (to: string, amount: number, signer: string) =>
  simnet.callPublicFn("sbtc-v2", "mint", [toU(amount), toP(to)], signer);

const balSbtc = (who: string) =>
  cvToUint(simnet.callReadOnlyFn("sbtc-v2", "get-balance", [toP(who)], who).result);

const getPool = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market-factory-v2", "get-pool", [toU(m)], addr("deployer")).result);

const getB = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market-factory-v2", "get-b", [toU(m)], addr("deployer")).result);

const yesSupply = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market-factory-v2", "get-yes-supply", [toU(m)], addr("deployer")).result);

const noSupply = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market-factory-v2", "get-no-supply", [toU(m)], addr("deployer")).result);

describe("Market Factory v2 - multi markets in parallel", () => {
  it("creates two markets, trades on both, resolves differently, winners redeem; pools drain and fees accounted", () => {
    const d  = addr("deployer"); // contract owner of sbtc-v2 in simnet
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const LP  = addr("wallet_5");
    const TM  = addr("wallet_6");
    const DRP = addr("wallet_7");
    const BRC = addr("wallet_8");

    // --- bootstrap balances ---
    // Mint must be signed by the sbtc-v2 contract owner (deployer),
    // but the recipient can be cualquier principal (incluido ADMIN).
    expect(mint(ADMIN, 120_000, d).result.type).toBe("ok"); // ADMIN usará esto en create-market
    expect(mint(w1, 1_000_000, d).result.type).toBe("ok");
    expect(mint(w2, 1_000_000, d).result.type).toBe("ok");
    expect(mint(w3, 1_000_000, d).result.type).toBe("ok");
    expect(mint(w4, 1_000_000, d).result.type).toBe("ok");

    // --- fees and recipients (admin-only, firmar como ADMIN) ---
    expect(simnet.callPublicFn("market-factory-v2","set-fees",[toU(300), toU(100)], ADMIN).result.type).toBe("ok");
    expect(simnet.callPublicFn(
      "market-factory-v2","set-fee-recipients",
      [toP(DRP), toP(BRC), toP(TM), toP(LP)],
      ADMIN
    ).result.type).toBe("ok");

    const M0 = 0, M1 = 1;

    // --- create markets (admin-only, y los fondos salen de ADMIN) ---
    expect(simnet.callPublicFn("market-factory-v2","create-market",[toU(M0), toU(50_000)], ADMIN).result.type).toBe("ok");
    expect(getPool(M0)).toBe(50_000);
    expect(getB(M0)).toBeGreaterThan(0);

    expect(simnet.callPublicFn("market-factory-v2","create-market",[toU(M1), toU(30_000)], ADMIN).result.type).toBe("ok");
    expect(getPool(M1)).toBe(30_000);
    expect(getB(M1)).toBeGreaterThan(0);

    // --- trades on M0 (note: 4 args m, amount, target-cap, max-cost) ---
    expect(
      simnet.callPublicFn("market-factory-v2","buy-yes-auto",[toU(M0), toU(100), toU(1_000_000), toU(50_000)], w1).result.type
    ).toBe("ok");
    expect(
      simnet.callPublicFn("market-factory-v2","buy-no-auto", [toU(M0), toU(200), toU(1_000_000), toU(50_000)], w2).result.type
    ).toBe("ok");

    // --- trades on M1 ---
    expect(
      simnet.callPublicFn("market-factory-v2","buy-no-auto", [toU(M1), toU(150), toU(1_000_000), toU(50_000)], w3).result.type
    ).toBe("ok");
    expect(
      simnet.callPublicFn("market-factory-v2","buy-yes-auto",[toU(M1), toU(120), toU(1_000_000), toU(50_000)], w4).result.type
    ).toBe("ok");

    // --- resolve (admin-only) ---
    expect(simnet.callPublicFn("market-factory-v2","resolve",[toU(M0), Cl.stringAscii("NO")], ADMIN).result.type).toBe("ok");
    expect(simnet.callPublicFn("market-factory-v2","resolve",[toU(M1), Cl.stringAscii("YES")], ADMIN).result.type).toBe("ok");

    // pools must be >0 prior to redeem
    expect(getPool(M0)).toBeGreaterThan(0);
    expect(getPool(M1)).toBeGreaterThan(0);

    // winners redeem
    const w2Before = balSbtc(w2);
    expect(simnet.callPublicFn("market-factory-v2","redeem",[toU(M0)], w2).result.type).toBe("ok");
    const w2After = balSbtc(w2);
    expect(w2After).toBeGreaterThan(w2Before);

    const w4Before = balSbtc(w4);
    expect(simnet.callPublicFn("market-factory-v2","redeem",[toU(M1)], w4).result.type).toBe("ok");
    const w4After = balSbtc(w4);
    expect(w4After).toBeGreaterThan(w4Before);

    // drain rest
    simnet.callPublicFn("market-factory-v2","redeem",[toU(M1)], w3);
    simnet.callPublicFn("market-factory-v2","redeem",[toU(M0)], w1);

    expect(getPool(M0)).toBe(0);
    expect(getPool(M1)).toBe(0);

    // supplies and fees sanity
    const ys0 = yesSupply(M0), ns0 = noSupply(M0);
    const ys1 = yesSupply(M1), ns1 = noSupply(M1);
    expect(ns0).toBe(0);
    expect(ys0).toBeGreaterThan(0);
    expect(ys1).toBe(0);
    expect(ns1).toBeGreaterThan(0);

    const lpBal = balSbtc(LP), drpBal = balSbtc(DRP), tmBal = balSbtc(TM);
    expect(lpBal).toBeGreaterThan(0);
    expect(drpBal).toBeGreaterThan(0);
    expect(tmBal).toBeGreaterThan(0);
  });
});
