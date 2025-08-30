// tests/withdraw-surplus-nowinners.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

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

describe("Withdraw-surplus cuando no hay ganadores (supply ganadora == 0 y pool > 0)", () => {
  it("solo compras en NO; resuelve YES; YES-supply==0; admin puede retirar todo el pool", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1"); // solo compra NO

    // Recipients (no afectan a redeem/withdraw pero logueamos)
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
    const qN   = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(amt)], caller).result);

    const principals = [d, w1, drp, brc, tm, lp];
    const alias: Record<string,string> = { [d]:"deployer", [w1]:"wallet_1", [drp]:"drip", [brc]:"brc", [tm]:"team", [lp]:"lp" };
    const snapP = () => { const s:Record<string,number>={}; for (const p of principals) s[p]=bal(p); return s; };
    const deltaP = (a:Record<string,number>, b:Record<string,number>) => { const dlt:Record<string,number>={}; for (const p of principals) dlt[p]=(a[p]??0)-(b[p]??0); return dlt; };
    const logP = (label:string, dlt:Record<string,number>) => { const pretty:Record<string,number>={}; for (const p of Object.keys(dlt)) pretty[alias[p]||p]=dlt[p]; console.log(label, pretty); };

    // ---- Seed & create ----
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));

    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // ---- Solo compra NO ----
    const qT = qN(500, w1); const q = { tot: Number(qT.total.value), cost: Number(qT.cost.value) };
    const P0 = pool(), S0 = snapP();
    ok(simnet.callPublicFn("market","buy-no-auto",[Cl.uint(500), Cl.uint(q.tot), Cl.uint(q.tot)], w1));
    expect(nSup()).toBe(500);
    expect(ySup()).toBe(0);
    expect(pool()).toBe(P0 + q.cost);

    const S1 = snapP(); const D1 = deltaP(S1, S0);
    logP("[OK] Post-buy (NO only) — deltas:", D1);

    // ---- Resolve YES (sin YES supply) ----
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));
    expect(ySup()).toBe(0);
    const P_beforeWithdraw = pool();
    expect(P_beforeWithdraw).toBeGreaterThan(0); // hay pool y nadie puede redimir (no hay YES)

    // Withdraw OK (supply ganadora == 0 y pool > 0)
    const dBal0 = bal(d);
    ok(simnet.callPublicFn("market","withdraw-surplus",[], d));
    expect(pool()).toBe(0);
    expect(bal(d)).toBe(dBal0 + P_beforeWithdraw);

    const S2 = snapP(); const D2 = deltaP(S2, S1);
    logP("[OK] Withdraw-surplus (no winners) — deltas:", D2);
  });
});
