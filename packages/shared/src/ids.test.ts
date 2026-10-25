import { describe, expect, it } from "vitest";
import { AGENT_ID, ID_PREFIXES, idPattern, newId, type IdKind } from "./ids";

const kinds = Object.keys(ID_PREFIXES) as IdKind[];

describe("newId", () => {
  it.each(kinds)("makes a %s id with its prefix and 32 hex characters", (kind) => {
    const id = newId(kind);
    expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
    expect(id).toMatch(idPattern(kind));
  });

  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId("nonce")));
    expect(ids.size).toBe(1000);
  });
});

describe("idPattern", () => {
  it("rejects another kind's prefix", () => {
    expect(newId("decision")).not.toMatch(idPattern("mandate"));
  });

  it.each(["mnd_", "mnd_xyz", "mnd_7f3a", `MND_${"a".repeat(32)}`, `mnd_${"A".repeat(32)}`])(
    "rejects %j",
    (value) => {
      expect(value).not.toMatch(idPattern("mandate"));
    },
  );
});

describe("AGENT_ID", () => {
  it.each(["agt_research_01", "agt_a", "agt_procurement_01"])("accepts %j", (value) => {
    expect(value).toMatch(AGENT_ID);
  });

  it.each(["agt_", "research_01", "agt_Research", "agt_research-01", "agt_ research", "agt_x\n"])(
    "rejects %j",
    (value) => {
      expect(value).not.toMatch(AGENT_ID);
    },
  );
});
