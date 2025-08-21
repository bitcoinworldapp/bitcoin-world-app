// tests/add-liquidity-and-b-dynamics.test.ts
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

describe("add-liquidity aumenta b y abarata el coste marginal", () => {
  it("b sube tras add-liquidity; mismas compras cotizan más barato", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (res:any) => cvToUint(res.result);

    const getB = () => U(simnet.callReadOnlyFn("market","get-b",[], d));
    const qY = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);

    // Bootstrap
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[
      Cl.principal(addr("wallet_3")), Cl.principal(addr("wallet_4")),
      Cl.principal(addr("wallet_5")), Cl.principal(addr("wallet_6"))
    ], d));

    const b0 = getB();
    const qBefore = qY(500, w1); // misma compra antes/después
    console.log("[INFO] b0=", Number(b0), "cost-before=", Number(qBefore.cost.value));

    // add-liquidity por admin
    ok(simnet.callPublicFn("market","add-liquidity",[Cl.uint(20_000)], d));
    const b1 = getB();
    const qAfter = qY(500, w1);
    console.log("[INFO] b1=", Number(b1), "cost-after=", Number(qAfter.cost.value));

    expect(Number(b1)).toBeGreaterThan(Number(b0));
    // El coste marginal debería bajar o igual (nunca subir con más b)
    expect(Number(qAfter.cost.value)).toBeLessThanOrEqual(Number(qBefore.cost.value));

    // No-admin no puede add-liquidity
    const notAdmin = simnet.callPublicFn("market","add-liquidity",[Cl.uint(1_000)], w1);
    expect(notAdmin.result.type).toBe("err"); // u706

    // amount=0 prohibido
    const zero = simnet.callPublicFn("market","add-liquidity",[Cl.uint(0)], d);
    expect(zero.result.type).toBe("err"); // u702
  });
});
