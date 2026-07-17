import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { config } from "../config/env";

type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

const network = (config.sui.network as SuiNetwork) || "testnet";

// Public JSON-RPC on fullnode.<network>.sui.io is disabled (404s), so
// getFullnodeUrl is not usable for testnet. Prefer VITE_SUI_RPC_URL; fall back
// to a working public testnet RPC.
const fallbackUrl =
  network === "testnet"
    ? "https://sui-testnet-rpc.publicnode.com"
    : getFullnodeUrl(network);

export const suiClient = new SuiClient({
  url: config.sui.rpcUrl || fallbackUrl,
});
