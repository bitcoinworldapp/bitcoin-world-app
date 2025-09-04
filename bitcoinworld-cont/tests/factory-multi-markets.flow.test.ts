import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, cvToUint } from "./helpers";

const toU = (n: number) => Cl.uint(n);
const mint = (to: string, amount: number, signer: string) =>
  simnet.callPublicFn("sbtc", "mint", [toU(amount), Cl.principal(to)], signer);

const balSbtc = (who: string) =>
  cvToUint(simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(who)], who).result);

const getPool = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market", "get-pool", [toU(m)], addr("deployer")).result);

const getB = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market", "get-b", [toU(m)], addr("deployer")).result);

const yesSupply = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market", "get-yes-supply", [toU(m)], addr("deployer")).result);

const noSupply = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market", "get-no-supply", [toU(m)], addr("deployer")).result);

describe("Market Factory - multi markets in parallel", () => {
  it("creates two markets, trades on both, resolves differently, winners redeem; pools drain and fees accounted", () => {
    const d = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const LP  = addr("wallet_5");
    const TM  = addr("wallet_6");
    const DRP = addr("wallet_7");
    const BRC = addr("wallet_8");

    // bootstrap balances
    expect(mint(d, 100_000, d).result.type).toBe("ok");
    for (const u of [w1, w2, w3, w4]) {
      expect(mint(u, 1_000_000, d).result.type).toBe("ok");
    }

    // fees and recipients
    expect(simnet.callPublicFn("market","set-fees",[toU(300), toU(100)], d).result.type).toBe("ok");
    expect(simnet.callPublicFn(
      "market","set-fee-recipients",
      [Cl.principal(DRP), Cl.principal(BRC), Cl.principal(TM), Cl.principal(LP)],
      d
    ).result.type).toBe("ok");

    const M0 = 0, M1 = 1;

    // create markets
    expect(simnet.callPublicFn("market","create-market",[toU(M0), toU(50_000)], d).result.type).toBe("ok");
    expect(getPool(M0)).toBe(50_000);
    expect(getB(M0)).toBeGreaterThan(0);

    expect(simnet.callPublicFn("market","create-market",[toU(M1), toU(30_000)], d).result.type).toBe("ok");
    expect(getPool(M1)).toBe(30_000);
    expect(getB(M1)).toBeGreaterThan(0);

    // trades on M0 (note 4 args: m, amount, target-cap, max-cost)
    expect(
      simnet.callPublicFn("market","buy-yes-auto",[toU(M0), toU(100), toU(1_000_000), toU(50_000)], w1).result.type
    ).toBe("ok");
    expect(
      simnet.callPublicFn("market","buy-no-auto", [toU(M0), toU(200), toU(1_000_000), toU(50_000)], w2).result.type
    ).toBe("ok");

    // trades on M1
    expect(
      simnet.callPublicFn("market","buy-no-auto", [toU(M1), toU(150), toU(1_000_000), toU(50_000)], w3).result.type
    ).toBe("ok");
    expect(
      simnet.callPublicFn("market","buy-yes-auto",[toU(M1), toU(120), toU(1_000_000), toU(50_000)], w4).result.type
    ).toBe("ok");

    // resolve
    expect(simnet.callPublicFn("market","resolve",[toU(M0), Cl.stringAscii("NO")], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","resolve",[toU(M1), Cl.stringAscii("YES")], d).result.type).toBe("ok");

    const poolM0AtResolve = getPool(M0);
    const poolM1AtResolve = getPool(M1);
    expect(poolM0AtResolve).toBeGreaterThan(0);
    expect(poolM1AtResolve).toBeGreaterThan(0);

    // winners redeem
    const w2Before = balSbtc(w2);
    expect(simnet.callPublicFn("market","redeem",[toU(M0)], w2).result.type).toBe("ok");
    const w2After = balSbtc(w2);
    expect(w2After).toBeGreaterThan(w2Before);

    const w4Before = balSbtc(w4);
    expect(simnet.callPublicFn("market","redeem",[toU(M1)], w4).result.type).toBe("ok");
    const w4After = balSbtc(w4);
    expect(w4After).toBeGreaterThan(w4Before);

    // drain rest
    simnet.callPublicFn("market","redeem",[toU(M1)], w3);
    simnet.callPublicFn("market","redeem",[toU(M0)], w1);

    expect(getPool(M0)).toBe(0);
    expect(getPool(M1)).toBe(0);

    // supplies and fees
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
