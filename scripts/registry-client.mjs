import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const sha512Integrity = (bytes) =>
  "sha512-" + createHash("sha512").update(bytes).digest("base64");

class RegistryRequestError extends Error {
  constructor(
    message,
    { status, retryable = false, retryAfterMs = 0, cause } = {},
  ) {
    super(message, { cause });
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** One client shares its deadline across metadata lookup and tarball download. */
export function createRegistryClient({
  fetch: fetchImpl = globalThis.fetch,
  sleep = delay,
  now = Date.now,
  budgetMs = 300_000,
  requestTimeoutMs = 10_000,
  backoffMs = [
    1000,
    2000,
    4000,
    8000,
    15_000,
    20_000,
    ...Array(8).fill(30_000),
  ],
  onRetry = () => {},
} = {}) {
  if (
    !Number.isFinite(budgetMs) ||
    budgetMs <= 0 ||
    !Number.isFinite(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    !Array.isArray(backoffMs) ||
    backoffMs.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new TypeError("Invalid registry retry configuration");
  const deadline = now() + budgetMs;
  const maxWaitMs = 30_000;

  function retryAfter(response) {
    const header = response.headers.get("retry-after");
    if (!header) return 0;
    const seconds = Number(header);
    const milliseconds = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - now();
    return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  }

  async function request(url, operation, allowMissing) {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:")
      throw new TypeError("Registry requests require an HTTP(S) URL");
    let lastError;
    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) break;
      try {
        let response;
        try {
          response = await fetchImpl(url, {
            signal: AbortSignal.timeout(
              Math.max(
                1,
                Math.floor(Math.min(remaining, requestTimeoutMs, 60_000)),
              ),
            ),
            cache: "no-store",
          });
        } catch (cause) {
          throw new RegistryRequestError(
            `Registry ${operation} network request failed`,
            { retryable: true, cause },
          );
        }
        if (response.status === 404 && allowMissing) {
          await response.body?.cancel().catch(() => {});
          return null;
        }
        if (!response.ok) {
          const status = response.status;
          const retryable =
            status === 404 ||
            status === 429 ||
            (status >= 500 && status <= 599);
          const retryAfterMs = retryAfter(response);
          await response.body?.cancel().catch(() => {});
          throw new RegistryRequestError(
            `Registry ${operation} returned HTTP ${status}`,
            { status, retryable, retryAfterMs },
          );
        }
        try {
          return operation === "metadata"
            ? await response.json()
            : new Uint8Array(await response.arrayBuffer());
        } catch (cause) {
          // A malformed successful JSON response is not a propagation failure.
          if (cause instanceof SyntaxError) throw cause;
          throw new RegistryRequestError(
            `Registry ${operation} response download failed`,
            { retryable: true, cause },
          );
        }
      } catch (error) {
        if (!(error instanceof RegistryRequestError) || !error.retryable)
          throw error;
        lastError = error;
        if (attempt === backoffMs.length) break;
        const waitMs = Math.min(
          maxWaitMs,
          Math.max(backoffMs[attempt], error.retryAfterMs),
        );
        if (waitMs >= deadline - now()) break;
        onRetry({
          operation,
          attempt: attempt + 1,
          delayMs: waitMs,
          status: error.status,
        });
        await sleep(waitMs);
      }
    }
    throw new Error(
      `Registry ${operation} verification exhausted its bounded retry window${lastError ? `: ${lastError.message}` : ""}`,
      { cause: lastError },
    );
  }

  return {
    GetMetadata(url, { allowMissing = true } = {}) {
      return request(url, "metadata", allowMissing);
    },
    GetTarball(url) {
      return request(url, "tarball", false);
    },
  };
}

/** Integrity checks are outside the retry loop: immutable mismatches fail on the first response. */
export async function checkRegistryPackage(
  client,
  registry,
  bytes,
  { verifyTarball = false } = {},
) {
  const meta = await client.GetMetadata(registry, {
    allowMissing: !verifyTarball,
  });
  if (meta === null) return null;
  if (!meta || !meta.dist || typeof meta.dist.integrity !== "string")
    throw new Error(
      "Registry metadata does not contain a package integrity value",
    );
  const expected = sha512Integrity(bytes);
  if (meta.dist.integrity !== expected)
    throw new Error(
      "An immutable npm version already exists with different bytes. Bump the version.",
    );
  if (verifyTarball) {
    if (typeof meta.dist.tarball !== "string" || !meta.dist.tarball)
      throw new Error("Registry metadata does not contain a tarball URL");
    const fetched = await client.GetTarball(meta.dist.tarball);
    if (sha512Integrity(fetched) !== expected)
      throw new Error("Published bytes differ from release");
  }
  return meta;
}
