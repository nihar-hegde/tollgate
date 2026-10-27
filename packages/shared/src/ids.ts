// Prefixed random ids, in Saifuro's style: mnd_…, dec_…, n_….
// Agent ids are chosen by the operator (e.g. agt_research_01), so they are
// validated by AGENT_ID but never generated.

export const ID_PREFIXES = {
  mandate: "mnd",
  decision: "dec",
  review: "rev",
  nonce: "n",
  delivery: "dlv",
} as const;
export type IdKind = keyof typeof ID_PREFIXES;

// 16 random bytes = 128 bits: enough that a verdict nonce can't be guessed or
// collide. Uses Web Crypto, which works in Node and in the browser.
const RANDOM_BYTES = 16;

export function newId(kind: IdKind): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${ID_PREFIXES[kind]}_${hex}`;
}

export function idPattern(kind: IdKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_[0-9a-f]{${RANDOM_BYTES * 2}}$`);
}

// Operator-chosen agent ids: "agt_" then lowercase letters, digits, underscores.
export const AGENT_ID = /^agt_[a-z0-9_]{1,64}$/;
