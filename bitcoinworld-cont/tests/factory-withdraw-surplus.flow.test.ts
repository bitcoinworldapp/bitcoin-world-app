// tests/factory-withdraw-surplus.test.ts
import { describe, it, expect } from "vitest";
import { simnet, Cl, addr, cvToUint } from "./helpers";

const toU = (n: number) => Cl.uint(n);
// Debe coincidir con ADMIN del contrato
const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";

const mint = (to: string, amount: number, signer: string) =>
  simnet.callPublicFn("sbtc-v2", "mint", [toU(amount), Cl.principal(to)], signer);

const getPool = (m: number) =>
  cvToUint(simnet.callReadOnlyFn("market-factory-v2", "get-pool", [toU(m)], addr("deployer")).result);

describe("Market Factory v2 - withdraw surplus (no winners)", () => {
  it("resolves YES with zero YES supply; admin withdraws the whole pool", () => {
    const d = addr("deployer");
    const w2 = addr("wallet_2");
    const M = 4;

    // bootstrap balances
    expect(mint(ADMIN, 40_000, d).result.type).toBe("ok"); // liquidez inicial del ADMIN
    expect(mint(w2, 1_000_000, d).result.type).toBe("ok");

    // set fees (admin-only)
    expect(simnet.callPublicFn("market-factory-v2","set-fees",[toU(300), toU(100)], ADMIN).result.type).toBe("ok");

    // create market (admin-only)
    expect(simnet.callPublicFn("market-factory-v2","create-market",[toU(M), toU(40_000)], ADMIN).result.type).toBe("ok");

    // buy NO (usuario)
    expect(
      simnet.callPublicFn("market-factory-v2","buy-no-auto",[toU(M), toU(200), toU(1_000_000), toU(50_000)], w2).result.type
    ).toBe("ok");

    const poolBefore = getPool(M);
    expect(poolBefore).toBeGreaterThan(40_000);

    // resolve YES (admin-only) con YES supply = 0
    expect(simnet.callPublicFn("market-factory-v2","resolve",[toU(M), Cl.stringAscii("YES")], ADMIN).result.type).toBe("ok");

    // withdraw-surplus (admin-only)
    expect(simnet.callPublicFn("market-factory-v2","withdraw-surplus",[toU(M)], ADMIN).result.type).toBe("ok");
    expect(getPool(M)).toBe(0);
  });
});
