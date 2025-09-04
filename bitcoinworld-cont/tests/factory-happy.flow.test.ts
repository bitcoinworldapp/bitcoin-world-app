import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, unwrapQuote } from "./helpers";

const toU = (n: number) => Cl.uint(n);
const toP = (s: string) => Cl.principal(s);
const fmt = (n: number | bigint) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

describe("Market Factory - happy path", () => {
  it("creates a market, multiple buys, resolves NO, winners redeem, losers get u105; pool ends 0 and fees routed", () => {
    // Accounts from Clarinet genesis
    const d   = addr("deployer");    // ADMIN
    const w1  = addr("wallet_1");
    const w2  = addr("wallet_2");
    const w3  = addr("wallet_3");
    const w4  = addr("wallet_4");
    const lp  = addr("wallet_5");
    const team= addr("wallet_6");
    const drp = addr("wallet_7");
    const brc = addr("wallet_8");
    const contractP = `${d}.market`; // contract principal

    const M = 0;

    // --- Read-only helpers ---
    const ro = {
      pool: (m=M) => Number(simnet.callReadOnlyFn("market","get-pool",[toU(m)], d).result.value),
      b:    (m=M) => Number(simnet.callReadOnlyFn("market","get-b",[toU(m)], d).result.value),
      yesSupply: (m=M) => Number(simnet.callReadOnlyFn("market","get-yes-supply",[toU(m)], d).result.value),
      noSupply:  (m=M) => Number(simnet.callReadOnlyFn("market","get-no-supply",[toU(m)], d).result.value),
      quoteY: (amt: number, m=M) => unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-yes",[toU(m), toU(amt)], d)),
      quoteN: (amt: number, m=M) => unwrapQuote(simnet.callReadOnlyFn("market","quote-buy-no", [toU(m), toU(amt)], d)),
    };

    const bal = (who: string) => {
      const res = simnet.callReadOnlyFn("sbtc","get-balance",[toP(who)], d).result;
      const v = res.type === "ok" ? res.value : res;
      return Number(v.value ?? 0);
    };

    const logBalances = (title: string) => {
      console.log(`\n== ${title} ==`);
      console.log(`${d} (ADMIN) sBTC: ${fmt(bal(d))}`);
      console.log(`${w1} sBTC: ${fmt(bal(w1))}`);
      console.log(`${w2} sBTC: ${fmt(bal(w2))}`);
      console.log(`${w3} sBTC: ${fmt(bal(w3))}`);
      console.log(`${w4} sBTC: ${fmt(bal(w4))}`);
      console.log(`${lp} (LP) sBTC: ${fmt(bal(lp))}`);
      console.log(`${drp} (DRIP) sBTC: ${fmt(bal(drp))}`);
      console.log(`${brc} (BRC) sBTC: ${fmt(bal(brc))}`);
      console.log(`${team} (TEAM) sBTC: ${fmt(bal(team))}`);
      console.log(`${contractP} (CONTRACT) sBTC: ${fmt(bal(contractP))}`);
      console.log(`Pool: ${fmt(ro.pool())}  |  b: ${fmt(ro.b())}`);
      console.log(`YES supply: ${fmt(ro.yesSupply())}  |  NO supply: ${fmt(ro.noSupply())}`);
    };

    const expectOk = (r: any, label: string) => {
      if (r.result.type !== "ok") {
        console.log(`${label} ERR ->`, JSON.stringify(r.result, null, 2));
      }
      expect(r.result.type).toBe("ok");
    };

    // --- 0) seed balances (mint sBTC)
    const mint = (to: string, amt: number) =>
      simnet.callPublicFn("sbtc","mint",[toU(amt), toP(to)], d);

    expectOk(mint(d,  50_000), "mint deployer");
    expectOk(mint(w1, 1_000_000), "mint w1");
    expectOk(mint(w2, 1_000_000), "mint w2");
    expectOk(mint(w3, 1_000_000), "mint w3");
    expectOk(mint(w4, 1_000_000), "mint w4");

    logBalances("INITIAL STATE");

    // --- 1) configure fees and recipients
    expectOk(simnet.callPublicFn("market","set-fees",[toU(300), toU(100)], d), "set-fees");
    expectOk(simnet.callPublicFn("market","set-fee-recipients",[toP(drp), toP(brc), toP(team), toP(lp)], d), "set-fee-recipients");

    console.log("\n[CONFIG] protocol=3% (split DRIP/BRC/TEAM), LP=1%");

    // --- 2) create market M=0 with initial liquidity 50_000
    console.log(`\n[CREATE] market ${M} with initial liquidity 50,000 from ADMIN -> CONTRACT`);
    expect(ro.pool()).toBe(0);
    const rCreate = simnet.callPublicFn("market","create-market",[toU(M), toU(50_000)], d);
    expectOk(rCreate, "create-market");
    logBalances("AFTER CREATE");

    // --- 3) buys with quotes + detailed deltas ---
    const buyWithLog = (side: "YES"|"NO", who: string, amt: number, cap: number) => {
      const q = side === "YES" ? ro.quoteY(amt) : ro.quoteN(amt);

      const before = {
        user: bal(who),
        lp: bal(lp),
        drp: bal(drp),
        brc: bal(brc),
        team: bal(team),
        ct:  bal(contractP),
        pool: ro.pool(),
        yS: ro.yesSupply(),
        nS: ro.noSupply(),
      };

      console.log(`\n[BUY ${side}] x${fmt(amt)} @${who}  -> base=${fmt(q.cost)}, feeP=${fmt(q.feeProtocol)} (drip=${fmt(q.drip)}, brc=${fmt(q.brc20)}, team=${fmt(q.team)}), feeLP=${fmt(q.feeLP)}, total=${fmt(q.total)}`);

      const call = side === "YES"
        ? simnet.callPublicFn("market","buy-yes-auto",[toU(M), toU(amt), toU(cap), toU(q.total)], who)
        : simnet.callPublicFn("market","buy-no-auto", [toU(M), toU(amt), toU(cap), toU(q.total)], who);

      expectOk(call, `buy-${side.toLowerCase()}-auto`);

      const after = {
        user: bal(who),
        lp: bal(lp),
        drp: bal(drp),
        brc: bal(brc),
        team: bal(team),
        ct:  bal(contractP),
        pool: ro.pool(),
        yS: ro.yesSupply(),
        nS: ro.noSupply(),
      };

      console.log(`[DELTA] user: ${fmt(after.user - before.user)}  |  contract: ${fmt(after.ct - before.ct)}  |  pool: ${fmt(after.pool - before.pool)}`);
      console.log(`[FEES]  lp: +${fmt(after.lp - before.lp)}  |  drip: +${fmt(after.drp - before.drp)}  |  brc: +${fmt(after.brc - before.brc)}  |  team: +${fmt(after.team - before.team)}`);
      console.log(`[SUPPLY] YES: ${fmt(before.yS)} -> ${fmt(after.yS)}  |  NO: ${fmt(before.nS)} -> ${fmt(after.nS)}`);
    };

    // large caps so we do not hit u731 in happy path
    buyWithLog("YES", w1, 100, 10_000_000);
    buyWithLog("NO",  w2, 200, 10_000_000);
    buyWithLog("NO",  w3, 150, 10_000_000);
    buyWithLog("YES", w4, 120, 10_000_000);
    buyWithLog("NO",  w2,  80, 10_000_000);

    logBalances("AFTER BUYS");

    // --- 4) resolve to NO ---
    console.log("\n[RESOLVE] market 0 -> NO");
    const rRes = simnet.callPublicFn("market","resolve",[toU(M), Cl.stringAscii("NO")], d);
    expectOk(rRes, "resolve");
    console.log(`[RESOLVE STATE] pool: ${fmt(ro.pool())}  |  YES supply: ${fmt(ro.yesSupply())}  |  NO supply: ${fmt(ro.noSupply())}`);

    // --- 5) winners redeem (w2, w3), losers (w1, w4) get u105 ---
    const redeem = (who: string, label: string) => {
      const before = bal(who);
      const r = simnet.callPublicFn("market","redeem",[toU(M)], who);
      if (r.result.type === "ok") {
        const payout = Number(r.result.value.value);
        const after = bal(who);
        console.log(`[REDEEM OK] ${label} @${who} -> payout=${fmt(payout)} | balance: ${fmt(before)} -> ${fmt(after)} | pool now: ${fmt(ro.pool())}`);
      } else {
        const code = Number(r.result.value.value);
        console.log(`[REDEEM ERR] ${label} @${who} -> err u${code} | pool: ${fmt(ro.pool())}`);
      }
      return r;
    };

    const rW2 = redeem(w2, "winner NO (wallet_2)");
    const rW3 = redeem(w3, "winner NO (wallet_3)");
    expect(rW2.result.type).toBe("ok");
    expect(rW3.result.type).toBe("ok");

    const rL1 = redeem(w1, "loser YES (wallet_1)");
    const rL4 = redeem(w4, "loser YES (wallet_4)");
    expect(rL1.result).toEqual({ type:"err", value:{ type:"uint", value: 105n } });
    expect(rL4.result).toEqual({ type:"err", value:{ type:"uint", value: 105n } });

    // --- 6) final state ---
    logBalances("FINAL STATE");

    // Final assertions
    expect(ro.pool()).toBe(0);
  });
});
