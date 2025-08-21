// tests/fees-lock-and-splits-verified.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

function unwrapOkTuple(cv: any): Record<string, any> {
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  const candidates = [cv.value?.data, cv.value?.value?.data, cv.value?.value, cv.value];
  for (const c of candidates) if (c && typeof c === "object" && "cost" in c) return c as Record<string, any>;
  if (cv.data && typeof cv.data === "object" && "cost" in cv.data) return cv.data;
  throw new Error(`Unexpected CV shape: ${JSON.stringify(cv)}`);
}

describe("Fees: recipients A/B, lock, pause — verificación de balances por principal (sin dobles)", () => {
  it("cada cuenta (principal) termina con el balance correcto; logs legibles", () => {
    const d   = addr("deployer");
    const w1  = addr("wallet_1");
    const w2  = addr("wallet_2");

    // Set A
    const drpA = addr("wallet_3");
    const brcA = addr("wallet_4");
    const tmA  = addr("wallet_5");
    const lpA  = addr("wallet_6");

    // Set B (lpB == drpA => mismo principal intencionalmente)
    const drpB = addr("wallet_7");
    const brcB = addr("wallet_8");
    const tmB  = addr("deployer"); // TEAM_B = deployer
    const lpB  = addr("wallet_3"); // LP_B reusa wallet_3 (mismo principal que drpA)

    const ok = (r: any) => { if (r.result.type !== "ok") throw new Error(`Tx failed: ${JSON.stringify(r.result)}`); return r; };
    const U  = (res: any) => cvToUint(res.result);
    const bal = (p: string) => U(simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(p)], d));
    const pool = () => U(simnet.callReadOnlyFn("market", "get-pool", [], d));
    const ySup = () => U(simnet.callReadOnlyFn("market", "get-yes-supply", [], d));
    const nSup = () => U(simnet.callReadOnlyFn("market", "get-no-supply", [], d));
    const spent = (p: string) => U(simnet.callReadOnlyFn("market", "get-spent", [Cl.principal(p)], d));
    const qY = (amt: number, caller: string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);
    const qN = (amt: number, caller: string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-no", [Cl.uint(amt)], caller).result);
    const N = (x: any) => Number(x);

    // Alias → principal (para expected y logs)
    const names: Record<string,string> = {
      deployer: d, wallet_1: w1, wallet_2: w2,
      drpA, brcA, tmA, lpA, drpB, brcB, tmB, lpB
    };

    // Elegimos un "alias representativo" por principal (el primero que aparezca)
    const principalAlias: Record<string,string> = {};
    for (const alias of Object.keys(names)) {
      const p = names[alias];
      if (!principalAlias[p]) principalAlias[p] = alias;
    }

    // Lista de PRINCIPALES únicos a medir
    const principals = Array.from(new Set(Object.values(names)));

    // Snapshots/deltas por PRINCIPAL (clave = principal)
    const snapP = () => {
      const s: Record<string, number> = {};
      for (const p of principals) s[p] = bal(p);
      return s;
    };
    const deltaP = (after: Record<string,number>, before: Record<string,number>) => {
      const dlt: Record<string, number> = {};
      for (const p of principals) dlt[p] = (after[p] ?? 0) - (before[p] ?? 0);
      return dlt;
    };

    // Convierte expected definido por ALIAS → esperado por PRINCIPAL
    const expectedByPrincipal = (expAlias: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const [alias, val] of Object.entries(expAlias)) {
        const p = names[alias];
        out[p] = (out[p] ?? 0) + val;
      }
      // Asegura que todos los principals están presentes (con 0 por defecto)
      for (const p of principals) if (!(p in out)) out[p] = 0;
      return out;
    };

    // Assert por PRINCIPAL
    const expectP = (actual: Record<string, number>, expectedAlias: Record<string, number>) => {
      const expP = expectedByPrincipal(expectedAlias);
      for (const p of principals) {
        expect(actual[p] ?? 0).toBe(expP[p] ?? 0);
      }
    };

    // Log legible por alias representativo
    const logP = (label: string, dltP: Record<string, number>) => {
      const pretty: Record<string, number> = {};
      for (const p of Object.keys(dltP)) {
        const alias = principalAlias[p] || p;
        pretty[alias] = dltP[p];
      }
      console.log(label, pretty);
    };

    // -------- Seed & create --------
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w2)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));

    // -------- Config A --------
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(200), Cl.uint(50)], d)); // 2% y 0.5%
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drpA), Cl.principal(brcA), Cl.principal(tmA), Cl.principal(lpA)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(60), Cl.uint(25), Cl.uint(15)], d));

    // -------- Buy #1 (YES, w1) con Set A --------
    const q1T = qY(250, w1);
    const q1 = { cost:N(q1T.cost.value), fp:N(q1T.feeProtocol.value), fl:N(q1T.feeLP.value),
                 dr:N(q1T.drip.value), br:N(q1T.brc20.value), tm:N(q1T.team.value), tot:N(q1T.total.value) };

    const P0 = pool(), S0 = snapP();
    const w1Spent0 = spent(w1), w1Bal0 = bal(w1);

    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(250), Cl.uint(q1.tot), Cl.uint(q1.tot)], w1));

    expect(pool()).toBe(P0 + q1.cost);
    expect(ySup()).toBe(250);
    expect(spent(w1)).toBe(w1Spent0 + q1.tot);
    expect(bal(w1)).toBe(w1Bal0 - q1.tot);
    expect(q1.fp).toBe(q1.dr + q1.br + q1.tm);
    expect(q1.tot).toBe(q1.cost + q1.fp + q1.fl);

    const S1 = snapP(); const D1P = deltaP(S1, S0);
    logP("[OK] Buy #1 (Set A) — deltas por principal:", D1P);

    expectP(D1P, {
      wallet_1: -q1.tot,
      drpA: q1.dr, brcA: q1.br, tmA: q1.tm, lpA: q1.fl
    });

    // -------- Cambiar a Set B + Lock --------
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drpB), Cl.principal(brcB), Cl.principal(tmB), Cl.principal(lpB)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(200)], d)); // 3% y 2%
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(10), Cl.uint(0), Cl.uint(90)], d)); // BRC=0
    ok(simnet.callPublicFn("market","lock-fees-config",[], d));

    // -------- Buy #2 (NO, w2) con Set B (locked) --------
    const q2T = qN(150, w2);
    const q2 = { cost:N(q2T.cost.value), fp:N(q2T.feeProtocol.value), fl:N(q2T.feeLP.value),
                 dr:N(q2T.drip.value), br:N(q2T.brc20.value), tm:N(q2T.team.value), tot:N(q2T.total.value) };

    const P1 = pool(), S2 = snapP();
    const w2Spent0 = spent(w2), w2Bal0 = bal(w2);

    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(150), Cl.uint(q2.tot), Cl.uint(q2.tot)], w2));

    expect(pool()).toBe(P1 + q2.cost);
    expect(nSup()).toBe(150);
    expect(spent(w2)).toBe(w2Spent0 + q2.tot);
    expect(bal(w2)).toBe(w2Bal0 - q2.tot);
    expect(q2.fp).toBe(q2.dr + q2.br + q2.tm);
    expect(q2.tot).toBe(q2.cost + q2.fp + q2.fl);
    expect(q2.br).toBe(0); // split B asigna 0 a BRC

    const S3 = snapP(); const D2P = deltaP(S3, S2);
    logP("[OK] Buy #2 (Set B, locked) — deltas por principal:", D2P);

    expectP(D2P, {
      wallet_2: -q2.tot,
      drpB: q2.dr, brcB: q2.br, tmB: q2.tm, lpB: q2.fl
    });

    // -------- pause/unpause y Buy #3 pequeño (YES, w1) Set B --------
    ok(simnet.callPublicFn("market","pause",[], d));
    const blocked = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1), Cl.uint(10_000), Cl.uint(10_000)], w1);
    expect(blocked.result.type).toBe("err"); // u720
    ok(simnet.callPublicFn("market","unpause",[], d));

    const q3T = qY(1, w1);
    const q3 = { cost:N(q3T.cost.value), fp:N(q3T.feeProtocol.value), fl:N(q3T.feeLP.value),
                 dr:N(q3T.drip.value), br:N(q3T.brc20.value), tm:N(q3T.team.value), tot:N(q3T.total.value) };

    const P2 = pool(), S4 = snapP();
    const w1Spent1 = spent(w1), w1Bal1 = bal(w1);

    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1), Cl.uint(w1Spent1 + q3.tot), Cl.uint(q3.tot)], w1));

    expect(pool()).toBe(P2 + q3.cost);
    expect(spent(w1)).toBe(w1Spent1 + q3.tot);
    expect(bal(w1)).toBe(w1Bal1 - q3.tot);

    const S5 = snapP(); const D3P = deltaP(S5, S4);
    logP("[OK] Buy #3 after unpause (Set B) — deltas por principal:", D3P);

    expectP(D3P, {
      wallet_1: -q3.tot,
      drpB: q3.dr, brcB: q3.br, tmB: q3.tm, lpB: q3.fl
    });

    // -------- Totales desde S0 (por principal) --------
    const DtotalP = deltaP(S5, S0);
    logP("[OK] Totales finales por principal — deltas:", DtotalP);

    const expectedTotalsByAlias: Record<string, number> = {
      wallet_1: -(q1.tot + q3.tot),
      wallet_2: -(q2.tot),

      // Set A total
      drpA: q1.dr, brcA: q1.br, tmA: q1.tm, lpA: q1.fl,

      // Set B total
      drpB: q2.dr + q3.dr,
      brcB: q2.br + q3.br, // q2.br = 0
      tmB:  q2.tm + q3.tm,
      lpB:  q2.fl + q3.fl
    };

    expectP(DtotalP, expectedTotalsByAlias);
  });
});
