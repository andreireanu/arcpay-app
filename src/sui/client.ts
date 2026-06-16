import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { config } from "../config/env";

type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

// Shared SuiClient pinned to the configured network — the Sui analogue of
// solana/connection.ts. We don't trust the wallet's reported network (Phantom
// reports `sui:mainnet` even in testnet mode), so reads and transaction
// execution use this explicit endpoint.
export const suiClient = new SuiClient({
  url: getFullnodeUrl((config.sui.network as SuiNetwork) || "testnet"),
});
