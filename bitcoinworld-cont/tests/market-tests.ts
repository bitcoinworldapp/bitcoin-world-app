import { Clarinet, Tx, Chain, Account } from "clarinet";

Clarinet.test({
  name: "Usuario compra YES y aumenta pool",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const user = accounts.get("wallet_1")!;
    // 1) Mint sBTC al usuario
    chain.mineBlock([Tx.contractCall("sbtc", "mint", ["u1000", user.address], user)]);
    // 2) Compro YES
    let block = chain.mineBlock([ Tx.contractCall("market", "buy-yes", ["u10"], user) ]);
    block.receipts[0].result.expectOk().expectUint(10);
    // 3) Verificar estado
    block.receipts[0].events.expectFungibleTokenTransferEvent(10, user.address, ".market", "sbtc");
    chain.callReadOnlyFn("market", "get-q-yes", [], user).result.expectUint(10);
  },
});
