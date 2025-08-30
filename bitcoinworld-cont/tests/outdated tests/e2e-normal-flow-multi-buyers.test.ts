import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl, unwrapQuote } from "../helpers";

/**
 * Flujo normal:
 * - Admin crea mercado y setea fees/splits/recipients
 * - 3 usuarios compran (YES/NO) con auto-buy (cap inline + slippage guard)
 * - Comprobamos deltas de pool y fees según los quotes
 * - Admin resuelve YES
 * - Buys quedan bloqueados
 * - Ganadores (dos YES) redimen: el último barre el remanente
 * - pool termina en 0 y withdraw-surplus falla con u710
 */
describe("E2E — flujo normal con varios compradores", () => {
  it("multi-compras, resolve YES, redeem pro-rata (last sweep), buys bloqueados y withdraw=0 denegado", () => {
    const d   = addr("deployer");
    const y1  = addr("wallet_1"); // YES
    const n1  = addr("wallet_2"); // NO
    const y2  = addr("wallet_3"); // YES

    // recipients de protocolo + LP
    const drp = addr("wallet_4");
    const brc = addr("wallet_5");
    const tm  = addr("wallet_6");
    const lp  = addr("wallet_7");

    const U = (r:any)=> cvToUint(r.result);
    const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // --- Seed balances ---
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(y1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(n1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(y2)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000),  Cl.principal(d)],  d));

    // --- Create + fees config ---
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d)); // 3% protocolo, 1% LP
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d)); // 50/30/20
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));

    // helpers de lectura
    const bal = (p:string)=> U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));
    const pool = ()=> U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const qY   = ()=> U(simnet.callReadOnlyFn("market","get-q-yes",[], d));
    const qN   = ()=> U(simnet.callReadOnlyFn("market","get-q-no",[], d));
    const ySupply = ()=> U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));

    // --- Buy 1 (y1 compra YES) ---
    const q1 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(600)], y1));
    const pre1 = { y1:bal(y1), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qY:qY() };
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(600), Cl.uint(q1.total*2), Cl.uint(q1.total*2)], y1));
    const post1 = { y1:bal(y1), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qY:qY() };

    expect(post1.P - pre1.P).toBe(q1.cost);         // pool ↑ base
    expect(pre1.y1 - post1.y1).toBe(q1.total);      // wallet paga total
    expect(post1.drp - pre1.drp).toBe(q1.drip);     // fees → recipients
    expect(post1.brc - pre1.brc).toBe(q1.brc20);
    expect(post1.tm  - pre1.tm ).toBe(q1.team);
    expect(post1.lp  - pre1.lp ).toBe(q1.feeLP);
    expect(post1.qY  - pre1.qY ).toBe(600);

    // --- Buy 2 (n1 compra NO) ---
    const q2 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(500)], n1));
    const pre2 = { n1:bal(n1), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qN:qN() };
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(500), Cl.uint(q2.total*2), Cl.uint(q2.total*2)], n1));
    const post2 = { n1:bal(n1), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qN:qN() };

    expect(post2.P - pre2.P).toBe(q2.cost);
    expect(pre2.n1 - post2.n1).toBe(q2.total);
    expect(post2.drp - pre2.drp).toBe(q2.drip);
    expect(post2.brc - pre2.brc).toBe(q2.brc20);
    expect(post2.tm  - pre2.tm ).toBe(q2.team);
    expect(post2.lp  - pre2.lp ).toBe(q2.feeLP);
    expect(post2.qN  - pre2.qN ).toBe(500);

    // --- Buy 3 (y2 compra YES) ---
    const q3 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(400)], y2));
    const pre3 = { y2:bal(y2), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qY:qY() };
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(400), Cl.uint(q3.total*2), Cl.uint(q3.total*2)], y2));
    const post3 = { y2:bal(y2), drp:bal(drp), brc:bal(brc), tm:bal(tm), lp:bal(lp), P:pool(), qY:qY() };

    expect(post3.P - pre3.P).toBe(q3.cost);
    expect(pre3.y2 - post3.y2).toBe(q3.total);
    expect(post3.drp - pre3.drp).toBe(q3.drip);
    expect(post3.brc - pre3.brc).toBe(q3.brc20);
    expect(post3.tm  - pre3.tm ).toBe(q3.team);
    expect(post3.lp  - pre3.lp ).toBe(q3.feeLP);
    expect(post3.qY  - pre3.qY ).toBe(400);

    // --- Resolve YES ---
    const P_before = pool();
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // Buy tras resolver debe fallar con u100
    const blocked = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(10), Cl.uint(999_999_999), Cl.uint(999_999_999)], y1);
    expect(blocked.result).toEqual({ type:"err", value:{ type:"uint", value: 100n } });

    // --- Redeem ganadores (y1 y y2) ---
    const r1 = simnet.callPublicFn("market","redeem",[], y1);
    expect(r1.result.type).toBe("ok");
    const pay1 = cvToUint(r1.result);      // payout del primero
    const P_mid = pool();

    const r2 = simnet.callPublicFn("market","redeem",[], y2);
    expect(r2.result.type).toBe("ok");
    const pay2 = cvToUint(r2.result);      // payout del último (sweep)
    const P_after = pool();

    // Comprobaciones de redención:
    // 1) El último barre todo lo que queda
    expect(pay2).toBe(P_mid);
    // 2) La suma de payouts == pool antes de redimir
    expect(pay1 + pay2).toBe(P_before);
    // 3) pool termina en 0 y supply YES en 0
    expect(P_after).toBe(0);
    expect(ySupply()).toBe(0);

    // withdraw-surplus con pool=0 -> u710
    const ws = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(ws.result).toEqual({ type:"err", value:{ type:"uint", value: 710n } });
  });
});
