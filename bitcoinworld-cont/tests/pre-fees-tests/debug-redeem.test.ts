import { describe, it } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("debug redeem payout", () => {
  it("prints balances, supply and pool before redeem", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const get = {
      qY:    () => U(simnet.callReadOnlyFn("market","get-q-yes",[], d)),
      qN:    () => U(simnet.callReadOnlyFn("market","get-q-no",[], d)),
      ySup:  () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d)),
      nSup:  () => U(simnet.callReadOnlyFn("market","get-no-supply",[], d)),
      yBal:  (who:string) => U(simnet.callReadOnlyFn("market","get-yes-balance",[Cl.principal(who)], d)),
      pool:  () => U(simnet.callReadOnlyFn("market","get-pool",[], d)),
      b:     () => U(simnet.callReadOnlyFn("market","get-b",[], d)),
      stat:  () => simnet.callReadOnlyFn("market","get-status",[], d).result.value,
    };

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(2_000),  Cl.principal(w2)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(1_000)], d));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w1));
    ok(simnet.callPublicFn("market","set-spend-cap",[Cl.uint(1_000_000)], w2));

    ok(simnet.callPublicFn("market","buy-yes",[Cl.uint(100)], w1));
    ok(simnet.callPublicFn("market","buy-no",[Cl.uint(60)],  w2));

    console.log("== after buys ==");
    console.log("qYes=", get.qY(), "qNo=", get.qN(), "ySup=", get.ySup(), "nSup=", get.nSup());
    console.log("yBal[w1]=", get.yBal(w1), "pool=", get.pool(), "b=", get.b());

    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));
    console.log("status after resolve:", get.stat());

    const redeem = simnet.callPublicFn("market","redeem",[], w1);
    console.log("redeem result (w1):", JSON.stringify(redeem.result));
  });
});
