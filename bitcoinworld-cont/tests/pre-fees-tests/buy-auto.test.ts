// tests/buy-auto.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("buy-yes-auto / buy-no-auto", () => {
  it("sube cap en la misma tx y respeta max-cost", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");

    const ok = (r:any) => {
      if (r.result.type !== "ok") throw new Error(JSON.stringify(r.result));
      return r;
    };
    const U = (r:any) => cvToUint(r.result);

    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const qY   = () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));
    const qN   = () => U(simnet.callReadOnlyFn("market","get-no-supply",[],  d));

    // Seed y crear mercado
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(1_000)], d));
    const pool0 = pool();

    // auto-buy YES: sube cap y compra en una sola tx
    const targetCap = 1_000;
    const maxCost   = 1_000;
    ok(simnet.callPublicFn("market","buy-yes-auto",[
      Cl.uint(50),           // amount
      Cl.uint(targetCap),    // target-cap
      Cl.uint(maxCost)       // max-cost (slippage bound)
    ], w1));

    expect(qY()).toBe(50);
    expect(qN()).toBe(0);
    expect(pool()).toBeGreaterThan(pool0);

    // slippage: para forzar error de forma determinista,
    // ponemos max-cost = 0 (el contrato exige > 0) => ERR-SLIPPAGE (u732)
    const tooTight = simnet.callPublicFn("market","buy-yes-auto",[
      Cl.uint(10),
      Cl.uint(targetCap),
      Cl.uint(0)             // fuerza err u732
    ], w1);
    expect(tooTight.result.type).toBe("err");
  });
});
