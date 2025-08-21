import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("Winners split + last-claimer sweep (auto-buy)", () => {
  it("w1 30%, w2 70% YES; suma payouts == pool previo; pool termina 0", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(50_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));

    // compras YES: 300 vs 700
    const cap=1_000_000, max=1_000_000;
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(300), Cl.uint(cap), Cl.uint(max)], w1));
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(700), Cl.uint(cap), Cl.uint(max)], w2));

    const poolBefore = U(simnet.callReadOnlyFn("market","get-pool",[], d));
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    const p1 = U(ok(simnet.callPublicFn("market","redeem",[], w1)));
    const p2 = U(ok(simnet.callPublicFn("market","redeem",[], w2)));
    const poolAfter = U(simnet.callReadOnlyFn("market","get-pool",[], d));

    expect(p1 + p2).toBe(poolBefore);
    expect(poolAfter).toBe(0);
  });
});
