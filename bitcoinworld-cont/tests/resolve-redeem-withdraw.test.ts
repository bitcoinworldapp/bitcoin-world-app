// tests/resolve-redeem-withdraw.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

function unwrapOkTuple(cv: any): Record<string, any> {
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  const cands = [cv.value?.data, cv.value?.value?.data, cv.value?.value, cv.value];
  for (const c of cands) if (c && typeof c === "object" && "cost" in c) return c as Record<string, any>;
  if (cv.data && typeof cv.data === "object" && "cost" in cv.data) return cv.data;
  throw new Error(`Unexpected CV shape: ${JSON.stringify(cv)}`);
}

describe("Resolve → Redeem (multi-winner, último barre residuo) → Withdraw denegado con pool=0", () => {
  it("dos ganadores YES redimen pro-rata; el último barre el remanente; withdraw falla con u710; recipients no cambian en redención", () => {
    const d   = addr("deployer");
    const w1  = addr("wallet_1");   // YES winner #1
    const w2  = addr("wallet_2");   // YES winner #2 (último redentor)
    const w3  = addr("wallet_3");   // NO (perdedor)

    // Recipients
    const drp = addr("wallet_4");
    const brc = addr("wallet_5");
    const tm  = addr("wallet_6");
    const lp  = addr("wallet_7");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(`Tx failed: ${JSON.stringify(r.result)}`); return r; };
    const U  = (res:any) => cvToUint(res.result);
    const bal  = (p:string) => U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const ySup = () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));
    const nSup = () => U(simnet.callReadOnlyFn("market","get-no-supply",[], d));
    const spent = (p:string) => U(simnet.callReadOnlyFn("market","get-spent",[Cl.principal(p)], d));
    const qY   = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);
    const qN   = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-no", [Cl.uint(amt)], caller).result);

    // Principals a trackear (para logs)
    const principals = [d, w1, w2, w3, drp, brc, tm, lp];
    const alias: Record<string,string> = {};
    alias[d] = "deployer"; alias[w1] = "wallet_1"; alias[w2] = "wallet_2"; alias[w3] = "wallet_3";
    alias[drp] = "drip"; alias[brc] = "brc"; alias[tm] = "team"; alias[lp] = "lp";

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
    const logP = (label: string, dltP: Record<string, number>) => {
      const pretty: Record<string, number> = {};
      for (const p of Object.keys(dltP)) pretty[alias[p] || p] = dltP[p];
      console.log(label, pretty);
    };

    // ---- Seed & create ----
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w2)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w3)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d)); // 3% / 1%
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // ---- Compras: YES 200 (w1), YES 100 (w2), NO 150 (w3) ----
    const q1T = qY(200, w1); const q1 = { tot: Number(q1T.total.value), cost: Number(q1T.cost.value) };
    const q2T = qY(100, w2); const q2 = { tot: Number(q2T.total.value), cost: Number(q2T.cost.value) };
    const q3T = qN(150, w3); const q3 = { tot: Number(q3T.total.value), cost: Number(q3T.cost.value) };

    const P0 = pool(), S0 = snapP();
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(200), Cl.uint(q1.tot), Cl.uint(q1.tot)], w1));
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(100), Cl.uint(q2.tot), Cl.uint(q2.tot)], w2));
    ok(simnet.callPublicFn("market","buy-no-auto", [Cl.uint(150), Cl.uint(q3.tot), Cl.uint(q3.tot)], w3));

    expect(ySup()).toBe(300);
    expect(nSup()).toBe(150);
    const P_afterBuys = pool();
    expect(P_afterBuys).toBe(P0 + q1.cost + q2.cost + q3.cost);

    const S1 = snapP(); const D1 = deltaP(S1, S0);
    logP("[OK] Post-buys — deltas por principal:", D1);

    // ---- Resolve YES ----
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // Losers no pueden redimir (u2)
    const loserRedeem = simnet.callPublicFn("market","redeem",[], w3);
    expect(loserRedeem.result.type).toBe("err"); // u2

    // Withdraw antes de que supply ganadora sea 0 => u708
    const wdEarly = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wdEarly.result.type).toBe("err"); // u708

    // ---- Redeem #1: w1 (no es el último) ----
    const P1 = pool();
    const w1Bal0 = bal(w1);
    const R1 = simnet.callPublicFn("market","redeem",[], w1); // outcome YES => redeem-yes
    expect(R1.result.type).toBe("ok");
    const payout1 = cvToUint(R1.result); // uint
    // Payout1 debe ser > 0 y < pool antes, porque no es el último
    expect(payout1).toBeGreaterThan(0);
    expect(payout1).toBeLessThanOrEqual(P1);

    const S2 = snapP(); const D2 = deltaP(S2, S1);
    logP("[OK] Redeem #1 (w1) — deltas por principal:", D2);
    // recipients no cambian en redeem
    expect(D2[drp]).toBe(0); expect(D2[brc]).toBe(0); expect(D2[tm]).toBe(0); expect(D2[lp]).toBe(0);
    // w1 sube en payout1
    expect(bal(w1)).toBe(w1Bal0 + payout1);
    // pool baja exactamente en payout1
    expect(pool()).toBe(P1 - payout1);
    // supply YES bajó 200
    expect(ySup()).toBe(100);

    // ---- Redeem #2: w2 (es el último → barre remanente) ----
    const P2 = pool();
    const w2Bal0 = bal(w2);
    const R2 = simnet.callPublicFn("market","redeem",[], w2);
    expect(R2.result.type).toBe("ok");
    const payout2 = cvToUint(R2.result);
    // Último debe llevarse todo el remanente exacto
    expect(payout2).toBe(P2);

    const S3 = snapP(); const D3 = deltaP(S3, S2);
    logP("[OK] Redeem #2 (w2, último) — deltas por principal:", D3);
    // recipients no cambian
    expect(D3[drp]).toBe(0); expect(D3[brc]).toBe(0); expect(D3[tm]).toBe(0); expect(D3[lp]).toBe(0);
    // w2 sube en payout2; pool → 0; supply YES → 0
    expect(bal(w2)).toBe(w2Bal0 + payout2);
    expect(pool()).toBe(0);
    expect(ySup()).toBe(0);

    // ---- Withdraw con pool=0 => u710 ----
    const wdZero = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wdZero.result.type).toBe("err"); // u710

    // Intento de resolver de nuevo => u102
    const reResolve = simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d);
    expect(reResolve.result.type).toBe("err"); // u102
  });
});
