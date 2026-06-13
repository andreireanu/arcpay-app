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
  dynamic: {
    environmentId: import.meta.env.VITE_DYNAMIC_ENV_ID as string,
  },
  arcPay: {
    // Fixed returnable deposit (Offer PDA) shown to buyers on top of their offered price.
    // 0.00145 SOL.
    returnableFeeLamports: 1_450_000,
  },
};
