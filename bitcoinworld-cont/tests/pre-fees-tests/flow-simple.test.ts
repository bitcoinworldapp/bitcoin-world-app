import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("Flujo simple con auto-buy", () => {
  it("create -> buys(auto) -> resolve YES -> redeem -> (withdraw si aplica)", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(`Tx failed: ${JSON.stringify(r.result)}`); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const qY   = () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));
    const qN   = () => U(simnet.callReadOnlyFn("market","get-no-supply",[],  d));

    // seed + market
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint( 2_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint( 2_000), Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(1_000)], d));

    // auto-buys
    const cap = 5_000, maxCost = 5_000;
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(100), Cl.uint(cap), Cl.uint(maxCost)], w1));
    ok(simnet.callPublicFn("market","buy-no-auto", [Cl.uint( 60), Cl.uint(cap), Cl.uint(maxCost)], w2));

    expect(qY()).toBe(100);
    expect(qN()).toBe(60);
    const pBefore = pool();
    expect(pBefore).toBeGreaterThan(1000);

    // resolve YES
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // winners redeem
    const p1 = U(ok(simnet.callPublicFn("market","redeem",[], w1)));
    expect(p1).toBeGreaterThan(0);

    // si queda pool y no hay YES supply, withdraw-surplus barre
    if (qY() === 0 && pool() > 0) {
      ok(simnet.callPublicFn("market","withdraw-surplus",[], d));
      expect(pool()).toBe(0);
    }
  });
});
