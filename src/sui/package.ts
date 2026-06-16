import { config } from "../config/env";

// On-chain package + shared object IDs (the Sui analogue of solana/program.ts's
// PROGRAM_ID). Move calls are addressed by string, so there's no IDL / generated
// program client to instantiate — just the package id and the shared objects.
export const PACKAGE_ID = config.sui.packageId;
export const CONFIG_ID = config.sui.configId;

// The framework Clock shared object, required by time-gated entry functions.
export const CLOCK_ID = "0x6";

// Fully-qualified Move call target, e.g. target("buy", "buy") → `${pkg}::buy::buy`.
export function target(module: string, fn: string): string {
  return `${PACKAGE_ID}::${module}::${fn}`;
}
