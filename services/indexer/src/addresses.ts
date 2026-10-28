// EVM addresses are case-insensitive hex; checksummed and lowercase forms are the same account.
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
