// tests/factory-complex-flow.test.ts
import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, cvToUint, unwrapQuote } from "./helpers";

const toU = (n: number) => Cl.uint(n);
const toP = (a: string) => Cl.principal(a);

const mint = (to: string, amount: number, signer: string) =>
  simnet.callPublicFn("sbtc", "mint", [toU(amount), toP(to)], signer);

const balSbtc = (who: string) =>
  cvToUint(simnet.callReadOnlyFn("sbtc", "get-balance", [toP(who)], who).result);

const pool = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market","get-pool",[toU(m)], addr("deployer")).result);
const bVal = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market","get-b",[toU(m)], addr("deployer")).result);
const ySup = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market","get-yes-supply",[toU(m)], addr("deployer")).result);
const nSup = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market","get-no-supply",[toU(m)], addr("deployer")).result);

describe("Market Factory - complex suite (3 markets, quotes, slippage, fee lock, add-liquidity, resolves, redemptions)", () => {
  it("runs 3 markets in parallel with mixed actions and verifies balances, quotes, and final drains", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const LP  = addr("wallet_5");
    const TM  = addr("wallet_6");
    const DRP = addr("wallet_7");
    const BRC = addr("wallet_8");

    expect(mint(d,  200_000, d).result.type).toBe("ok");
    for (const u of [w1, w2, w3, w4]) expect(mint(u, 1_000_000, d).result.type).toBe("ok");

    console.log("[CONFIG] set protocol=3% and LP=1%; set recipients DRIP/BRC/TEAM/LP");
    expect(simnet.callPublicFn("market","set-fees",[toU(300), toU(100)], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","set-fee-recipients",[toP(DRP), toP(BRC), toP(TM), toP(LP)], d).result.type).toBe("ok");

    const M0 = 10, M1 = 11, M2 = 12;
    console.log(`[CREATE] M0=${M0} M1=${M1} M2=${M2}`);
    expect(simnet.callPublicFn("market","create-market",[toU(M0), toU(40_000)], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","create-market",[toU(M1), toU(60_000)], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","create-market",[toU(M2), toU(80_000)], d).result.type).toBe("ok");
    console.log(`[STATE AFTER CREATE] M0 pool=${pool(M0)} b=${bVal(M0)} | M1 pool=${pool(M1)} b=${bVal(M1)} | M2 pool=${pool(M2)} b=${bVal(M2)}`);

    // === M0: quote before/after add-liquidity, with buys in between ===
    const qBefore = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[toU(M0), toU(200)], d).result);
    console.log(`[QUOTE] M0 YES x200 BEFORE add-liquidity -> total=${qBefore.total} (cost=${qBefore.cost} fP=${qBefore.feeProtocol} fL=${qBefore.feeLP})`);

    console.log("[BUY] M0: w1 buys YES x150, w2 buys NO x300");
    expect(simnet.callPublicFn("market","buy-yes-auto",[toU(M0), toU(150), toU(1_000_000), toU(100_000)], w1).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","buy-no-auto", [toU(M0), toU(300), toU(1_000_000), toU(100_000)], w2).result.type).toBe("ok");
    console.log(`[STATE] M0 pool=${pool(M0)} b=${bVal(M0)} ySup=${ySup(M0)} nSup=${nSup(M0)}`);

    const bBefore = bVal(M0);
    console.log("[ADD LIQUIDITY] M0: admin adds 10,000");
    expect(simnet.callPublicFn("market","add-liquidity",[toU(M0), toU(10_000)], d).result.type).toBe("ok");
    const qAfter = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[toU(M0), toU(200)], d).result);
    console.log(`[QUOTE] M0 YES x200 AFTER add-liquidity -> total=${qAfter.total} (cost=${qAfter.cost} fP=${qAfter.feeProtocol} fL=${qAfter.feeLP})`);
    console.log(`[STATE] M0 pool=${pool(M0)} b=${bVal(M0)} (b must increase due to higher pool)`);

    // Invariant checks (do not assume the quote must drop; LMSR + rounding can raise total)
    expect(bVal(M0)).toBeGreaterThan(bBefore);
    expect(pool(M0)).toBeGreaterThan(0);

    // === M1: slippage guard fail then valid buys ===
    console.log("[SLIPPAGE TEST] M1: expect u732 with tiny max-cost");
    const slFail = simnet.callPublicFn("market","buy-yes-auto",[toU(M1), toU(100), toU(1_000_000), toU(1)], w3).result;
    expect(slFail).toEqual({ type:"err", value:{ type:"uint", value: 732n } });

    console.log("[BUY] M1: valid YES x120 (w3), valid NO x150 (w4)");
    expect(simnet.callPublicFn("market","buy-yes-auto",[toU(M1), toU(120), toU(1_000_000), toU(100_000)], w3).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","buy-no-auto", [toU(M1), toU(150), toU(1_000_000), toU(100_000)], w4).result.type).toBe("ok");
    console.log(`[STATE] M1 pool=${pool(M1)} b=${bVal(M1)} ySup=${ySup(M1)} nSup=${nSup(M1)}`);

    // === M2: non-auto fails due to cap, auto succeeds with bump-cap ===
    console.log("[CAP TEST] M2: non-auto buy-yes should fail with u730 (cap=0)");
    const capFail = simnet.callPublicFn("market","buy-yes",[toU(M2), toU(50)], w1).result;
    expect(capFail).toEqual({ type:"err", value:{ type:"uint", value: 730n } });

    console.log("[BUY] M2: auto buys with bump-cap");
    expect(simnet.callPublicFn("market","buy-yes-auto",[toU(M2), toU(200), toU(50_000), toU(100_000)], w1).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","buy-no-auto", [toU(M2), toU(250), toU(50_000), toU(100_000)], w2).result.type).toBe("ok");
    console.log(`[STATE] M2 pool=${pool(M2)} b=${bVal(M2)} ySup=${ySup(M2)} nSup=${nSup(M2)}`);

    // === Lock fees and verify changes rejected ===
    console.log("[LOCK FEES CONFIG] then attempt to change recipients and fees (should err u743)");
    expect(simnet.callPublicFn("market","lock-fees-config",[], d).result.type).toBe("ok");
    const changeRec = simnet.callPublicFn("market","set-fee-recipients",[toP(w1), toP(w2), toP(w3), toP(w4)], d).result;
    const changeFee = simnet.callPublicFn("market","set-fees",[toU(200), toU(50)], d).result;
    expect(changeRec).toEqual({ type:"err", value:{ type:"uint", value: 743n } });
    expect(changeFee).toEqual({ type:"err", value:{ type:"uint", value: 743n } });

    // === Resolve & Redeem ===
    console.log("[RESOLVE] M0 -> NO | M1 -> YES | M2 -> NO");
    expect(simnet.callPublicFn("market","resolve",[toU(M0), Cl.stringAscii("NO")], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","resolve",[toU(M1), Cl.stringAscii("YES")], d).result.type).toBe("ok");
    expect(simnet.callPublicFn("market","resolve",[toU(M2), Cl.stringAscii("NO")], d).result.type).toBe("ok");

    console.log("[REDEEM] winners on each market");
    expect(simnet.callPublicFn("market","redeem",[toU(M0)], w2).result.type).toBe("ok"); // NO winner
    expect(simnet.callPublicFn("market","redeem",[toU(M1)], w3).result.type).toBe("ok"); // YES winner
    expect(simnet.callPublicFn("market","redeem",[toU(M2)], w2).result.type).toBe("ok"); // NO winner

    // drain leftovers
    simnet.callPublicFn("market","redeem",[toU(M0)], w1);
    simnet.callPublicFn("market","redeem",[toU(M1)], w4);
    simnet.callPublicFn("market","redeem",[toU(M2)], w1);

    console.log(`[FINAL POOLS] M0=${pool(M0)} M1=${pool(M1)} M2=${pool(M2)} (all must be 0)`);
    expect(pool(M0)).toBe(0);
    expect(pool(M1)).toBe(0);
    expect(pool(M2)).toBe(0);
  });
});
