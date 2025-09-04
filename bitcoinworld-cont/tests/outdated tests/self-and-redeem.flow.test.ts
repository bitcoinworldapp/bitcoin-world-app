import { describe, it, expect } from "vitest";
import { simnet, addr, Cl, cvToUint, unwrapQuote } from "../helpers";

describe("Init + buy + resolve YES + redeem drena el pool", () => {
  it("ingresos al contrato aumentan pool (solo base) y redeem lo deja en 0", () => {
    const d = addr("deployer"), w1 = addr("wallet_1");
    const ok = (r:any)=>{ if(r.result?.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // Fondos
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(200_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(w1)], d));

    // Mercado + fees + split
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // Pool inicial
    const pool0 = cvToUint(simnet.callReadOnlyFn("market","get-pool",[], w1).result);
    expect(pool0).toBe(10_000);

    // Quote amt=100
    const q = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(100)], w1));

    // Auto-buy (cap inline, max-cost holgado)
    const buy = simnet.callPublicFn(
      "market","buy-yes-auto",
      [Cl.uint(100), Cl.uint(q.total * 10), Cl.uint(q.total * 10)],
      w1
    );
    expect(buy.result.type).toBe("ok");

    // El pool solo sube por el coste base (fees se envían fuera)
    const poolAfterBuy = cvToUint(simnet.callReadOnlyFn("market","get-pool",[], w1).result);
    expect(poolAfterBuy).toBe(pool0 + q.cost);

    // Resolver YES
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // Redeem: único YES holder drena pool
    const rdm = simnet.callPublicFn("market","redeem",[], w1);
    expect(rdm.result.type).toBe("ok");

    const poolAfterRedeem = cvToUint(simnet.callReadOnlyFn("market","get-pool",[], w1).result);
    expect(poolAfterRedeem).toBe(0);

    console.log("[OK] flujo YES->redeem: pool sube por base y termina en 0");
  });
});
