// tests/multi-users-happy.flow.test.ts
import { describe, it, expect } from "vitest";
import { simnet, addr, Cl, cvToUint, unwrapQuote } from "../helpers";

const fmt = (n: number | bigint) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

describe("Multi-user happy path: compras múltiples, pool y fees correctos; resolve NO y todos los ganadores redimen", () => {
  it("flujo completo con logs detallados y resumen final", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const w5 = addr("wallet_5");

    // Recipients (todos distintos de los traders para evitar self-transfers)
    const drp = addr("wallet_6"); // DRIP
    const brc = addr("wallet_7"); // BRC20
    const tm  = addr("faucet");   // TEAM (puedes cambiarlo si prefieres)
    const lp  = addr("wallet_8"); // LP fees (NO es trader)

    const ok = (r:any)=>{ if(r.result?.type!=="ok") throw new Error("Not ok: "+JSON.stringify(r.result)); return r; };

    const pool = () => cvToUint(simnet.callReadOnlyFn("market","get-pool",[], d).result);
    const bval = () => cvToUint(simnet.callReadOnlyFn("market","get-b",[], d).result);
    const yesBal = (who: string) =>
      cvToUint(simnet.callReadOnlyFn("market","get-yes-balance",[Cl.principal(who)], d).result);
    const yesSupply = () =>
      cvToUint(simnet.callReadOnlyFn("market","get-yes-supply",[], d).result);
    const noSupply = () =>
      cvToUint(simnet.callReadOnlyFn("market","get-no-supply",[], d).result);

    const balSbtc = (who: string, caller: string = d) =>
      cvToUint(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(who)], caller).result);

    const getSelf = () => {
      const r = simnet.callReadOnlyFn("market","get-self",[], d);
      const raw = r?.result?.value?.value ?? r?.result?.value ?? r?.result;
      return String(raw);
    };

    const quoteYes = (amt:number)=> unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], d));
    const quoteNo  = (amt:number)=> unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no" ,[Cl.uint(amt)], d));

    const buyYesAuto = (who:string, amt:number) => {
      const q = quoteYes(amt);
      const cap = q.total*10;

      const before = { pool: pool(), sbtc: balSbtc(who, who), lp: balSbtc(lp, d), drp: balSbtc(drp, d), brc: balSbtc(brc, d), tm: balSbtc(tm, d) };
      const res = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(amt), Cl.uint(cap), Cl.uint(q.total)], who);
      if(res.result.type!=="ok"){
        console.log("BUY YES failed:", JSON.stringify(res.result));
      }
      expect(res.result.type).toBe("ok");

      const after = { pool: pool(), sbtc: balSbtc(who, who), lp: balSbtc(lp, d), drp: balSbtc(drp, d), brc: balSbtc(brc, d), tm: balSbtc(tm, d) };

      // Invariantes económicos
      expect(after.pool - before.pool).toBe(q.cost);
      expect(before.sbtc - after.sbtc).toBe(q.total);
      expect(after.lp  - before.lp ).toBe(q.feeLP);
      expect(after.drp - before.drp).toBe(q.drip);
      expect(after.brc - before.brc).toBe(q.brc20);
      expect(after.tm  - before.tm ).toBe(q.team);

      console.log(`BUY YES x${amt} @${who}  → base=${fmt(q.cost)}, feeP=${fmt(q.feeProtocol)} (drip=${fmt(q.drip)}, brc=${fmt(q.brc20)}, team=${fmt(q.team)}), feeLP=${fmt(q.feeLP)}, total=${fmt(q.total)}`);
      return q;
    };

    const buyNoAuto = (who:string, amt:number) => {
      const q = quoteNo(amt);
      const cap = q.total*10;

      const before = { pool: pool(), sbtc: balSbtc(who, who), lp: balSbtc(lp, d), drp: balSbtc(drp, d), brc: balSbtc(brc, d), tm: balSbtc(tm, d) };
      const res = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(amt), Cl.uint(cap), Cl.uint(q.total)], who);
      if(res.result.type!=="ok"){
        console.log("BUY NO failed:", JSON.stringify(res.result));
      }
      expect(res.result.type).toBe("ok");

      const after = { pool: pool(), sbtc: balSbtc(who, who), lp: balSbtc(lp, d), drp: balSbtc(drp, d), brc: balSbtc(brc, d), tm: balSbtc(tm, d) };

      // Invariantes económicos
      expect(after.pool - before.pool).toBe(q.cost);
      expect(before.sbtc - after.sbtc).toBe(q.total);
      expect(after.lp  - before.lp ).toBe(q.feeLP);
      expect(after.drp - before.drp).toBe(q.drip);
      expect(after.brc - before.brc).toBe(q.brc20);
      expect(after.tm  - before.tm ).toBe(q.team);

      console.log(`BUY  NO x${amt} @${who}  → base=${fmt(q.cost)}, feeP=${fmt(q.feeProtocol)} (drip=${fmt(q.drip)}, brc=${fmt(q.brc20)}, team=${fmt(q.team)}), feeLP=${fmt(q.feeLP)}, total=${fmt(q.total)}`);
      return q;
    };

    // --- SETUP ---
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(50_000), Cl.principal(d)], d));
    for (const who of [w1,w2,w3,w4,w5]) {
      ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(who)], d));
    }

    console.log("== ESTADO INICIAL ==");
    for (const a of [d,w1,w2,w3,w4,w5,drp,brc,tm]) {
      console.log(a, "sBTC:", fmt(balSbtc(a, d)));
    }

    ok(simnet.callPublicFn("market","create",[Cl.uint(50_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));  // 3% / 1%
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));

    const SELF = getSelf();
    const p0 = pool();
    console.log("Pool tras create:", fmt(p0), " | b =", fmt(bval()));
    console.log("Contrato (SELF) sBTC:", fmt(balSbtc(SELF, d)));

    // --- COMPRAS ---
    const spent: Record<string, number> = { [w1]:0,[w2]:0,[w3]:0,[w4]:0,[w5]:0 };
    const buys: Array<{ who:string; side:"YES"|"NO"; amt:number; q:any }> = [];

    const q1 = buyYesAuto(w1, 100); spent[w1]+=q1.total; buys.push({who:w1, side:"YES", amt:100, q:q1});
    const q2 = buyNoAuto (w2, 200); spent[w2]+=q2.total; buys.push({who:w2, side:"NO" , amt:200, q:q2});
    const q3 = buyNoAuto (w3, 150); spent[w3]+=q3.total; buys.push({who:w3, side:"NO" , amt:150, q:q3});
    const q4 = buyYesAuto(w4, 120); spent[w4]+=q4.total; buys.push({who:w4, side:"YES", amt:120, q:q4});
    const q5 = buyNoAuto (w5,  80); spent[w5]+=q5.total; buys.push({who:w5, side:"NO" , amt: 80, q:q5});

    const baseSum = buys.reduce((s,b)=> s + b.q.cost, 0);
    const feeProt = buys.reduce((s,b)=> s + b.q.feeProtocol, 0);
    const feeLP   = buys.reduce((s,b)=> s + b.q.feeLP, 0);
    const feeDrip = buys.reduce((s,b)=> s + b.q.drip, 0);
    const feeBrc  = buys.reduce((s,b)=> s + b.q.brc20, 0);
    const feeTeam = buys.reduce((s,b)=> s + b.q.team, 0);

    console.log("— RESUMEN COMPRAS —");
    console.log("YES supply:", fmt(yesSupply()), " | NO supply:", fmt(noSupply()));
    console.log("Sum base:", fmt(baseSum), " | prot:", fmt(feeProt), " (drip:", fmt(feeDrip), " brc:", fmt(feeBrc), " team:", fmt(feeTeam), ") | LP:", fmt(feeLP));
    console.log("Pool actual:", fmt(pool()), " | b =", fmt(bval()));

    // Saldos recipients tras compras
    expect(balSbtc(drp, d)).toBe(feeDrip);
    expect(balSbtc(brc, d)).toBe(feeBrc);
    expect(balSbtc(tm , d)).toBe(feeTeam);
    expect(balSbtc(lp , d)).toBe(feeLP);

    // Pool = seed + base costs
    expect(pool()).toBe(50_000 + baseSum);

    // --- RESOLVE -> "NO" ---
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("NO")], d));
    const poolAtResolve = pool();
    console.log("Resolve = NO | pool @resolve:", fmt(poolAtResolve));

    const redeem = (who:string) => {
      const before = { pool: pool(), sbtc: balSbtc(who, who) };
      const r = simnet.callPublicFn("market","redeem",[], who);
      expect(r.result.type).toBe("ok");
      const payout = cvToUint(r.result);
      const after = { pool: pool(), sbtc: balSbtc(who, who) };

      expect(before.pool - after.pool).toBe(payout);
      expect(after.sbtc - before.sbtc).toBe(payout);

      console.log(`REDEEM @${who} → payout=${fmt(payout)} | pool=${fmt(after.pool)}`);
      return payout;
    };

    const pW2 = redeem(w2);
    const pW5 = redeem(w5);
    const pW3 = redeem(w3); // last sweep

    // Suma de payouts == pool @ resolve; pool final = 0; contrato sin saldo
    expect(pW2 + pW5 + pW3).toBe(poolAtResolve);
    expect(pool()).toBe(0);
    expect(balSbtc(SELF, d)).toBe(0);

    console.log("— RESUMEN FINAL —");
    const initial: Record<string, number> = {
      [d]: 50_000, [w1]: 1_000_000, [w2]: 1_000_000, [w3]: 1_000_000, [w4]: 1_000_000, [w5]: 1_000_000,
      [drp]: 0, [brc]: 0, [tm]: 0, [lp]: 0,
    };
    const payout: Record<string, number> = { [w1]:0, [w2]:pW2, [w3]:pW3, [w4]:0, [w5]:pW5 };

    for (const a of [d,w1,w2,w3,w4,w5,drp,brc,tm,lp, SELF]) {
      console.log(a, "sBTC final:", fmt(balSbtc(a, d)));
    }

    // Chequeos por usuario (inicial - spent + payout) == final
    for (const who of [w1,w2,w3,w4,w5]) {
      const expected = initial[who] - (spent[who]||0) + (payout[who]||0);
      const final = balSbtc(who, d);
      expect(final).toBe(expected);
    }
    // Recipients: exactamente sus fees acumuladas
    expect(balSbtc(drp, d)).toBe(feeDrip);
    expect(balSbtc(brc, d)).toBe(feeBrc);
    expect(balSbtc(tm , d)).toBe(feeTeam);
    expect(balSbtc(lp , d)).toBe(feeLP);

    // Supply ganador a 0; perdedor (YES) queda sin valor
    expect(noSupply()).toBe(0);

    console.log("[OK] multi-users happy: pool=0 al final; recipients=fees; balances de usuarios cuadran con (inicial - spent + payout).");
  });
});
