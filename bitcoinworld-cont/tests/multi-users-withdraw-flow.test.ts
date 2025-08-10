// tests/multi-users-withdraw-flow.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Multi-user LMSR flow with withdraw-surplus + admin/pausa", () => {
  it("full flow with pause/unpause and surplus withdrawal", () => {
    const deployer = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");

    const marketPrincipal = Cl.contractPrincipal(deployer, "market");

    const ok = (res: any) => {
      if (!res || res.result?.type !== "ok") {
        throw new Error(`Tx failed: ${JSON.stringify(res.result)}`);
      }
      return res;
    };

    // getters
    const getYesBal     = (who: string) => cvToUint(simnet.callReadOnlyFn("market", "get-yes-balance", [Cl.principal(who)], who).result);
    const getYesSupply  = () => cvToUint(simnet.callReadOnlyFn("market", "get-yes-supply", [], deployer).result);
    const getNoSupply   = () => cvToUint(simnet.callReadOnlyFn("market", "get-no-supply",  [], deployer).result);
    const getPool       = () => cvToUint(simnet.callReadOnlyFn("market", "get-pool",      [], deployer).result);
    const getB          = () => cvToUint(simnet.callReadOnlyFn("market", "get-b",         [], deployer).result);
    const getStatus     = () => simnet.callReadOnlyFn("market", "get-status", [], deployer).result;
    const getSBTC       = (who: string) => cvToUint(simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(who)], deployer).result);
    const getSBTCMarket = () => cvToUint(simnet.callReadOnlyFn("sbtc", "get-balance", [marketPrincipal], deployer).result);

    console.log("=== INITIAL STATE ===");
    console.log("pool=", getPool(), "b=", getB());

    // Mint tokens
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(5000), Cl.principal(deployer)], deployer));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(2000), Cl.principal(w1)],       deployer));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(2000), Cl.principal(w2)],       deployer));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(2000), Cl.principal(w3)],       deployer));
    ok(simnet.callPublicFn("sbtc", "mint", [Cl.uint(2000), Cl.principal(w4)],       deployer));

    // Create market
    ok(simnet.callPublicFn("market", "create", [Cl.uint(1000)], deployer));
    console.log("after create -> pool=", getPool(), "b=", getB(), "sBTC[market]=", getSBTCMarket());

    // Add liquidity
    ok(simnet.callPublicFn("market", "add-liquidity", [Cl.uint(500)], deployer));
    console.log("after add-liquidity -> pool=", getPool(), "b=", getB(), "sBTC[market]=", getSBTCMarket());

    // Pause market
    ok(simnet.callPublicFn("market", "pause", [], deployer));
    // try buy while paused → should err u720
    const buyWhilePaused = simnet.callPublicFn("market", "buy-yes", [Cl.uint(10)], w1);
    expect(buyWhilePaused.result.type).toBe("err");

    // Unpause
    ok(simnet.callPublicFn("market", "unpause", [], deployer));

    // Buys
    ok(simnet.callPublicFn("market", "buy-yes", [Cl.uint(100)], w1));
    ok(simnet.callPublicFn("market", "buy-no",  [Cl.uint(50)],  w2));
    ok(simnet.callPublicFn("market", "buy-yes", [Cl.uint(150)], w3));
    ok(simnet.callPublicFn("market", "buy-no",  [Cl.uint(70)],  w4));
    console.log("after buys -> qYes=", getYesSupply(), "qNo=", getNoSupply(), "pool=", getPool());

    // Resolve YES
    ok(simnet.callPublicFn("market", "resolve", [Cl.stringAscii("YES")], deployer));
    expect(getStatus().value).toBe("resolved");

    // Redeem winners
    const payW1 = cvToUint(ok(simnet.callPublicFn("market", "redeem", [], w1)).result);
    const payW3 = cvToUint(ok(simnet.callPublicFn("market", "redeem", [], w3)).result);
    console.log("payouts -> w1:", payW1, "w3:", payW3);

    expect(getYesBal(w1)).toBe(0);
    expect(getYesBal(w3)).toBe(0);
    expect(getYesSupply()).toBe(0);

    // Withdraw surplus (if pool > 0)
    const poolAfterRedeem = getPool();
    console.log("pool after redeem =", poolAfterRedeem);
    if (poolAfterRedeem > 0) {
      ok(simnet.callPublicFn("market", "withdraw-surplus", [], deployer));
      expect(getPool()).toBe(0);
    } else {
      const resWithdraw = simnet.callPublicFn("market", "withdraw-surplus", [], deployer);
      expect(resWithdraw.result.type).toBe("err");
    }

    // Verify non-admin cannot pause
    const pauseByW1 = simnet.callPublicFn("market", "pause", [], w1);
    expect(pauseByW1.result.type).toBe("err");
  });
});
