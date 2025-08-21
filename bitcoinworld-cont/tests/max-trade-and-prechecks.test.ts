// tests/max-trade-and-prechecks.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

function unwrapOkTuple(cv: any): Record<string, any> {
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  const c = [cv.value?.data, cv.value?.value?.data, cv.value?.value, cv.value, cv.data].find(
    (x: any) => x && typeof x === "object" && "cost" in x
  );
  if (!c) throw new Error(`Unexpected CV shape: ${JSON.stringify(cv)}`);
  return c as Record<string, any>;
}

describe("Prechecks + Max-trade + amount=0 guard", () => {
  it("u721 antes de create, u722 al exceder límite, u704 para amount=0, compra dentro de límite OK", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (res:any) => cvToUint(res.result);
    const bal = (p:string) => U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const spent = (p:string) => U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(p)], d));
    const qY = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);

    // --- 0) Comprar ANTES de create -> u721 (not initialized) ---
    const pre = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1), Cl.uint(100), Cl.uint(100)], w1);
    expect(pre.result.type).toBe("err"); // u721

    // --- 1) Bootstrap mercado ---
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(50_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(200), Cl.uint(50)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(60), Cl.uint(25), Cl.uint(15)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[
      Cl.principal(addr("wallet_3")), Cl.principal(addr("wallet_4")),
      Cl.principal(addr("wallet_5")), Cl.principal(addr("wallet_6"))
    ], d));

    // --- 2) set-max-trade = 100; intentar 101 -> u722 ---
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(100)], d));
    const tooBig = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(101), Cl.uint(999_999), Cl.uint(999_999)], w1);
    expect(tooBig.result.type).toBe("err"); // u722

    // --- 3) amount=0 debe ser u704 (guard en buy-yes-auto) ---
    const zeroAmt = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(0), Cl.uint(1), Cl.uint(1)], w1);
    expect(zeroAmt.result.type).toBe("err"); // u704

    // --- 4) Compra válida dentro del límite (100) ---
    const q = qY(100, w1);
    const prePool = pool(), preSpent = spent(w1), preBal = bal(w1);
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(100), Cl.uint(q.total.value), Cl.uint(q.total.value)], w1));
    const postPool = pool(), postSpent = spent(w1), postBal = bal(w1);

    console.log("[OK] Max-trade within limit — deltas:",
      { wallet_1: Number(postBal - preBal), pool: Number(postPool - prePool), spent: Number(postSpent - preSpent) });

    expect(postPool - prePool).toBe(Number(q.cost.value));
    expect(postSpent - preSpent).toBe(Number(q.total.value));
    expect(preBal - postBal).toBe(Number(q.total.value));
  });
});
