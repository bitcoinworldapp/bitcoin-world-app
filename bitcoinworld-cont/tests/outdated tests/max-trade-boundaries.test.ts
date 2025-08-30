import { describe, it, expect } from "vitest";
import { simnet, addr, Cl } from "../helpers";

function qTotal(res: any): number {
  const r = res?.result ?? res;
  const v = r?.value?.data ?? r?.value ?? r?.data ?? r;
  const tot = v?.total?.value ?? v?.total;
  if (tot === undefined) throw new Error("Bad quote shape: " + JSON.stringify(r));
  return Number(tot);
}

describe("Max-trade: límites exactos y cambios en caliente", () => {
  it("=limite permite; >limite corta u722; luego reduce límite y vuelve a cortar", () => {
    const d = addr("deployer"), w1 = addr("wallet_1");
    const ok = (r:any)=>{ if(r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // fondos
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(1_000_000), Cl.principal(w1)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));

    // mercado + fees + split
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fees",[Cl.uint(300), Cl.uint(100)], d));
    ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(50), Cl.uint(30), Cl.uint(20)], d));

    // límite 100
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(100)], d));

    // quote + auto (cap inline) para amt=100
    const q100 = simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(100)], w1);
    const t100 = qTotal(q100);
    const b100 = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(100), Cl.uint(t100*2), Cl.uint(t100*2)], w1);
    expect(b100.result.type).toBe("ok");

    // amt=101 => u722
    const b101 = simnet.callPublicFn("market","buy-yes-auto",[Cl.uint(101), Cl.uint(9_999_999), Cl.uint(9_999_999)], w1);
    expect(b101.result).toEqual({ type:"err", value:{ type:"uint", value: 722n } });

    // baja límite a 50; 51 corta, 50 pasa
    ok(simnet.callPublicFn("market","set-max-trade",[Cl.uint(50)], d));
    const q50 = simnet.callReadOnlyFn("market","quote-buy-no",[Cl.uint(50)], w1);
    const t50 = qTotal(q50);

    const b51 = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(51), Cl.uint(9_999_999), Cl.uint(9_999_999)], w1);
    expect(b51.result).toEqual({ type:"err", value:{ type:"uint", value: 722n } });

    const b50 = simnet.callPublicFn("market","buy-no-auto",[Cl.uint(50), Cl.uint(t50*2), Cl.uint(t50*2)], w1);
    expect(b50.result.type).toBe("ok");

    console.log("[OK] max-trade boundaries — 100 OK, 101 u722; luego 51 u722 y 50 OK.");
  });
});
