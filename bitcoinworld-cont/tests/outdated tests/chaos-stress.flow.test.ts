import { describe, it, expect } from "vitest";
import { simnet, addr, Cl, cvToUint, unwrapQuote } from "../helpers";

describe("Caos controlado: caps (auto vs normal), slippage, pause/unpause, max-trade, locks, resolve/redeem con last-sweep y withdraw gating", () => {
  it("flujo largo con errores esperados y validaciones de estado (u2 antes del last-sweep, u105 después)", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w8 = addr("wallet_8");

    const DRIP = addr("wallet_4");
    const BRC  = addr("wallet_5");
    const TEAM = addr("wallet_6");
    const LP   = addr("wallet_7");

    const ok = (r:any)=>{ if(r.result?.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const pool = ()=> cvToUint(simnet.callReadOnlyFn("market","get-pool",[], d).result);
    const ys   = ()=> cvToUint(simnet.callReadOnlyFn("market","get-yes-supply",[], d).result);

    // ----- Fondos -----
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(500_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(500_000), Cl.principal(w2)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(500_000), Cl.principal(w3)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(500_000), Cl.principal(w8)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(200_000), Cl.principal(d)],  d));

    // ----- Mercado -----
    ok(simnet.callPublicFn("market","create",[Cl.uint(30_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(400), Cl.uint(200)], d));                 // 4% protocolo, 2% LP
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(60), Cl.uint(25), Cl.uint(15)], d)); // 60/25/15
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(DRIP), Cl.principal(BRC), Cl.principal(TEAM), Cl.principal(LP)], d));
    ok(simnet.callPublicFn("market","lock-fees-config",[], d));

    // Cambios tras lock => u743
    const locked1 = simnet.callPublicFn("market","set-fees",[Cl.uint(100), Cl.uint(100)], d);
    expect(locked1.result).toEqual({ type:"err", value:{ type:"uint", value: 743n } });

    // Redeem antes de resolve => u104
    const earlyRedeem = simnet.callPublicFn("market","redeem",[], w1);
    expect(earlyRedeem.result).toEqual({ type:"err", value:{ type:"uint", value: 104n } });

    // ----- Caps: compra normal sin cap => u730 -----
    const normalNoCap = simnet.callPublicFn("market","buy-yes",[Cl.uint(50)], w1);
    expect(normalNoCap.result).toEqual({ type:"err", value:{ type:"uint", value: 730n } });

    // Auto abre cap
    const qA = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(60)], w1));
    const targetCap1 = Math.ceil(qA.total * 1.2);
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(60), Cl.uint(targetCap1), Cl.uint(Math.ceil(qA.total*2))], w1));

    // Excede cap acumulado => u731
    const normalExceeds = simnet.callPublicFn("market","buy-yes",[Cl.uint(100)], w1);
    expect(normalExceeds.result).toEqual({ type:"err", value:{ type:"uint", value: 731n } });

    // Sube cap y entra
    const qA2 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(40)], w1));
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(40), Cl.uint(Math.ceil(targetCap1 + qA2.total*3)), Cl.uint(Math.ceil(qA2.total*2))], w1));
    ok(simnet.callPublicFn("market","buy-yes",[Cl.uint(30)], w1));

    // Pause/unpause y guard
    ok(simnet.callPublicFn("market","pause",[], d));
    const pausedBuy = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(20), Cl.uint(9999999), Cl.uint(9999999)], w2);
    expect(pausedBuy.result).toEqual({ type:"err", value:{ type:"uint", value: 720n } });
    ok(simnet.callPublicFn("market","unpause",[], d));

    // max-trade
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(60)], d));
    const tooBig = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(61), Cl.uint(9999999), Cl.uint(9999999)], w2);
    expect(tooBig.result).toEqual({ type:"err", value:{ type:"uint", value: 722n } });
    const qN1 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(60)], w2));
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(60), Cl.uint(Math.ceil(qN1.total*5)), Cl.uint(Math.ceil(qN1.total*2))], w2));
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(0)], d));

    // Slippage
    const qN2 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(120)], w3));
    const slipFail = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(120), Cl.uint(Math.ceil(qN2.total*5)), Cl.uint(qN2.total - 1)], w3);
    expect(slipFail.result).toEqual({ type:"err", value:{ type:"uint", value: 732n } });
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(120), Cl.uint(Math.ceil(qN2.total*5)), Cl.uint(qN2.total + 10)], w3));

    // Más YES/NO
    const qYx = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(80)], w2));
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(80), Cl.uint(Math.ceil(qYx.total*3)), Cl.uint(Math.ceil(qYx.total*2))], w2));
    const qNx = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(150)], w8));
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(150), Cl.uint(Math.ceil(qNx.total*3)), Cl.uint(Math.ceil(qNx.total*2))], w8));

    // Resolve YES
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));
    const doubleResolve = simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d);
    expect(doubleResolve.result).toEqual({ type:"err", value:{ type:"uint", value: 102n } });

    // Withdraw prematuro (YES-supply > 0) -> u708
    const earlyWithdraw = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(earlyWithdraw.result).toEqual({ type:"err", value:{ type:"uint", value: 708n } });

    // Perdedor intenta antes del last-sweep: YES-supply > 0, balance=0 => payout=0 -> u2
    expect(ys()).toBeGreaterThan(0);
    const loserEarly = simnet.callPublicFn("market","redeem",[], w3);
    expect(loserEarly.result).toEqual({ type:"err", value:{ type:"uint", value: 2n } });

    // Ganadores YES
    const prePool = pool();
    const rW1 = simnet.callPublicFn("market","redeem",[], w1);
    expect(rW1.result.type).toBe("ok");
    const midPool = pool();
    expect(midPool).toBeLessThan(prePool);

    // Último ganador barre el pool
    const poolBeforeLast = pool();
    const rW2 = simnet.callPublicFn("market","redeem",[], w2);
    expect(rW2.result.type).toBe("ok");
    const payoutLast = cvToUint(rW2.result);
    expect(payoutLast).toBe(poolBeforeLast);

    // Ahora YES-supply==0: perdedores devuelven u105
    expect(ys()).toBe(0);
    const rW3 = simnet.callPublicFn("market","redeem",[], w3);
    expect(rW3.result).toEqual({ type:"err", value:{ type:"uint", value: 105n } });
    const rW8 = simnet.callPublicFn("market","redeem",[], w8);
    expect(rW8.result).toEqual({ type:"err", value:{ type:"uint", value: 105n } });

    // pool=0 => withdraw-surplus u710
    const lateWithdraw = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(lateWithdraw.result).toEqual({ type:"err", value:{ type:"uint", value: 710n } });

    console.log("[OK] caos-stress ajustado: u2 antes del last-sweep y u105 después; guards verificados");
  });
});
