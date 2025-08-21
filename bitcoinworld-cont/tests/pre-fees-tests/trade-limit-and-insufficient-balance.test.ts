import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Max trade + insufficient funds + resolve NO (auto-buy)", () => {
  it("bloquea por limite, falla por fondos y paga a ganadores NO", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1"); // pobre
    const w2 = addr("wallet_2"); // ganador NO
    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(   200), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint( 5_000), Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(1_000)], d));
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(100)], d));

    const cap = 1_000_000, max = 1_000_000;

    // 1) excede max-trade
    const tooBig = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(101), Cl.uint(cap), Cl.uint(max)], w2);
    expect(tooBig.result.type).toBe("err"); // u722

    // 2) fondos insuficientes del comprador (w1 sólo tiene 200 sBTC)
    const poor = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(500), Cl.uint(cap), Cl.uint(max)], w1);
    expect(poor.result.type).toBe("err");

    // 3) Camino NO: compra NO y gana
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(80), Cl.uint(cap), Cl.uint(max)], w2));
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("NO")], d));
    const pay = U(ok(simnet.callPublicFn("market","redeem",[], w2)));
    expect(pay).toBeGreaterThan(0);
  });
});
