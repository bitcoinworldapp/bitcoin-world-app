// tests/multi-users-stress.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Stress: muchos usuarios, muchas compras, resolve + redeem", () => {
  it("invariantes y pool=0 tras todos los redeem de ganadores", () => {
    const d = addr("deployer");
    // Usa 8 wallets, que son las definidas en tu helpers
    const users = Array.from({ length: 8 }, (_, i) => addr(`wallet_${i + 1}`));

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const get = {
      pool: () => U(simnet.callReadOnlyFn("market","get-pool",[], d)),
      ySup: () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d)),
      yBal: (who:string) => U(simnet.callReadOnlyFn("market","get-yes-balance",[Cl.principal(who)], d)),
    };

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000), Cl.principal(d)], d));
    users.forEach(u => ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_500), Cl.principal(u)], d)));

    ok(simnet.callPublicFn("market","create",[Cl.uint(1_000)], d));

    // todos consienten cap amplio
    users.forEach(u => ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], u)));

    // patrón determinista de compras: alterna YES/NO con montos variados
    const amounts = [20,35,15,40,10,25,30,12,18,22];
    users.forEach((u, idx) => {
      const amt = amounts[idx % amounts.length];
      if (idx % 2 === 0) ok(simnet.callPublicFn("market","buy-yes",[Cl.uint(amt)], u));
      else               ok(simnet.callPublicFn("market","buy-no", [Cl.uint(amt)], u));
    });

    const poolBeforeResolve = get.pool();

    // resolvemos YES
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // redimen todos los que tengan YES > 0
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
