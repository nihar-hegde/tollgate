// Server-side calls to the authorizer with the secret key, which never reaches the browser.
// The console never writes rules itself: mandates and reviews go through the authorizer.

export type AuthorizerResult<T> = { ok: true; data: T } | { ok: false; message: string };

function config() {
  const url = process.env.AUTHORIZER_URL ?? "http://localhost:4000";
  const key = process.env.AUTHORIZER_SECRET_KEY;
  if (!key) throw new Error("AUTHORIZER_SECRET_KEY is not set");
  return { url, key };
}

export function jwksUrl(): string {
  return `${process.env.AUTHORIZER_URL ?? "http://localhost:4000"}/.well-known/jwks.json`;
}

export async function callAuthorizer<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<AuthorizerResult<T>> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: `the authorizer at ${url} is unreachable` };
  }

  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    return { ok: false, message: json?.error?.message ?? `authorizer answered ${response.status}` };
  }
  return { ok: true, data: json as T };
}
