import { timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "./errors";

// Bearer-key check. The keys are compared in constant time so response timing can't leak them.
export function requireKey(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const presented = req.get("Authorization")?.replace(/^Bearer /, "") ?? "";
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
  console.error(error);
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
};

function sameKey(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
