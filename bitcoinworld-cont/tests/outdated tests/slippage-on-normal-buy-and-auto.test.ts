// tests/slippage-on-normal-buy-and-auto.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

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

describe("Slippage en compra normal: cap fijado con auto, precio se mueve y buy-yes falla u731; auto pasa", () => {
  it("demuestra riesgo de slippage en buy normal y cómo lo evita buy-*-auto", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1"); // intenta YES grande
    const w2 = addr("wallet_2"); // mueve precio con NO

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (res:any) => cvToUint(res.result);

    const bal  = (p:string) => U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const spent= (p:string) => U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(p)], d));
    const cap  = (p:string) => U(simnet.callReadOnlyFn("market","get-cap",[Cl.principal(p)], d));

    const qY = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);
    const qN = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-no", [Cl.uint(amt)], caller).result);

    const principals = [w1, w2, d];
    const snap = () => { const s:Record<string,number>={}; for (const p of principals) s[p]=bal(p); return s; };
    const delta= (a:Record<string,number>, b:Record<string,number>) => { const dlt:Record<string,number>={}; for (const p of principals) dlt[p]=(a[p]??0)-(b[p]??0); return dlt; };

    // --- Bootstrap ---
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w2)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[
      Cl.principal(addr("wallet_3")), Cl.principal(addr("wallet_4")),
      Cl.principal(addr("wallet_5")), Cl.principal(addr("wallet_6"))
    ], d));

    // --- w1 cotiza A=600 YES (compra grande) ---
    const A = 600;
    const qA = qY(A, w1);
    const targetCap = Number(qA.total.value);
    console.log("[INFO] quote A=600: total=", targetCap);

    // --- w1 hace una compra AUTO mínima (amount=1) para fijar cap=targetCap ---
    const S0 = snap(); const P0 = pool();
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1), Cl.uint(targetCap), Cl.uint(999_999_999)], w1));
    const S1 = snap(); const D1 = delta(S1, S0);
    console.log("[OK] Auto-min buy to set cap — deltas:", D1, "cap(w1)=", Number(cap(w1)));
    expect(Number(cap(w1))).toBe(targetCap); // cap quedó fijado

    // --- w2 mueve el precio con NO 400 ---
    const qW2 = qN(400, w2);
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(400), Cl.uint(qW2.total.value), Cl.uint(qW2.total.value)], w2));

    // --- Ahora el total real para A=600 subió un poco ---
    const qA2 = qY(A, w1);
    const totalNow = Number(qA2.total.value);
    console.log("[INFO] quote after price move: new total=", totalNow, "old cap=", targetCap);
    expect(totalNow).toBeGreaterThanOrEqual(targetCap);

    // --- w1 intenta buy-yes normal (sin auto) con amount=A -> debe fallar u731 (cap excedido) ---
    const normal = simnet.callPublicFn("market","buy-yes",[Cl.uint(A)], w1);
    expect(normal.result.type).toBe("err"); // u731

    // --- w1 reintenta con auto y max-cost=new total -> debe pasar ---
    const prePool = pool(), preSpent = spent(w1), preBal = bal(w1);
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(A), Cl.uint(targetCap), Cl.uint(totalNow)], w1)); // target-cap se queda como estaba
    const postPool = pool(), postSpent = spent(w1), postBal = bal(w1);
    console.log("[OK] Auto big buy after slippage — deltas:",
      { wallet_1: Number(postBal - preBal), pool: Number(postPool - prePool), spent: Number(postSpent - preSpent) });

    // Verificación básica: pool sube en cost; comprador paga totalNow
    expect(Number(postSpent - preSpent)).toBe(totalNow);
    expect(Number(preBal - postBal)).toBe(totalNow);
  });
});
