// Dynamic only runs its wallet reconnect on a full page load. Arriving at a page
// via client-side navigation can leave the connector holding a *placeholder*
// wallet whose live wallet-standard `standard:connect` feature is never injected
// (getFeatures() returns null) — so connect() throws "Wallet does not support
// standard:connect" and never recovers. A full page reload re-registers the
// wallet (the manual "refresh and it works" path the user relies on).

interface RawConnector {
  getFeatures?: () => Record<string, unknown> | undefined;
  getPrimaryAccount?: () => unknown;
}

type WalletLike = { connector: unknown };

const POLL_INTERVAL_MS = 150;

function isReady(wallet: WalletLike): boolean {
  const connector = wallet.connector as RawConnector;
  if (connector.getPrimaryAccount?.()) return true;
  const features = connector.getFeatures?.();
  return !!features && "standard:connect" in features;
}

// Resolves true once the wallet is connectable (feature present or already
// connected), or false if it never becomes ready within `timeoutMs`.
export async function waitForWalletReady(
  wallet: WalletLike,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isReady(wallet)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return isReady(wallet);
}
