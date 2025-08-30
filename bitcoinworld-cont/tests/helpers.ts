// tests/helpers.ts
import { Cl as Clarity } from "@stacks/transactions";

// simnet inyectado por el environment de clarinet-vitest
export const simnet: any = (globalThis as any).simnet;

// Exporta Cl para que los tests puedan usar Cl.uint, Cl.principal, etc.
export { Clarity as Cl };

// Devuelve direccion por indice (0,1,2,...) o por nombre ("deployer","wallet_1",...)
export function addr(index: number | string): string {
  const accounts = simnet.getAccounts();
  if (typeof index === "number") {
    const keys = Array.from(accounts.keys());
    const key = keys[index];
    if (!key) throw new Error(`Cuenta con indice ${index} no encontrada`);
    return accounts.get(key)!;
  }
  const val = accounts.get(index);
  if (!val) throw new Error(`Cuenta no encontrada: ${index}`);
  return val;
}

// Convierte CV uint -> number (maneja ok(uint) tambien)
export function cvToUint(cv: any): number {
  if (!cv) throw new Error("cvToUint: valor vacio");
  if (cv.type === "ok")  return cvToUint(cv.value);
  if (cv.type === "uint") return Number(cv.value);
  throw new Error(`cvToUint: tipo inesperado ${cv.type}`);
}

// Atajo: principal desde string ST...
export function principal(address: string) {
  return Clarity.principal(address);
}
// --- QUOTES helpers robustos (soportan distintas formas del CV) ---
export function unwrapQuote(res: any) {
  const root = res?.result ?? res;

  // capa 1: ok/err wrapper
  let v: any = root?.value ?? root?.data ?? root;

  // capa 2: tuple wrapper
  if (v?.type === "tuple" && v?.value) v = v.value;

  // capa 3: a veces viene como { data: { cost, total, ... } }
  if (v?.data && (v.data.total || v.data.cost)) v = v.data;

  const pick = (k: string) => {
    const f = v?.[k];
    const val = f?.value ?? f;
    if (val === undefined) {
      throw new Error(`Quote missing ${k}: ${JSON.stringify(root)}`);
    }
    return Number(val);
  };

  return {
    cost:        pick("cost"),
    feeProtocol: pick("feeProtocol"),
    feeLP:       pick("feeLP"),
    drip:        pick("drip"),
    brc20:       pick("brc20"),
    team:        pick("team"),
    total:       pick("total"),
  };
}

export function quoteTotal(res: any): number {
  return unwrapQuote(res).total;
}
