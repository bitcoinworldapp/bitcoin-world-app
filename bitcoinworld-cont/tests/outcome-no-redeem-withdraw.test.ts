// tests/outcome-no-redeem-withdraw.test.ts
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

describe("Outcome NO: winners en NO, último redentor barre; withdraw gating con u709", () => {
  it("redeem-no pro-rata, último barre; withdraw falla si supply NO>0 (u709) y con pool=0 (u710)", () => {
    const d   = addr("deployer");
    const y1  = addr("wallet_1"); // YES perdedor
    const n1  = addr("wallet_2"); // NO winner #1
    const n2  = addr("wallet_3"); // NO winner #2 (último)

    const drp = addr("wallet_4"), brc = addr("wallet_5"), tm = addr("wallet_6"), lp = addr("wallet_7");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (res:any) => cvToUint(res.result);
    const bal  = (p:string) => U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const ySup = () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));
    const nSup = () => U(simnet.callReadOnlyFn("market","get-no-supply",[], d));
    const qY   = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], caller).result);
    const qN   = (amt:number, caller:string) => unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-no", [Cl.uint(amt)], caller).result);

    const principals = [d, y1, n1, n2, drp, brc, tm, lp];
    const alias: Record<string,string> = { [d]:"deployer", [y1]:"yes1", [n1]:"no1", [n2]:"no2", [drp]:"drip", [brc]:"brc", [tm]:"team", [lp]:"lp" };
    const snap = () => { const s:Record<string,number> = {}; for (const p of principals) s[p]=bal(p); return s; };
    const delta= (a:Record<string,number>, b:Record<string,number>) => { const dlt:Record<string,number>={}; for (const p of principals) dlt[p]=(a[p]??0)-(b[p]??0); return dlt; };
    const log  = (label:string, dlt:Record<string,number>) => { const pretty:Record<string,number>={}; for (const p of Object.keys(dlt)) pretty[alias[p]||p]=dlt[p]; console.log(label, pretty); };

    // Bootstrap
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(y1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(n1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(n2)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // Buys: YES 120 (y1), NO 200 (n1), NO 100 (n2)
    const qy = qY(120, y1), qn1 = qN(200, n1), qn2 = qN(100, n2);
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(120), Cl.uint(qy.total.value), Cl.uint(qy.total.value)], y1));
    ok(simnet.callPublicFn("market","buy-no-auto", [Cl.uint(200), Cl.uint(qn1.total.value), Cl.uint(qn1.total.value)], n1));
    ok(simnet.callPublicFn("market","buy-no-auto", [Cl.uint(100), Cl.uint(qn2.total.value), Cl.uint(qn2.total.value)], n2));

    const P_afterBuys = pool();
    const S0 = snap(); log("[OK] Post-buys — deltas:", delta(S0, S0)); // solo para ver balances base

    // Resolve NO
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("NO")], d));
    expect(nSup()).toBe(300);

    // Withdraw antes de supply NO==0 => u709
    const wdEarly = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wdEarly.result.type).toBe("err"); // u709

    // Redeem n1 (no último): payout < pool
    const P1 = pool(), n1b0 = bal(n1);
    const R1 = simnet.callPublicFn("market","redeem",[], n1);
    expect(R1.result.type).toBe("ok");
    const pay1 = cvToUint(R1.result);
    expect(pay1).toBeGreaterThan(0);
    expect(pay1).toBeLessThanOrEqual(P1);

    const S1 = snap(); log("[OK] Redeem #1 (NO winner n1) — deltas:", delta(S1, S0));
    expect(bal(n1)).toBe(n1b0 + pay1);
    expect(pool()).toBe(P1 - pay1);
    expect(nSup()).toBe(100); // 300 - 200

    // Redeem n2 (último): barre remanente
    const P2 = pool(), n2b0 = bal(n2);
    const R2 = simnet.callPublicFn("market","redeem",[], n2);
    expect(R2.result.type).toBe("ok");
    const pay2 = cvToUint(R2.result);
    expect(pay2).toBe(P2);

    const S2 = snap(); log("[OK] Redeem #2 (NO winner n2, último) — deltas:", delta(S2, S1));
    expect(bal(n2)).toBe(n2b0 + pay2);
    expect(pool()).toBe(0);
    expect(nSup()).toBe(0);

    // Withdraw con pool=0 => u710
    const wdZero = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wdZero.result.type).toBe("err"); // u710
  });
});
