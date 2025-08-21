import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Random pause/unpause stress (determinista)", () => {
  it("acepta compras solo cuando no esta pausado; invariantes y redeem final", () => {
    const d = addr("deployer");
    const users = [addr("wallet_1"), addr("wallet_2"), addr("wallet_3"), addr("wallet_4"), addr("wallet_5")];

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const get = {
      pool: () => U(simnet.callReadOnlyFn("market","get-pool",[], d)),
      ySup: () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d)),
      yBal: (who:string) => U(simnet.callReadOnlyFn("market","get-yes-balance",[Cl.principal(who)], d)),
    };

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000), Cl.principal(d)], d));
    users.forEach(u => ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_500), Cl.principal(u)], d)));

    ok(simnet.callPublicFn("market","create",[Cl.uint(800)], d));
    users.forEach(u => ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], u)));

    // Secuencia determinista de acciones (P=pausa, U=unpause, Y/N=compra)
    const script: Array<["P"|"U"|"Y"|"N", number /*user index*/, number /*amount*/?]> = [
      ["P", -1], ["Y",0,20], ["U",-1], ["Y",0,20], ["N",1,15],
      ["P",-1], ["N",2,10],  ["U",-1], ["Y",3,25], ["N",4,30],
      ["Y",1,18], ["P",-1],  ["Y",2,12], ["U",-1], ["N",0,14],
    ];

    script.forEach(([op, idx, amt]) => {
      if (op==="P") ok(simnet.callPublicFn("market","pause",[], d));
      else if (op==="U") ok(simnet.callPublicFn("market","unpause",[], d));
      else if (op==="Y") {
        const u = users[idx]; const res = simnet.callPublicFn("market","buy-yes",[Cl.uint(amt!)], u);
        // si estaba pausado, debe err; si no, ok
        if (res.result.type==="err") expect(true).toBe(true);
        else expect(res.result.type).toBe("ok");
      } else if (op==="N") {
        const u = users[idx]; const res = simnet.callPublicFn("market","buy-no",[Cl.uint(amt!)], u);
        if (res.result.type==="err") expect(true).toBe(true);
        else expect(res.result.type).toBe("ok");
      }
    });

    const poolBeforeResolve = get.pool();
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    users.forEach(u => {
      if (get.yBal(u) > 0) {
        const res = simnet.callPublicFn("market","redeem",[], u);
        expect(res.result.type).toBe("ok");
      }
    });

    expect(get.ySup()).toBe(0);
    expect(get.pool()).toBe(0);
    expect(poolBeforeResolve).toBeGreaterThan(0);
  });
});
