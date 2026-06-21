import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { config } from "../config/env";

type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

export const suiClient = new SuiClient({
  url: getFullnodeUrl((config.sui.network as SuiNetwork) || "testnet"),
});
