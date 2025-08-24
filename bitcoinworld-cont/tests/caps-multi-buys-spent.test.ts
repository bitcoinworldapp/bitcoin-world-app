// tests/caps-multi-buys-spent.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

const U = (r:any) => cvToUint(r.result);

function unwrapQuote(res: any) {
  // res es el objeto completo de callReadOnlyFn(...)
  const r = res?.result ?? res;
  if (r?.type !== "ok") {
    console.error("[unwrapQuote] not ok:", r);
    throw new Error(JSON.stringify(r));
  }
  const v = r.value;                     // CV del tuple
  const t = (v && (v.data ?? v.value));  // soporta .data y .value
  if (!t || !t.cost || !t.total) {
    console.error("[unwrapQuote] raw:", JSON.stringify(r, null, 2));
    throw new Error("Bad quote CV");
  }
  return {
    cost:  Number(t.cost.value),
    feeP:  Number(t.feeProtocol.value),
    feeL:  Number(t.feeLP.value),
    drip:  Number(t.drip.value),
    brc:   Number(t.brc20.value),
    team:  Number(t.team.value),
    total: Number(t.total.value),
  };
}

function mustOk(label: string, r: any) {
  if (r.result.type !== "ok") {
    console.error(`[FAIL @ ${label}]`, r.result);
    throw new Error(JSON.stringify(r.result));
  }
  console.log(`[OK @ ${label}]`, r.result);
  return r;
}

describe("Caps + spent: múltiples compras YES/NO, spent correcto y corte u731", () => {
  it("suma spent (base+fees) y corta por cap excedido", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const dr = addr("wallet_2");
    const br = addr("wallet_3");
    const tm = addr("wallet_4");
    const lp = addr("wallet_5");

    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const spent = (who:string) => U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(who)], d));

    console.log("[INFO] using deployer:", d, "w1:", w1);

    // Seed (recuerda: sbtc.mint SIEMPRE desde deployer)
    mustOk("sbtc.mint(deployer)", simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    mustOk("sbtc.mint(w1)",       simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    mustOk("market.create",       simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    mustOk("set-fees",            simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    mustOk("set-split",           simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    mustOk("set-recipients",      simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(dr), Cl.principal(br), Cl.principal(tm), Cl.principal(lp)], d));

    // C1: YES amount=7
    const q1 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(7)], w1));
    mustOk("buy-yes-auto C1", simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(7), Cl.uint(q1.total), Cl.uint(q1.total)], w1));
    const pool1 = Number(pool()); const spent1 = Number(spent(w1));
    console.log("[OK] C1 YES=7 — q:", q1, "pool:", pool1, "spent:", spent1);
    expect(spent1).toBe(q1.total);

    // C2: NO amount=5
    const q2 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(5)], w1));
    mustOk("buy-no-auto C2", simnet.callPublicFn("market","buy-no-auto",[Cl.uint(5), Cl.uint(spent1 + q2.total), Cl.uint(q2.total)], w1));
    const pool2 = Number(pool()); const spent2 = Number(spent(w1));
    console.log("[OK] C2 NO=5 — q:", q2, "Δpool:", pool2 - pool1, "spent:", spent2);
    expect(spent2).toBe(spent1 + q2.total);
    expect(pool2 - pool1).toBe(q2.cost); // pool sube solo por base

    // C3: YES amount=9 -> primero debe fallar por cap ajustado (u731)
    const q3 = unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(9)], w1));
    const tooTightCap = spent2 + q3.total - 1;
    const capErr = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(9), Cl.uint(tooTightCap), Cl.uint(q3.total)], w1);
    expect(capErr.result.type).toBe("err");
    console.log("[OK] C3 bloqueada por u731 — result:", capErr.result);

    // C3-bis: con cap correcto
    mustOk("buy-yes-auto C3bis", simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(9), Cl.uint(spent2 + q3.total), Cl.uint(q3.total)], w1));
    const spent3 = Number(spent(w1));
    console.log("[OK] C3bis YES=9 — q:", q3, "spent:", spent3);
    expect(spent3).toBe(spent2 + q3.total);
  });
});
