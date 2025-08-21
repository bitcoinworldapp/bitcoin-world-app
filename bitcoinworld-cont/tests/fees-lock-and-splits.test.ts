// tests/fees-lock-and-splits.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

// Desempaqueta un (ok { tuple }) desde un CV en distintas variantes del SDK
function unwrapOkTuple(cv: any): Record<string, any> {
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  const candidates = [
    cv.value?.data,
    cv.value?.value?.data,
    cv.value?.value,
    cv.value,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object" && "cost" in c) return c as Record<string, any>;
  }
  if (cv.data && typeof cv.data === "object" && "cost" in cv.data) return cv.data;
  throw new Error(`Unexpected CV shape: ${JSON.stringify(cv)}`);
}

describe("Fees: invalid params, recipients/split changes, lock, pause", () => {
  it("valida errores, rutea fees a recipients A/B y bloquea cambios con lock", () => {
    const d   = addr("deployer");
    const w1  = addr("wallet_1");
    const w2  = addr("wallet_2");

    // Recipients set A
    const drpA = addr("wallet_3");
    const brcA = addr("wallet_4");
    const tmA  = addr("wallet_5");
    const lpA  = addr("wallet_6");

    // Recipients set B (todo dentro de wallet_1..wallet_8 + deployer)
    const drpB = addr("wallet_7");
    const brcB = addr("wallet_8");
    const tmB  = addr("deployer"); // usa deployer como TEAM_B
    const lpB  = addr("wallet_3"); // reusa otra cuenta existente

    const ok = (r: any) => {
      if (r.result.type !== "ok") throw new Error(`Tx failed: ${JSON.stringify(r.result)}`);
      return r;
    };
    const U = (res: any) => cvToUint(res.result);

    const pool    = () => U(simnet.callReadOnlyFn("market", "get-pool", [], d));
    const spent   = (who: string) => U(simnet.callReadOnlyFn("market", "get-spent", [Cl.principal(who)], d));
    const ySup    = () => U(simnet.callReadOnlyFn("market", "get-yes-supply", [], d));
    const nSup    = () => U(simnet.callReadOnlyFn("market", "get-no-supply", [], d));
    const bal     = (who: string) => U(simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(who)], d));
    const quoteY  = (amt: number, caller: string) => unwrapOkTuple(simnet.callReadOnlyFn("market", "quote-buy-yes", [Cl.uint(amt)], caller).result);
    const quoteN  = (amt: number, caller: string) => unwrapOkTuple(simnet.callReadOnlyFn("market", "quote-buy-no",  [Cl.uint(amt)], caller).result);

    // -------- Seed & create --------
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(20_000),  Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market", "create", [Cl.uint(10_000)], d));

    // -------- Validar errores de params (antes de configurar bien) --------
    const badSplit = simnet.callPublicFn("market", "set-protocol-split", [Cl.uint(40), Cl.uint(30), Cl.uint(40)], d); // 110 != 100
    expect(badSplit.result.type).toBe("err"); // u742

    const badProt = simnet.callPublicFn("market", "set-fees", [Cl.uint(10001), Cl.uint(0)], d);
    expect(badProt.result.type).toBe("err"); // u740
    const badLp   = simnet.callPublicFn("market", "set-fees", [Cl.uint(0), Cl.uint(10001)], d);
    expect(badLp.result.type).toBe("err"); // u741

    // -------- Configuración válida inicial (Set A) --------
    ok(simnet.callPublicFn("market", "set-fees", [Cl.uint(200), Cl.uint(50)], d)); // 2% protocolo, 0.5% LP
    ok(simnet.callPublicFn("market", "set-fee-recipients", [
      Cl.principal(drpA), Cl.principal(brcA), Cl.principal(tmA), Cl.principal(lpA)
    ], d));
    ok(simnet.callPublicFn("market", "set-protocol-split", [Cl.uint(60), Cl.uint(25), Cl.uint(15)], d)); // 60/25/15

    // -------- Buy #1: w1 compra YES con config A --------
    const q1T = quoteY(250, w1);
    const q1 = {
      cost: Number(q1T.cost.value),
      fp:   Number(q1T.feeProtocol.value),
      fl:   Number(q1T.feeLP.value),
      dr:   Number(q1T.drip.value),
      br:   Number(q1T.brc20.value),
      tm:   Number(q1T.team.value),
      tot:  Number(q1T.total.value),
    };

    const p0  = pool();
    const w10 = bal(w1);
    const dA0 = bal(drpA), bA0 = bal(brcA), tA0 = bal(tmA), lA0 = bal(lpA);

    ok(simnet.callPublicFn("market", "buy-yes-auto", [Cl.uint(250), Cl.uint(q1.tot), Cl.uint(q1.tot)], w1));

    // Post Buy #1 (Set A recibe)
    expect(pool()).toBe(p0 + q1.cost);
    expect(ySup()).toBe(250);
    expect(spent(w1)).toBe(q1.tot);
    expect(bal(w1)).toBe(w10 - q1.tot);

    expect(bal(drpA)).toBe(dA0 + q1.dr);
    expect(bal(brcA)).toBe(bA0 + q1.br);
    expect(bal(tmA)).toBe(tA0 + q1.tm);
    expect(bal(lpA)).toBe(lA0 + q1.fl);
    expect(q1.fp).toBe(q1.dr + q1.br + q1.tm);
    expect(q1.tot).toBe(q1.cost + q1.fp + q1.fl);

    // -------- Cambiar a config B y LOCK --------
    ok(simnet.callPublicFn("market", "set-fee-recipients", [
      Cl.principal(drpB), Cl.principal(brcB), Cl.principal(tmB), Cl.principal(lpB)
    ], d));
    ok(simnet.callPublicFn("market", "set-fees", [Cl.uint(300), Cl.uint(200)], d)); // 3% protocolo, 2% LP
    ok(simnet.callPublicFn("market", "set-protocol-split", [Cl.uint(10), Cl.uint(0), Cl.uint(90)], d)); // 10/0/90
    ok(simnet.callPublicFn("market", "lock-fees-config", [], d));

    // Intentar cambiar tras lock -> u743
    const trySplitAfterLock = simnet.callPublicFn("market", "set-protocol-split", [Cl.uint(50), Cl.uint(30), Cl.uint(20)], d);
    expect(trySplitAfterLock.result.type).toBe("err"); // u743
    const tryFeesAfterLock = simnet.callPublicFn("market", "set-fees", [Cl.uint(100), Cl.uint(100)], d);
    expect(tryFeesAfterLock.result.type).toBe("err"); // u743
    const tryRecipientsAfterLock = simnet.callPublicFn("market", "set-fee-recipients", [
      Cl.principal(drpA), Cl.principal(brcA), Cl.principal(tmA), Cl.principal(lpA)
    ], d);
    expect(tryRecipientsAfterLock.result.type).toBe("err"); // u743

    // -------- Buy #2: w2 compra NO con config B (lock) --------
    const q2T = quoteN(150, w2);
    const q2 = {
      cost: Number(q2T.cost.value),
      fp:   Number(q2T.feeProtocol.value),
      fl:   Number(q2T.feeLP.value),
      dr:   Number(q2T.drip.value),
      br:   Number(q2T.brc20.value),
      tm:   Number(q2T.team.value),
      tot:  Number(q2T.total.value),
    };

    const p1  = pool();
    const w20 = bal(w2);
    const dB0 = bal(drpB), bB0 = bal(brcB), tB0 = bal(tmB), lB0 = bal(lpB);

    ok(simnet.callPublicFn("market", "buy-no-auto", [Cl.uint(150), Cl.uint(q2.tot), Cl.uint(q2.tot)], w2));

    // Post Buy #2 (Set B recibe)
    expect(pool()).toBe(p1 + q2.cost);
    expect(nSup()).toBe(150);
    expect(spent(w2)).toBe(q2.tot);
    expect(bal(w2)).toBe(w20 - q2.tot);

    expect(bal(drpB)).toBe(dB0 + q2.dr);
    expect(bal(brcB)).toBe(bB0 + q2.br);
    expect(bal(tmB)).toBe(tB0 + q2.tm);
    expect(bal(lpB)).toBe(lB0 + q2.fl);
    expect(q2.fp).toBe(q2.dr + q2.br + q2.tm);
    expect(q2.tot).toBe(q2.cost + q2.fp + q2.fl);

    // -------- pause() bloquea compras; unpause() reanuda --------
    ok(simnet.callPublicFn("market", "pause", [], d));
    const blocked = simnet.callPublicFn("market", "buy-yes-auto", [Cl.uint(1), Cl.uint(10_000), Cl.uint(10_000)], w1);
    expect(blocked.result.type).toBe("err"); // u720

    ok(simnet.callPublicFn("market", "unpause", [], d));

    // Compra pequeña tras unpause (sigue config B por lock)
    const q3T = quoteY(1, w1);
    const q3 = {
      cost: Number(q3T.cost.value),
      fp:   Number(q3T.feeProtocol.value),
      fl:   Number(q3T.feeLP.value),
      dr:   Number(q3T.drip.value),
      br:   Number(q3T.brc20.value),
      tm:   Number(q3T.team.value),
      tot:  Number(q3T.total.value),
    };
    const p2  = pool();
    const dB1 = bal(drpB), bB1 = bal(brcB), tB1 = bal(tmB), lB1 = bal(lpB);

    ok(simnet.callPublicFn("market", "buy-yes-auto", [Cl.uint(1), Cl.uint(spent(w1) + q3.tot), Cl.uint(q3.tot)], w1));

    expect(pool()).toBe(p2 + q3.cost);
    expect(bal(drpB)).toBe(dB1 + q3.dr);
    expect(bal(brcB)).toBe(bB1 + q3.br);
    expect(bal(tmB)).toBe(tB1 + q3.tm);
    expect(bal(lpB)).toBe(lB1 + q3.fl);
  });
});
