// tests/buys-blocked-after-resolve.test.ts
import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Buys bloqueados tras resolve; redeem sigue; withdraw-surplus gate con pool=0", () => {
  it("bloquea buy con u100, permite redeem y niega withdraw con u710 cuando pool=0", () => {
    const d  = addr("deployer");
    const y1 = addr("wallet_1"); // YES
    const n1 = addr("wallet_2"); // NO
    const dr = addr("wallet_3");
    const br = addr("wallet_4");
    const tm = addr("wallet_5");
    const lp = addr("wallet_6");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const U  = (r:any) => cvToUint(r.result);
    const pool = () => U(simnet.callReadOnlyFn("market","get-pool",[], d));
    const ySup = () => U(simnet.callReadOnlyFn("market","get-yes-supply",[], d));
    const bal  = (p:string) => U(simnet.callReadOnlyFn("sbtc","get-balance",[Cl.principal(p)], d));

    // Bootstrap
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000),  Cl.principal(y1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000),  Cl.principal(n1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[
      Cl.principal(dr), Cl.principal(br), Cl.principal(tm), Cl.principal(lp)
    ], d));

    // Compras iniciales pequeñas (sin usar quote): target-cap/max-cost enormes para evitar slippage/cap issues
    const BIG = 1_000_000_000;
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(5), Cl.uint(BIG), Cl.uint(BIG)], y1));
    ok(simnet.callPublicFn("market","buy-no-auto", [Cl.uint(3), Cl.uint(BIG), Cl.uint(BIG)], n1));

    console.log("[INFO] Post-buys — pool:", Number(pool()));

    // Resolve a YES (usar stringAscii, no existe Cl.ascii)
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // Cualquier buy ahora debe fallar con u100
    const tryBuy = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(1), Cl.uint(BIG), Cl.uint(BIG)], y1);
    expect(tryBuy.result.type).toBe("err");
    console.log("[OK] Buy tras resolve bloqueado — result:", tryBuy.result);

    // Pausa no afecta redeem
    ok(simnet.callPublicFn("market","pause",[], d));
    const p0  = pool(); const y1b0 = bal(y1);
    ok(simnet.callPublicFn("market","redeem",[], y1));
    const p1  = pool(); const y1b1 = bal(y1);
    console.log("[OK] Redeem (y1) — deltas:", { wallet_1: Number(y1b1 - y1b0), pool: Number(p0 - p1) });

    console.log("[INFO] YES supply after redeem:", Number(ySup()), "pool:", Number(pool()));
    expect(Number(pool())).toBe(0);

    // Withdraw-surplus debe fallar con u710 (pool=0)
    const wd = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wd.result.type).toBe("err");
    console.log("[OK] withdraw-surplus denied — result:", wd.result);
  });
});
