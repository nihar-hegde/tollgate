import { fromBaseUnits } from "@tollgate/shared";

export const dollars = (units: bigint) => `$${fromBaseUnits(units)}`;

export const basescanTx = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const basescanAddress = (address: string) =>
  `https://sepolia.basescan.org/address/${address}`;

// dec_8292dd2b74762a4a… → dec_8292dd2b
export const shortId = (id: string) => id.slice(0, id.indexOf("_") + 9);

export const shortHex = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

export function timestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
