// tests/integration.test.ts
import { describe, it, expect } from "vitest";
import {
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  uintCV,
  principalCV,
  stringAsciiCV,
} from "@stacks/transactions";
import { STACKS_DEVNET } from "@stacks/network";

const network = {
  ...STACKS_DEVNET,
  url: "http://localhost:20443",
};

const senderKey          = "753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601";
const senderAddress      = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const marketContractName = "market";
const sbtcContractName   = "sbtc";

async function toNumber(cv: any): Promise<number> {
  if (cv.result?.value != null) return Number(cv.result.value);
  if (cv.value != null && (typeof cv.value === "string" || typeof cv.value === "number")) {
    return Number(cv.value);
  }
  if (cv.value?.value != null) return Number(cv.value.value);
  if (cv.type === "uint" && cv.value != null) return Number(cv.value);
  console.log("⚠️ Raw CV not parseable:", JSON.stringify(cv, null, 2));
  throw new Error("Unable to extract number from CV");
}

describe("Mercado YES/NO en Devnet [con logs de getters]", () => {
  it("flujo completo con inspección de todos los getters", async () => {
    // 0) Leer nonce inicial
    const acctResp = await fetch(`http://localhost:3999/v2/accounts/${senderAddress}`);
    const { nonce: startNonce } = (await acctResp.json()) as { nonce: number };
    let nonce = startNonce;
    const fee = 200_000;

    async function logGetNum(fn: string, label?: string) {
      const res = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    fn,
        functionArgs:    [],
        senderAddress,
        network,
      });
      const n = await toNumber(res);
      console.log(`  ${label ?? fn} =`, n);
      return n;
    }

    console.log("🔄 Estado inicial:");
    await logGetNum("get-pool", "pool");
    await logGetNum("get-q-yes", "q-yes");
    await logGetNum("get-q-no", "q-no");

    // status & outcome (raw)
    {
      const s = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-status",
        functionArgs:    [],
        senderAddress,
        network,
      });
      console.log("  status raw =", JSON.stringify(s, null, 2));
    }
    {
      const o = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-outcome",
        functionArgs:    [],
        senderAddress,
        network,
      });
      console.log("  outcome raw =", JSON.stringify(o, null, 2));
    }

    // yes-supply & yes-balance
    {
      const ys = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-yes-supply",
        functionArgs:    [],
        senderAddress,
        network,
      });
      console.log("  yes-supply =", await toNumber(ys));
    }
    {
      const yb = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-yes-balance",
        functionArgs:    [principalCV(senderAddress)],
        senderAddress,
        network,
      });
      console.log("  yes-balance =", await toNumber(yb));
    }

    // 1) Mint sBTC
    console.log("\n1) mint 1000 sBTC");
    {
      const tx = await makeContractCall({
        contractAddress: senderAddress,
        contractName:    sbtcContractName,
        functionName:    "mint",
        functionArgs:    [uintCV(1000), principalCV(senderAddress)],
        senderKey,
        network,
        nonce,
        fee,
      });
      await broadcastTransaction({ transaction: tx, network });
      nonce++;
    }
    {
      const sb = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    sbtcContractName,
        functionName:    "get-balance",
        functionArgs:    [principalCV(senderAddress)],
        senderAddress,
        network,
      });
      console.log("  sBTC balance after mint =", await toNumber(sb));
    }

    // 2) buy-yes 10
    console.log("\n2) buy-yes 10");
    {
      const tx = await makeContractCall({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "buy-yes",
        functionArgs:    [uintCV(10)],
        senderKey,
        network,
        nonce,
        fee,
      });
      await broadcastTransaction({ transaction: tx, network });
      nonce++;
    }
    await logGetNum("get-pool", "pool after buy-yes");
    await logGetNum("get-q-yes", "q-yes after buy");
    {
      const yb2 = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-yes-balance",
        functionArgs:    [principalCV(senderAddress)],
        senderAddress,
        network,
      });
      console.log("  yes-balance after buy =", await toNumber(yb2));
    }

    // 3) resolve("YES")
    console.log('\n3) resolve "YES"');
    {
      const tx = await makeContractCall({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "resolve",
        functionArgs:    [stringAsciiCV("YES")],
        senderKey,
        network,
        nonce,
        fee,
      });
      await broadcastTransaction({ transaction: tx, network });
      nonce++;
    }
    {
      const s2 = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-status",
        functionArgs:    [],
        senderAddress,
        network,
      });
      console.log("  status after resolve raw =", JSON.stringify(s2, null, 2));
    }
    {
      const o2 = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "get-outcome",
        functionArgs:    [],
        senderAddress,
        network,
      });
      console.log("  outcome after resolve raw =", JSON.stringify(o2, null, 2));
    }

    // 4) redeem()
    console.log("\n4) redeem()");
    {
      const tx = await makeContractCall({
        contractAddress: senderAddress,
        contractName:    marketContractName,
        functionName:    "redeem",
        functionArgs:    [],
        senderKey,
        network,
        nonce,
        fee,
      });
      await broadcastTransaction({ transaction: tx, network });
      nonce++;
    }
    await logGetNum("get-pool", "pool after redeem");
    {
      const sb2 = await fetchCallReadOnlyFunction({
        contractAddress: senderAddress,
        contractName:    sbtcContractName,
        functionName:    "get-balance",
        functionArgs:    [principalCV(senderAddress)],
        senderAddress,
        network,
      });
      console.log("  sBTC balance after redeem =", await toNumber(sb2));
    }

    // Comprobación final
    const finalPool = await logGetNum("get-pool", "final pool");
    expect(finalPool).toBeGreaterThanOrEqual(0);
  });
});
