export const config = {
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL as string,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  },
  solana: {
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL as string,
    network: import.meta.env.VITE_SOLANA_NETWORK as string,
    programId: import.meta.env.VITE_PROGRAM_ID as string,
  },
  sui: {
    network: import.meta.env.VITE_SUI_NETWORK as string,
    rpcUrl: import.meta.env.VITE_SUI_RPC_URL as string | undefined,
    packageId: import.meta.env.VITE_SUI_PACKAGE_ID as string,
    configId: import.meta.env.VITE_SUI_CONFIG_ID as string,
  },
  dynamic: {
    environmentId: import.meta.env.VITE_DYNAMIC_ENV_ID as string,
  },
  arcPay: {
    // Returnable deposit (Offer PDA rent) shown to buyers on top of their offered
    // price; refunded on settlement. Defaults to 0.00145 SOL if the env var is unset.
    returnableFeeLamports: Number(
      import.meta.env.VITE_RETURNABLE_FEE_LAMPORTS ?? 1_450_000,
    ),
    // Solana network transaction cost added to the total the buyer is charged.
    txCostLamports: Number(import.meta.env.VITE_TX_COST_LAMPORTS ?? 5_000),
    // Sui network/gas cost added to the buyer's total (MIST).
    suiTxCostMist: Number(import.meta.env.VITE_SUI_TX_COST_MIST ?? 2_197_000),
  },
};
