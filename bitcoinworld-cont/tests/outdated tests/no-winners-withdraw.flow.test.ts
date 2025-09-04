import { describe, it, expect } from "vitest";
import { simnet, addr, Cl, cvToUint, unwrapQuote } from "../helpers";

describe("No winners: withdraw-surplus libera el pool al admin", () => {
  it("bloquea redeem (u105) y permite withdraw-surplus; pool queda a 0", () => {
    const d = addr("deployer"), w1 = addr("wallet_1");
    const ok = (r:any)=>{ if(r.result?.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // Fondos
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(200_000), Cl.principal(d)], d));

    // Mercado sin compras
    ok(simnet.callPublicFn("market","create",[Cl.uint(50_000)], d));

    // Resolver al lado sin compradores (YES)
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));

    // Redeem bloqueado: no hay supply ganador => u105
    const rd = simnet.callPublicFn("market","redeem",[], w1);
    expect(rd.result).toEqual({ type:"err", value:{ type:"uint", value: 105n } });

    // Admin puede retirar el pool completo
    const wd = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wd.result.type).toBe("ok");

    const pool = cvToUint(simnet.callReadOnlyFn("market","get-pool",[], w1).result);
    expect(pool).toBe(0);

    console.log("[OK] no winners -> withdraw-surplus drena el pool");
  });
});
