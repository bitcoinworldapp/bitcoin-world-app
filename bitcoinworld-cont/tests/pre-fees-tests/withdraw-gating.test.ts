import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("Withdraw-surplus gating", () => {
  it("falla mientras quede supply ganadora, luego permite y pool=0", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1"); // YES
    const w2 = addr("wallet_2"); // NO
    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const getPool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w2)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(500)], d));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w1));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w2));

    ok(simnet.callPublicFn("market","buy-yes",[Cl.uint(100)], w1));
    ok(simnet.callPublicFn("market","buy-no",[Cl.uint(40)],  w2));

    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // mientras quede yes-supply, withdraw-surplus debe fallar u708
    const early = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(early.result.type).toBe("err");

    // redime w1 (único YES holder)
    ok(simnet.callPublicFn("market","redeem",[], w1));
    expect(getPool()).toBe(0);

    // ahora withdraw-surplus debe err (pool=0 -> u710)
    const late = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(late.result.type).toBe("err");
  });
});
