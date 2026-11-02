import { timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "./errors";

// Bearer-key check. The keys are compared in constant time so response timing can't leak them.
export function requireKey(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const presented = /^Bearer (.+)$/.exec(req.get("Authorization") ?? "")?.[1] ?? "";
    if (!allowed.some((key) => sameKey(presented, key))) {
      throw new ApiError(401, "unauthorized", "missing or invalid API key");
    }
    next();
  };
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "invalid_request", z.prettifyError(result.error));
  }
  return result.data;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: { code: "invalid_json", message: "body is not valid JSON" } });
    return;
  }
  if (isTooLarge(error)) {
    res.status(413).json({ error: { code: "body_too_large", message: "body is over 16kb" } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
};

// express.json() marks an oversized body with type "entity.too.large".
function isTooLarge(error: unknown): boolean {
  return (error as { type?: unknown } | null)?.type === "entity.too.large";
}

function sameKey(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
