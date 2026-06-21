import type { SuiWallet } from "@dynamic-labs/sui-core";

// Dynamic only runs its wallet reconnect on a full page load. Arriving at a page
// via client-side navigation can leave the connector holding a *placeholder*
// wallet whose live wallet-standard features (including `standard:connect`) have
// not been injected yet — so calling connect() immediately throws "Wallet does
// not support standard:connect". The live wallet appears a short moment later
// (the "wait a bit and it works" window the user observed).
//
// This waits for the wallet to actually become ready, then connects once, so the
// subsequent signTransaction (which calls connect() internally) is a no-op and
// the user is only prompted for the transaction signature.
interface RawConnector {
  getFeatures?: () => Record<string, unknown> | undefined;
  getPrimaryAccount?: () => unknown;
  connect?: (opts?: { silent?: boolean }) => Promise<void>;
}

const READY_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 200;

export async function ensureWalletConnected(wallet: SuiWallet): Promise<void> {
  const connector = wallet.connector as unknown as RawConnector;

  // Already connected — connect() would be a no-op anyway.
  if (connector.getPrimaryAccount?.()) return;

  // Poll until the live wallet (with its standard:connect feature) is injected.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let hasFeature = false;
  while (Date.now() < deadline) {
    const features = connector.getFeatures?.();
    if (features && "standard:connect" in features) {
      hasFeature = true;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!hasFeature) {
    console.warn("[ensureWalletConnected] standard:connect never appeared", {
      connector: connector.constructor?.name,
      features: connector.getFeatures?.()
        ? Object.keys(connector.getFeatures()!)
        : null,
    });
  }

  await connector.connect?.();
}
