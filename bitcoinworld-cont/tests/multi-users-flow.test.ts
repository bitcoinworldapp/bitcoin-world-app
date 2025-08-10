import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";
import { simnet, cvToUint, addr } from "./utils/helpers";

describe("Multi-user LMSR flow: create -> mixed buys (YES/NO) -> resolve YES -> winners redeem", () => {
  it("runs a complete scenario with multiple users on both sides and checks proportional payouts", () => {
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");

    const getB       = () => simnet.callReadOnlyFn("market", "get-b", [], w1).result;
    const getYesBal  = (who:any) => simnet.callReadOnlyFn("market", "get-yes-balance", [Cl.principal(who)], w1).result;
    const getYesSupply = () => simnet.callReadOnlyFn("market", "get-yes-supply", [], w1).result;
    const getNoSupply = () => simnet.callReadOnlyFn("market", "get-no-supply", [], w1).result;
    const getPool    = () => simnet.callReadOnlyFn("market", "get-pool", [], w1).result;
    const getSBTC    = (who:any) => simnet.callReadOnlyFn("sbtc", "get-balance", [Cl.principal(who)], w1).result;
    const getStatus  = () => simnet.callReadOnlyFn("market", "get-status", [], w1).result;
    const getOutcome = () => simnet.callReadOnlyFn("market", "get-outcome", [], w1).result;

    const logState = (label: string) => {
      console.log(`${label} -> qYes=${cvToUint(getYesSupply())}, qNo=${cvToUint(getNoSupply())}, pool=${cvToUint(getPool())}, b=${cvToUint(getB())}, YES[w1]=${cvToUint(getYesBal(w1))}, YES[w3]=${cvToUint(getYesBal(w3))}, sBTC[w1]=${cvToUint(getSBTC(w1))}, sBTC[w2]=${cvToUint(getSBTC(w2))}, sBTC[w3]=${cvToUint(getSBTC(w3))}, sBTC[w4]=${cvToUint(getSBTC(w4))}, sBTC[market]=${cvToUint(getSBTC("market"))}, status=${getStatus().value}, outcome=${getOutcome().value}`);
    };

    console.log("=== INITIAL STATE ===");
    logState("start");

    // Mint balances
    simnet.callPublicFn("sbtc", "mint", [Cl.principal(addr("deployer")), Cl.uint(6000)], addr("deployer"));
    simnet.callPublicFn("sbtc", "mint", [Cl.principal(w1), Cl.uint(2500)], addr("deployer"));
    simnet.callPublicFn("sbtc", "mint", [Cl.principal(w2), Cl.uint(2500)], addr("deployer"));
    simnet.callPublicFn("sbtc", "mint", [Cl.principal(w3), Cl.uint(2500)], addr("deployer"));
    simnet.callPublicFn("sbtc", "mint", [Cl.principal(w4), Cl.uint(2500)], addr("deployer"));

    // Create market with liquidity
    const bInit = simnet.callPublicFn("market", "create", [Cl.uint(2000)], addr("deployer")).result;
    console.log(`create(2000): ${JSON.stringify(bInit)}`);
    logState("after create");

    // Buys
    simnet.callPublicFn("market", "buy-yes", [Cl.uint(40)], w1);
    logState("after w1 YES");

    simnet.callPublicFn("market", "buy-no", [Cl.uint(30)], w2);
    logState("after w2 NO");

    simnet.callPublicFn("market", "buy-yes", [Cl.uint(60)], w3);
    logState("after w3 YES");

    simnet.callPublicFn("market", "buy-no", [Cl.uint(50)], w4);
    logState("after w4 NO");

    // Resolve YES
    simnet.callPublicFn("market", "resolve", [Cl.stringUtf8("YES")], addr("deployer"));
    logState("after resolve");

    // Redeem w1
    const expW1 = Math.floor(cvToUint(getPool()) * cvToUint(getYesBal(w1)) / cvToUint(getYesSupply()));
    const resW1 = simnet.callPublicFn("market", "redeem", [], w1);
    const payW1 = cvToUint(resW1.result);
    expect(payW1).toBe(expW1);
    logState("after redeem w1");

    // Redeem w3 (recalculate based on new pool and supply)
    const expW3 = Math.floor(cvToUint(getPool()) * cvToUint(getYesBal(w3)) / cvToUint(getYesSupply()));
    const resW3 = simnet.callPublicFn("market", "redeem", [], w3);
    const payW3 = cvToUint(resW3.result);
    expect(payW3).toBe(expW3);
    logState("after redeem w3");
  });
});
