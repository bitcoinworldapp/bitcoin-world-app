import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, cvToUint } from "./helpers";

const toU = (n: number) => Cl.uint(n);
const mint = (to: string, amount: number, signer: string) =>
  simnet.callPublicFn("sbtc", "mint", [toU(amount), Cl.principal(to)], signer);

const getPool = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market", "get-pool", [toU(m)], addr("deployer")).result);

describe("Market Factory - withdraw surplus (no winners)", () => {
  it("resolves YES with zero YES supply; admin withdraws the whole pool", () => {
    const d = addr("deployer");
    const w2 = addr("wallet_2");
    const M = 4;

    // bootstrap balances
    expect(mint(d, 40_000, d).result.type).toBe("ok");
    expect(mint(w2, 1_000_000, d).result.type).toBe("ok");

    simnet.callPublicFn("market","set-fees",[toU(300), toU(100)], d);

    expect(simnet.callPublicFn("market","create-market",[toU(M), toU(40_000)], d).result.type).toBe("ok");

    // note 4 args: m, amount, target-cap, max-cost
    expect(
      simnet.callPublicFn("market","buy-no-auto",[toU(M), toU(200), toU(1_000_000), toU(50_000)], w2).result.type
    ).toBe("ok");

    const poolBefore = getPool(M);
    expect(poolBefore).toBeGreaterThan(40_000);

    expect(simnet.callPublicFn("market","resolve",[toU(M), Cl.stringAscii("YES")], d).result.type).toBe("ok");

    expect(simnet.callPublicFn("market","withdraw-surplus",[toU(M)], d).result.type).toBe("ok");
    expect(getPool(M)).toBe(0);
  });
});
