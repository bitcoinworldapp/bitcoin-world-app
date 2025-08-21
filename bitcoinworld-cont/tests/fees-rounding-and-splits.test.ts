// tests/fees-rounding-and-splits.test.ts
import { describe, it, expect } from "vitest";
import { simnet, addr, Cl } from "./helpers";

function unwrapOkTuple(cv: any): Record<string, any> {
  if (cv.type === "err" || cv.type === "responseErr") {
    const code = Number(cv.value?.value ?? -1);
    throw new Error(`read-only returned err u${code}`);
  }
  const c = [cv.value?.data, cv.value?.value?.data, cv.value?.value, cv.value, cv.data].find(
    (x: any) => x && typeof x === "object" && "cost" in x
  );
  if (!c) throw new Error(`Unexpected CV shape: ${JSON.stringify(cv)}`);
  return c as Record<string, any>;
}
const ceilDiv = (n:number, d:number) => Math.floor((n + d - 1) / d);

describe("Ceil de fees y reparto íntegro (team = residuo)", () => {
  it("feeProtocol = ceil(cost * pBps / 10000); drip/brc/team integrales con residuo en team", () => {
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const ok = (r:any) => { if (r.result.type!=="ok") throw new Error(JSON.stringify(r.result)); return r; };

    // Bootstrap
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(100_000), Cl.principal(d)], d));
    ok(simnet.callPublicFn("sbtc","mint",[Cl.uint(20_000),  Cl.principal(w1)], d));
    ok(simnet.callPublicFn("market","create",[Cl.uint(10_000)], d));
    ok(simnet.callPublicFn("market","set-fee-recipients",[
      Cl.principal(addr("wallet_3")), Cl.principal(addr("wallet_4")),
      Cl.principal(addr("wallet_5")), Cl.principal(addr("wallet_6"))
    ], d));

    const scenarios = [
      { pBps: 1,    lBps: 1,    split: [33, 33, 34] },  // fuerza residuos frecuentes
      { pBps: 299,  lBps: 50,   split: [10,  0,  90] },
      { pBps: 300,  lBps: 100,  split: [50, 30,  20] },
      { pBps: 1000, lBps: 0,    split: [0,  100, 0]  },
    ];

    for (const s of scenarios) {
      ok(simnet.callPublicFn("market","set-fees",[Cl.uint(s.pBps), Cl.uint(s.lBps)], d));
      ok(simnet.callPublicFn("market","set-protocol-split",[Cl.uint(s.split[0]), Cl.uint(s.split[1]), Cl.uint(s.split[2])], d));

      // probamos 3 amounts variados
      for (const amt of [1, 7, 123]) {
        const q = unwrapOkTuple(simnet.callReadOnlyFn("market","quote-buy-yes",[Cl.uint(amt)], w1).result);
        const cost   = Number(q.cost.value);
        const feeP   = Number(q.feeProtocol.value);
        const feeL   = Number(q.feeLP.value);
        const drip   = Number(q.drip.value);
        const brc    = Number(q.brc20.value);
        const team   = Number(q.team.value);
        const total  = Number(q.total.value);

        const expFeeP = ceilDiv(cost * s.pBps, 10000);
        const expFeeL = ceilDiv(cost * s.lBps, 10000);
        const expDrip = Math.floor(expFeeP * s.split[0] / 100);
        const expBrc  = Math.floor(expFeeP * s.split[1] / 100);
        const expTeam = expFeeP - (expDrip + expBrc);

        console.log("[SCENARIO]", s, "amt=", amt, { cost, feeP, feeL, drip, brc, team, total });

        expect(feeP).toBe(expFeeP);
        expect(feeL).toBe(expFeeL);
        expect(drip).toBe(expDrip);
        expect(brc).toBe(expBrc);
        expect(team).toBe(expTeam);
        expect(total).toBe(cost + feeP + feeL);
        expect(feeP).toBe(drip + brc + team);
      }
    }
  });
});
