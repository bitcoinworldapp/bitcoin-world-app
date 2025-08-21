import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "./helpers";

describe("Pause/unpause y errores basicos (auto-buy)", () => {
  it("compras bloqueadas en pausa; withdraw antes de resolve falla; non-admin no puede pausar", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");

    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };
    const pool = () => cvToUint(simnet.callReadOnlyFn("market","get-pool",[], d).result);

    // Seed y create
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(10_000), Cl.principal(d)],  d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint( 1_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(500)], d));

    // Pausa bloquea compras
    ok(simnet.callPublicFn("market","pause",[], d));
    const buyPaused = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(10), Cl.uint(1000), Cl.uint(1000)], w1);
    expect(buyPaused.result.type).toBe("err"); // u720

    // Unpause y compra ok
    ok(simnet.callPublicFn("market","unpause",[], d));
    ok(simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(10), Cl.uint(1000), Cl.uint(1000)], w1));

    // Withdraw antes de resolve => err u707
    const wd = simnet.callPublicFn("market","withdraw-surplus",[], d);
    expect(wd.result.type).toBe("err");

    // non-admin no puede pausar => err u706
    const pauseByUser = simnet.callPublicFn("market","pause",[], w1);
    expect(pauseByUser.result.type).toBe("err");

    // Resolve YES y redeem
    ok(simnet.callPublicFn("market","resolve",[Cl.stringAscii("YES")], d));
    const r = simnet.callPublicFn("market","redeem",[], w1);
    if (r.result.type === "ok") {
      expect(pool()).toBeLessThan(500); // se pagó algo a w1
    }
  });
});
