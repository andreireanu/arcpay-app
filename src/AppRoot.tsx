import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import {
  DynamicContextProvider,
  FilterChain,
  FilterWallets,
} from "@dynamic-labs/sdk-react-core";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import { SuiWalletConnectors } from "@dynamic-labs/sui";
import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
import { DynamicWaasSuiConnectors } from "@dynamic-labs/waas-sui";
import { ConnectionProvider } from "@solana/wallet-adapter-react";
import { AuthContextProvider } from "./context/AuthContext";
import { ChainAuthContext, type AuthChain } from "./context/ChainAuthContext";
import { getActiveChain } from "./supabase/auth/auth";
import { config } from "./config/env";
import { router } from "./router";

// Phantom + the embedded (email) wallet connector. Dynamic keys Sui wallets with
// a `sui` suffix, so Phantom-on-Sui is `phantomsui` (vs `phantom` on Solana).
// `dynamicwaas` is the embedded wallet behind email login. The login flow
// further scopes this list to the chosen chain.
const ALLOWED_WALLET_KEYS = ["phantom", "phantomsui", "dynamicwaas"];

export default function AppRoot() {
  // Which chain the login auth flow is scoped to. Seeded from the last session's
  // chain so a returning user lands on the same one. Login updates this before
  // opening the auth flow.
  const [authChain, setAuthChain] = useState<AuthChain>(
    getActiveChain() === "sui" ? "SUI" : "SOL",
  );

  return (
    <DynamicContextProvider
      settings={{
        environmentId: config.dynamic.environmentId,
        // Phantom reports its Sui chain as `sui:mainnet` to dapps even when its
        // global Testnet Mode is on, so Dynamic's network check would block the
        // connect. We don't rely on the wallet's reported network — the Sui
        // client/RPC we build transactions with sets the target network — so
        // network validation is disabled.
        networkValidationMode: "never",
        walletConnectors: [
          SolanaWalletConnectors,
          SuiWalletConnectors,
          DynamicWaasSVMConnectors,
          DynamicWaasSuiConnectors,
        ],
        walletsFilter: (wallets) =>
          FilterChain(authChain)(FilterWallets(ALLOWED_WALLET_KEYS)(wallets)),
      }}
    >
      <ChainAuthContext.Provider value={{ authChain, setAuthChain }}>
        <ConnectionProvider endpoint={config.solana.rpcUrl}>
          <AuthContextProvider>
            <RouterProvider router={router} />
          </AuthContextProvider>
        </ConnectionProvider>
      </ChainAuthContext.Provider>
    </DynamicContextProvider>
  );
}
