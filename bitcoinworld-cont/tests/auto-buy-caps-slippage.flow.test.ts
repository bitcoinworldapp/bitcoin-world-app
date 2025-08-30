import { describe, it, expect } from "vitest";
import { simnet, addr, Cl, cvToUint, unwrapQuote } from "./helpers";

describe("Auto-buy: slippage (u732) + caps por usuario (u731) + spent", () => {
  it("falla por slippage, luego por cap insuficiente; ajusta y compra; spent se actualiza", () => {
    const d = addr("deployer"), w1 = addr("wallet_1");
    const ok = (r:any)=>{ if(r.result?.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // Fondos
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(300_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(w1)], d));

    // Mercado + fees + split
    ok(simnet.callPublicFn("market","create",[Cl.uint(20_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // Quote amt=100
    const q = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(100)], w1));
    expect(q.total).toBeGreaterThan(0);

    // 1) Slippage: max-cost < total => u732
    const s1 = simnet.callPublicFn(
      "market", "buy-yes-auto",
      [Cl.uint(100), Cl.uint(q.total * 10), Cl.uint(q.total - 1)],
      w1
    );
    expect(s1.result).toEqual({ type:"err", value:{ type:"uint", value: 732n } });

    // 2) Cap insuficiente: target-cap < total => u731
    const s2 = simnet.callPublicFn(
      "market", "buy-yes-auto",
      [Cl.uint(100), Cl.uint(q.total - 1), Cl.uint(q.total + 1)],
      w1
    );
    expect(s2.result).toEqual({ type:"err", value:{ type:"uint", value: 731n } });

    // 3) Ajusta: cap >= total y max-cost >= total => OK
    const s3 = simnet.callPublicFn(
      "market", "buy-yes-auto",
      [Cl.uint(100), Cl.uint(q.total * 2), Cl.uint(q.total + 1)],
      w1
    );
    expect(s3.result.type).toBe("ok");

    // spent == total de la compra
    const spent = cvToUint(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(w1)], w1).result);
    expect(spent).toBe(q.total);

    // pool subió solo por base
    const pool = cvToUint(simnet.callReadOnlyFn("market","get-pool",[], w1).result);
    // pool inicial era 20_000
    expect(pool).toBe(20_000 + q.cost);

    console.log("[OK] auto-buy: u732, u731, luego OK; spent y pool correctos");
  });
});
