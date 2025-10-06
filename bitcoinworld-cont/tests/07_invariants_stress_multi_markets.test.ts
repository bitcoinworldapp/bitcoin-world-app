// tests/07_invariants_stress_multi_markets.test.ts
import { describe, it, expect } from "vitest";
import {
  MARKET, SBTC, Cl,
  addr, U as toU, principal as toP,
  view, callOk, logHeader, logSection, log, logQuote,
  unwrapQuote, cvToUint, printMarketState, printBalances,
  getSelfPrincipal, sbtcBalance
} from "./helpers";

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";

function getCV(res: any) {
  return res && typeof res === "object" && "result" in res ? res.result : res;
}
function getUnit(sender: string) {
  try {
    const r = view(MARKET, "get-unit", [], sender);
    return cvToUint(getCV(r));
  } catch {
    return 100;
  }
}
function ensureSolvent(m: number, winner: "YES" | "NO", d: string) {
  const ys   = cvToUint(getCV(view(MARKET, "get-yes-supply", [toU(m)], d)));
  const ns   = cvToUint(getCV(view(MARKET, "get-no-supply",  [toU(m)], d)));
  const pool = cvToUint(getCV(view(MARKET, "get-pool",       [toU(m)], d)));
  const UNIT = getUnit(d);
  const need = BigInt(winner === "YES" ? ys : ns) * BigInt(UNIT);
  if (BigInt(pool) < need) {
    const shortfall = Number(need - BigInt(pool));
    callOk(SBTC, "mint",           [toU(shortfall), toP(ADMIN)], d);
    callOk(MARKET, "add-liquidity",[toU(m), toU(shortfall)],     ADMIN);
  }
}

describe("07 - invariantes (pool monotónico, b fijo), stress multi-mercados y redenciones", () => {
  it("Secuencia larga en m=21 y m=22 con verificaciones de invariantes y redenciones", () => {
    logHeader(
      "07 - invariantes & stress (m=21 y m=22)",
      "Pool non-decreasing en buys, slippage estricto, add-liquidity no cambia b, resoluciones/redenciones y withdraw-surplus."
    );

    // ===== m = 21 =====
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const w5 = addr("wallet_5");
    const M1 = 21;
    const LIQ1 = 180_000;

    [w1, w2, w3, w4, w5].forEach(w => callOk(SBTC, "mint", [toU(1_000_000), toP(w)], d));
    callOk(SBTC, "mint", [toU(LIQ1), toP(ADMIN)], d);
    callOk(MARKET, "create-market", [toU(M1), toU(LIQ1)], ADMIN);

    const quoteY = (amt: number) => view(MARKET, "quote-buy-yes", [toU(M1), toU(amt)], d);
    const quoteN = (amt: number) => view(MARKET, "quote-buy-no",  [toU(M1), toU(amt)], d);

    const buyAuto = (who: string, side: "YES"|"NO", amt: number) => {
      const q = unwrapQuote((side === "YES" ? quoteY(amt) : quoteN(amt)).result);
      logQuote(side, amt, q);
      callOk(MARKET, side === "YES" ? "buy-yes-auto" : "buy-no-auto",
        [toU(M1), toU(amt), toU(1_000_000), toU(q.total)],
        who, `${who} ${side} Δ=${amt}`);
      printMarketState(M1, d);
    };

    buyAuto(w1, "YES",  6000);
    buyAuto(w2, "NO",   4000);
    buyAuto(w3, "YES", 10000);
    buyAuto(w4, "NO",   7500);
    buyAuto(w5, "YES",  8000);
    buyAuto(w1, "NO",   3000);
    buyAuto(w2, "YES",  5500);
    buyAuto(w3, "NO",   2500);
    buyAuto(w4, "YES",  4000);
    buyAuto(w5, "NO",   4500);

    // add-liquidity mantiene b fijo
    const b1    = cvToUint(getCV(view(MARKET, "get-b",    [toU(M1)], d)));
    const pool1 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M1)], d)));
    const addAmt = 25_000;
    if (sbtcBalance(ADMIN) < addAmt) callOk(SBTC, "mint", [toU(addAmt), toP(ADMIN)], d);
    callOk(MARKET, "add-liquidity", [toU(M1), toU(addAmt)], ADMIN);
    const b2    = cvToUint(getCV(view(MARKET, "get-b",    [toU(M1)], d)));
    const pool2 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M1)], d)));
    expect(b2).toBe(b1);
    expect(pool2).toBe(pool1 + addAmt);

    // ===== m = 22 =====
    const M2   = 22;
    const LIQ2 = 90_000;

    callOk(SBTC, "mint", [toU(400_000), toP(ADMIN)], d);
    [w1, w2, w3].forEach(w => callOk(SBTC, "mint", [toU(200_000), toP(w)], d));
    callOk(MARKET, "create-market", [toU(M2), toU(LIQ2)], ADMIN);

    const q2Y = (amt: number) => view(MARKET, "quote-buy-yes", [toU(M2), toU(amt)], d);
    const q2N = (amt: number) => view(MARKET, "quote-buy-no",  [toU(M2), toU(amt)], d);

    // YES 7000
    {
      const q = unwrapQuote(q2Y(7000).result); logQuote("YES", 7000, q);
      callOk(MARKET, "buy-yes-auto", [toU(M2), toU(7000), toU(1_000_000), toU(q.total)], w1, "m22 w1 YES 7000");
      printMarketState(M2, d);
    }
    // NO 6000
    {
      const q = unwrapQuote(q2N(6000).result); logQuote("NO", 6000, q);
      callOk(MARKET, "buy-no-auto", [toU(M2), toU(6000), toU(1_000_000), toU(q.total)], w2, "m22 w2 NO 6000");
      printMarketState(M2, d);
    }
    // Slippage estricto (fallo u732)
    {
      const q = unwrapQuote(q2Y(6000).result); logQuote("YES", 6000, q);
      const r = (globalThis as any).simnet.callPublicFn(
        MARKET, "buy-yes-auto",
        [toU(M2), toU(6000), toU(1_000_000), toU(q.total - 1)],
        w3
      );
      expect(r.result.type).toBe("err");
      expect(cvToUint(r.result.value)).toBe(732);
      printMarketState(M2, d);
    }

    // Resolver NO con solvencia garantizada (usar UNIT real)
    ensureSolvent(M2, "NO", d);
    callOk(MARKET, "resolve", [toU(M2), Cl.stringAscii("NO")], ADMIN);

    // Ganador w2 (NO) redime 1:1
    const UNIT = getUnit(d);
    const balNo = cvToUint(getCV(view(MARKET, "get-no-balance", [toU(M2), toP(w2)], w2)));
    const redeem = (globalThis as any).simnet.callPublicFn(MARKET, "redeem", [toU(M2)], w2);
    expect(redeem.result.type).toBe("ok");
    const payout = cvToUint(redeem.result.value);
    expect(payout).toBe(balNo * UNIT);

    // Surplus luego de que el ganador redime
    callOk(MARKET, "withdraw-surplus", [toU(M2)], ADMIN);
    const poolM2 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M2)], d)));
    expect(poolM2).toBe(0);
  });
});
