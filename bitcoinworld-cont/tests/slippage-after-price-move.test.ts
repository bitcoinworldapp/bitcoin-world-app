// tests/slippage-after-price-move.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

function unwrapQuote(res:any){
  const r = res?.result ?? res;
  if (r?.type !== "ok") throw new Error(JSON.stringify(r));
  const v = r.value;
  const t = (v && (v.data ?? v.value));
  if (!t || !t.cost || !t.total) throw new Error("Bad quote CV");
  return {
    cost:  Number(t.cost.value),
    feeP:  Number(t.feeProtocol.value),
    feeL:  Number(t.feeLP.value),
    total: Number(t.total.value),
  };
}

const U  = (r:any)=>cvToUint(r.result);
const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

describe("Slippage: quote viejo vs precio movido por otra compra", () => {
  it("u732 con quote viejo; succeed con quote nuevo", () => {
    const d  = addr("deployer");
    const A  = addr("wallet_1");
    const B  = addr("wallet_2");
    const dr = addr("wallet_3");
    const br = addr("wallet_4");
    const tm = addr("wallet_5");
    const lp = addr("wallet_6");

    const AMT_A = 1000;
    const AMT_B = 3000;

    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(A)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(B)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(dr), Cl.principal(br), Cl.principal(tm), Cl.principal(lp)], d));

    const qA1 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(AMT_A)], A));
    console.log("[INFO] qA1:", qA1);

    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(AMT_B), Cl.uint(10_000_000), Cl.uint(10_000_000)], B));

    const qA2 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(AMT_A)], A));
    console.log("[INFO] qA2:", qA2);

    expect(qA2.total).toBeGreaterThan(qA1.total);

    const fail = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(AMT_A), Cl.uint(qA1.total), Cl.uint(qA1.total)], A);
    console.log("[OK] intento con quote viejo — result:", fail.result);
    expect(fail.result.type).toBe("err"); // u732

    const pass = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(AMT_A), Cl.uint(qA2.total), Cl.uint(qA2.total)], A);
    console.log("[OK] compra con quote nueva — result:", pass.result);
    expect(pass.result.type).toBe("ok");

    const spentA = Number(U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(A)], d)));
    expect(spentA).toBe(qA2.total);
  });
});
