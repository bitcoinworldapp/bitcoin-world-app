import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

function qTotal(res: any): number {
  const r = res?.result ?? res;
  const v = r?.value?.data ?? r?.value ?? r?.data ?? r;
  const tot = v?.total?.value ?? v?.total;
  if (tot === undefined) throw new Error("Bad quote shape: " + JSON.stringify(r));
  return Number(tot);
}

describe("Auto-cap + spent: bump de cap, suma de spent y no-mutas en fallo", () => {
  it("auto sube el cap y suma spent; fallo por slippage no cambia spent ni pool", () => {
    const d = addr("deployer"), w1 = addr("wallet_1");
    const U  = (r:any)=> cvToUint(r.result);
    const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    const cap0   = U(simnet.callReadOnlyFn("market","get-cap",[Cl.principal(w1)], w1));
    const spent0 = U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(w1)], w1));
    const pool0  = U(simnet.callReadOnlyFn("market","get-pool",[], d));

    const q = simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(1234)], w1);
    const T = qTotal(q);

    // auto-buy: cap -> T*2; spent += T
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1234), Cl.uint(T*2), Cl.uint(T*2)], w1));

    const cap1   = U(simnet.callReadOnlyFn("market","get-cap",[Cl.principal(w1)], w1));
    const spent1 = U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(w1)], w1));
    const pool1  = U(simnet.callReadOnlyFn("market","get-pool",[], d));

    expect(cap1).toBeGreaterThanOrEqual(T);
    expect(spent1 - spent0).toBe(T);
    expect(pool1).toBeGreaterThan(pool0);

    // Forzamos slippage: otro usuario mueve precio; luego intentamos con max-cost insuficiente
    const w2 = addr("wallet_2");
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(2000), Cl.uint(9_999_999), Cl.uint(9_999_999)], w2));

    const q2 = simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(1500)], w1);
    const T2 = qTotal(q2);

    // Intento con max-cost < total -> u732; spent/pool no cambian
    const fail = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1500), Cl.uint(T2), Cl.uint(T2 - 1)], w1);
    expect(fail.result).toEqual({ type:"err", value:{ type:"uint", value: 732n } });

    const spent2 = U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(w1)], w1));
    const pool2  = U(simnet.callReadOnlyFn("market","get-pool",[], d));
    expect(spent2).toBe(spent1);
    expect(pool2).toBe(pool1);

    console.log("[OK] auto-cap + spent invariants — bump de cap, suma de spent, fallo por u732 sin mutaciones.");
  });
});
