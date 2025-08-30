// tests/fees-routing.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

/**
 * Extrae el tuple de un CV que viene como (ok { ...tuple... }).
 * Soporta varias formas de anidación del SDK (value.data, value.value.data, etc.).
 */
function unwrapOkTuple(cv: any): Record<string, any> {
  // Si es err, lanza con el código
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  // Candidatos habituales de anidación
  const candidates = [
    cv.value?.data,                // { type: 'ok', value: { type:'tuple', data:{...} } }
    cv.value?.value?.data,         // { type: 'ok', value: { value:{ data:{...} } } }
    cv.value?.value,               // { type: 'ok', value: { value:{...} } }  (algunos SDKs)
    cv.value,                      // { type: 'ok', value:{...} }
  ];
  for (const c of candidates) {
    if (c && typeof c === "object" && "cost" in c) {
      return c as Record<string, any>;
    }
  }
  // Último intento: si el propio cv parece ya ser el tuple
  if (cv.data && typeof cv.data === "object" && "cost" in cv.data) {
    return cv.data;
  }
  throw new Error(`Unexpected CV shape from quote: ${JSON.stringify(cv)}`);
}

describe("Fees routing + quotes + cap/slippage", () => {
  it("pool = cost; vaults = split 50/30/20; LP ok; max-cost y cap con fees", () => {
    const d   = addr("deployer");
    const w1  = addr("wallet_1");
    const drp = addr("wallet_2"); // drip vault
    const brc = addr("wallet_3"); // brc20 vault
    const tm  = addr("wallet_4"); // team
    const lp  = addr("wallet_5"); // LP wallet

    const ok = (r: any) => {
      if (r.result.type !== "ok") {
        throw new Error(`Tx failed: ${JSON.stringify(r.result)}`);
      }
      return r;
    };
    const U = (res: any) => cvToUint(res.result);

    const pool     = () => U(simnet.callReadOnlyFn("market", "get-pool", [], d));
    const qY       = () => U(simnet.callReadOnlyFn("market", "get-yes-supply", [], d));
    const spentOf  = (who: string) => U(simnet.callReadOnlyFn("market", "get-spent", [Cl.principal(who)], d));
    const sbtcBal  = (who: string) => U(simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(who)], d));

    // ---------- Seed y configurar mercado + fees ----------
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(50_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(10_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market", "create", [Cl.uint(10_000)], d));

    // set fees: 3% protocolo, 1% LP; recipients y split 50/30/20
    ok(simnet.callPublicFn("market", "set-fees", [Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market", "set-fee-recipients", [
      Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)
    ], d));
    ok(simnet.callPublicFn("market", "set-protocol-split", [Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // ---------- Quote YES para 100 ----------
    const quoteCV = simnet.callReadOnlyFn("market", "quote-buy-yes", [Cl.uint(100)], w1).result;
    const t = unwrapOkTuple(quoteCV);
    const q = {
      cost:        Number(t.cost.value),
      feeProtocol: Number(t.feeProtocol.value),
      feeLP:       Number(t.feeLP.value),
      drip:        Number(t.drip.value),
      brc20:       Number(t.brc20.value),
      team:        Number(t.team.value),
      total:       Number(t.total.value),
    };

    // ---------- balances antes ----------
    const p0  = pool();
    const d0  = sbtcBal(drp);
    const b0  = sbtcBal(brc);
    const t0  = sbtcBal(tm);
    const l0  = sbtcBal(lp);
    const w10 = sbtcBal(w1);

    // ---------- 1) Slippage: max-cost < total -> debe err ----------
    const tight = simnet.callPublicFn("market", "buy-yes-auto", [
      Cl.uint(100), Cl.uint(q.total), Cl.uint(q.total - 1)
    ], w1);
    expect(tight.result.type).toBe("err"); // ERR-SLIPPAGE u732
    // (opcional) valida código: expect(Number(tight.result.value.value)).toBe(732);

    // ---------- 2) Cap insuficiente: target-cap demasiado bajo -> err u731 ----------
    const capLow = simnet.callPublicFn("market", "buy-yes-auto", [
      Cl.uint(100), Cl.uint(q.total - 1), Cl.uint(q.total)
    ], w1);
    expect(capLow.result.type).toBe("err");
    // (opcional) valida código: expect(Number(capLow.result.value.value)).toBe(731);

    // ---------- 3) Compra válida: target-cap = total, max-cost = total ----------
    ok(simnet.callPublicFn("market", "buy-yes-auto", [
      Cl.uint(100), Cl.uint(q.total), Cl.uint(q.total)
    ], w1));

    // ---------- Verificaciones ----------
    // pool sube SOLO por cost (no total)
    expect(pool()).toBe(p0 + q.cost);
    // supply YES sube en 100
    expect(qY()).toBe(100);

    // Vaults y LP reciben split correcto
    expect(sbtcBal(drp)).toBe(d0 + q.drip);
    expect(sbtcBal(brc)).toBe(b0 + q.brc20);
    expect(sbtcBal(tm)).toBe(t0 + q.team);
    expect(sbtcBal(lp)).toBe(l0 + q.feeLP);

    // Suma protocolo == drip+brc+team
    expect(q.feeProtocol).toBe(q.drip + q.brc20 + q.team);
    // total == cost + feeP + feeL
    expect(q.total).toBe(q.cost + q.feeProtocol + q.feeLP);

    // spent del usuario sube por total
    expect(spentOf(w1)).toBe(q.total);

    // balance sBTC del usuario baja por total
    const w1After = sbtcBal(w1);
    expect(w1After).toBe(w10 - q.total);
  });
});
