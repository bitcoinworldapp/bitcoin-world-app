import { describe, it, expect } from "vitest";
import { simnet, cvToUint, addr, Cl } from "../helpers";

describe("Fees config: lock & immutability + validation", () => {
  it("bloquea cambios tras lock; valida splits y bps", () => {
    const d = addr("deployer");
    const drp = addr("wallet_4"), brc = addr("wallet_5"), tm = addr("wallet_6"), lp = addr("wallet_7");

    const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // create con 10_000
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(200_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));

    // set-fees OK, set-split OK, recipients OK
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[Cl.principal(drp), Cl.principal(brc), Cl.principal(tm), Cl.principal(lp)], d));

    // splits inválidos (no suma 100) => u742
    const badSplit = simnet.callPublicFn("market","set-protocol-split",[Cl.uint(60), Cl.uint(30), Cl.uint(20)], d);
    expect(badSplit.result).toEqual({ type:"err", value:{ type:"uint", value: 742n } });

    // bps > 10000 => u740/u741
    const badProt = simnet.callPublicFn("market","set-fees",[Cl.uint(10001), Cl.uint(0)], d);
    expect(badProt.result).toEqual({ type:"err", value:{ type:"uint", value: 740n } });
    const badLp = simnet.callPublicFn("market","set-fees",[Cl.uint(0), Cl.uint(10001)], d);
    expect(badLp.result).toEqual({ type:"err", value:{ type:"uint", value: 741n } });

    // lock
    ok(simnet.callPublicFn("market","lock-fees-config",[], d));

    // todo cambio tras lock => u743
    for (const tx of [
      ["set-fees", [Cl.uint(200), Cl.uint(50)]],
      ["set-protocol-split", [Cl.uint(40), Cl.uint(40), Cl.uint(20)]],
      ["set-fee-recipients", [Cl.principal(d), Cl.principal(d), Cl.principal(d), Cl.principal(d)]],
    ] as const) {
      const res = simnet.callPublicFn("market", tx[0], tx[1], d);
      expect(res.result).toEqual({ type:"err", value:{ type:"uint", value: 743n } });
    }

    console.log("[OK] lock-fees-config — inmutabilidad verificada (u743) y validaciones u740/u741/u742 correctas");
  });
});
