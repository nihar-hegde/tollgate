import type { Db } from "@tollgate/db";
import type { Mode } from "@tollgate/shared";
import type { Signer } from "./signing";

// What the services need. Time is passed in so tests can move the clock.
export type Store = {
  db: Db;
  now: () => Date;
};

export type Context = Store & {
  signer: Signer;
  mode: Mode;
  policyVersion: string;
};
