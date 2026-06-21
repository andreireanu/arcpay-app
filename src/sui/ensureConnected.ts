import type { SuiWallet } from "@dynamic-labs/sui-core";

// Dynamic only runs its wallet reconnect on a full page load. Arriving at a page
// via client-side navigation can leave the connector holding a *placeholder*
// wallet whose live wallet-standard features (including `standard:connect`) have
// not been injected yet — so calling connect() immediately throws "Wallet does
// not support standard:connect". The live wallet appears a short moment later
// (the "wait a bit and it works" window the user observed).
//
// This waits for the wallet to actually become ready — it does NOT connect
// itself. The connect is left to signTransaction's own internal connect() call,
// so the buyer sees exactly one connection prompt (when the wallet is ready)
// followed by the transaction prompt, instead of a double connection request.
interface RawConnector {
  getFeatures?: () => Record<string, unknown> | undefined;
  getPrimaryAccount?: () => unknown;
}

const READY_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 200;

export async function ensureWalletConnected(wallet: SuiWallet): Promise<void> {
  const connector = wallet.connector as unknown as RawConnector;

  // Already connected — signTransaction's connect() will be a no-op.
  if (connector.getPrimaryAccount?.()) return;

  // Wait until the live wallet (with its standard:connect feature) is injected,
  // then return and let signTransaction perform the single connect itself.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const features = connector.getFeatures?.();
    if (features && "standard:connect" in features) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.warn("[ensureWalletConnected] standard:connect never appeared", {
    connector: connector.constructor?.name,
    features: connector.getFeatures?.()
      ? Object.keys(connector.getFeatures()!)
      : null,
  });
}
