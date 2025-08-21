import { describe, it, expect } from "vitest";
import { simnet, addr, Cl } from "../helpers";

describe("Post-resolve guards (no se puede comprar tras resolver)", () => {
  it("bloquea buy-yes/no con status resolved; resolve solo admin", () => {
    const d  = addr("deployer"); // admin
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w2)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(500)], d));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w1));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w2));

    ok(simnet.callPublicFn("market","buy-yes",[Cl.uint(20)], w1));
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    const b1 = simnet.callPublicFn("market","buy-yes",[Cl.uint(5)], w1);
    const b2 = simnet.callPublicFn("market","buy-no",[Cl.uint(5)],  w2);
    expect(b1.result.type).toBe("err");
    expect(b2.result.type).toBe("err");

    const nonAdminResolve = simnet.callPublicFn("market","resolve",[Cl.stringAscii("NO")], w1);
    expect(nonAdminResolve.result.type).toBe("err");
  });
});
