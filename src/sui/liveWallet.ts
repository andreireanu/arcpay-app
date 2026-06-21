import { getWallets } from "@wallet-standard/app";
import { signTransaction } from "@mysten/wallet-standard";
import type { Transaction } from "@mysten/sui/transactions";

// On client-side navigation Dynamic's Sui connector can end up holding a dead
// placeholder wallet whose features are null — so it can neither connect nor
// sign ("Wallet does not support standard:connect"). The live wallet (e.g.
// Slush) is still registered with the page through the wallet-standard registry,
// so we talk to it directly and bypass Dynamic entirely. Embedded (email) wallets
// are not in the registry, so those fall back to Dynamic's own signing.

interface WalletAccount {
  address: string;
  chains: readonly string[];
}

interface ConnectFeature {
  connect: () => Promise<{ accounts: readonly WalletAccount[] }>;
}

interface StandardWallet {
  name: string;
  accounts: readonly WalletAccount[];
  features: Record<string, unknown>;
}

function nameMatches(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

// Finds the live registry wallet for the user's *connected* wallet. Matching by
// the connected wallet's name (not just "first Sui wallet") is essential when
// several Sui wallets are installed — otherwise we'd prompt Phantom instead of
// the Slush the user is actually signed in with. Returns undefined rather than
// guessing a different wallet.
function findSuiWallet(
  address?: string,
  walletName?: string,
): StandardWallet | undefined {
  const wallets = getWallets().get() as unknown as StandardWallet[];
  const sui = wallets.filter(
    (w) =>
      "sui:signTransaction" in w.features ||
      "sui:signTransactionBlock" in w.features,
  );

  // 1. A wallet already holding this exact account is unambiguous.
  if (address) {
    const owned = sui.find((w) => w.accounts.some((a) => a.address === address));
    if (owned) return owned;
  }
  // 2. Otherwise match the connected wallet by name (e.g. "slushsui" → "Slush").
  if (walletName) {
    return sui.find((w) => nameMatches(w.name, walletName));
  }
  return undefined;
}

// Returns the account to sign with, connecting the live wallet first if needed.
// connect() is what shows the wallet's connection request (the "sign").
async function ensureLiveConnection(
  wallet: StandardWallet,
  address?: string,
): Promise<WalletAccount | undefined> {
  const existing = address
    ? wallet.accounts.find((a) => a.address === address)
    : wallet.accounts[0];
  if (existing) return existing;

  const connect = wallet.features["standard:connect"] as
    | ConnectFeature
    | undefined;
  if (!connect) return wallet.accounts[0];

  const res = await connect.connect();
  return (
    (address && res.accounts.find((a) => a.address === address)) ||
    res.accounts[0]
  );
}

// Prompt the live wallet's connection request on page entry (the sign-on-open),
// bypassing Dynamic's dead connector. No-op when there is no extension wallet.
export async function connectLiveSuiWallet(
  address?: string,
  walletName?: string,
): Promise<void> {
  const wallet = findSuiWallet(address, walletName);
  if (!wallet) return;
  await ensureLiveConnection(wallet, address);
}

interface DynamicSigner {
  address: string;
  connector?: { name?: string };
  signTransaction: (
    t: Transaction,
  ) => Promise<{ bytes: string; signature: string }>;
}

// Sign a built transaction. Prefers the live wallet-standard wallet (works after
// client-side navigation); falls back to Dynamic for embedded wallets.
export async function signSuiTransaction(
  dynamicWallet: DynamicSigner,
  transaction: Transaction,
): Promise<{ bytes: string; signature: string }> {
  const wallet = findSuiWallet(
    dynamicWallet.address,
    dynamicWallet.connector?.name,
  );
  if (!wallet) return dynamicWallet.signTransaction(transaction);

  const account = await ensureLiveConnection(wallet, dynamicWallet.address);
  if (!account) return dynamicWallet.signTransaction(transaction);

  const { bytes, signature } = await signTransaction(wallet as never, {
    transaction: transaction as never,
    account: account as never,
    chain: ((account.chains[0] as string) ?? "sui:testnet") as never,
  });
  return { bytes, signature };
}
