import { supabase } from "../client";

export function buildRegisterMessage(wallet: string): string {
  return [
    "Welcome to ArcPay!",
    "",
    "Click to sign in and confirm ownership of this wallet.",
    "",
    "This request will not trigger a blockchain transaction or cost any gas fees.",
    "",
    "Domain: app.arcpay.to",
    `Wallet address: ${wallet}`,
  ].join("\n");
}

export async function registerWallet(
  wallet: string,
  signature: Uint8Array,
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) throw new Error("Not authenticated");

  const { error } = await supabase.functions.invoke("sol-register-wallet", {
    body: {
      wallet,
      signature: Array.from(signature),
    },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
}
