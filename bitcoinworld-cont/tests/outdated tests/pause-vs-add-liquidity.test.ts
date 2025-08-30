// tests/pause-vs-add-liquidity.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

const U = (r:any)=>cvToUint(r.result);

describe("pause bloquea buys, add-liquidity funciona en pausa y sube b; luego unpause permite comprar", () => {
  it("valida guards y dinámica de b en pausa", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");

    const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const b = () => U(simnet.callReadOnlyFn("market","get-b",[], d));
    const pool = ()=> U(simnet.callReadOnlyFn("market","get-pool",[], d));

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(w1)], w1));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));

    const b0 = b(); const p0 = pool();
    ok(simnet.callPublicFn("market","pause",[], d));

    // buy bloqueado
    const buyErr = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(3), Cl.uint(9_999_999), Cl.uint(9_999_999)], w1);
    expect(buyErr.result.type).toBe("err");
    console.log("[OK] buy bloqueado en pausa:", buyErr.result);

    // add-liquidity permitido en pausa
    ok(simnet.callPublicFn("market","add-liquidity",[Cl.uint(20_000)], d));
    const b1 = b(); const p1 = pool();
    console.log("[OK] add-liquidity en pausa — Δpool:", Number(p1-p0), "b0:", Number(b0), "b1:", Number(b1));
    expect(Number(p1 - p0)).toBe(20_000);
    expect(Number(b1)).toBeGreaterThan(Number(b0));

    ok(simnet.callPublicFn("market","unpause",[], d));
    const big = 1_000_000_000;
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(5), Cl.uint(big), Cl.uint(big)], w1));
    console.log("[OK] buy permitido tras unpause — pool:", Number(pool()), "b:", Number(b()));
  });
});
