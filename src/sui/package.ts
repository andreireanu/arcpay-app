import { config } from "../config/env";

export const PACKAGE_ID = config.sui.packageId;
export const CONFIG_ID = config.sui.configId;

export const CLOCK_ID = "0x6";

export function target(module: string, fn: string): string {
  return `${PACKAGE_ID}::${module}::${fn}`;
}
