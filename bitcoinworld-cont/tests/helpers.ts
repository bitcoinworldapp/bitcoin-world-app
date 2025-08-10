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
