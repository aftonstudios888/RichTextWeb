import test from "node:test";
import assert from "node:assert/strict";
import {
  createRegistryClient,
  checkRegistryPackage,
  sha512Integrity,
} from "../scripts/registry-client.mjs";

const localBytes = new TextEncoder().encode("immutable release tarball");
const metadata = {
  name: "@test/package",
  version: "0.2.0",
  dist: {
    integrity: sha512Integrity(localBytes),
    tarball: "https://registry.example/package.tgz",
  },
};
const registry = "https://registry.example/package/0.2.0";
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

type Result = Response | Error | (() => Response | Promise<Response>);
function harness(results: Result[], options: Record<string, unknown> = {}) {
  let currentTime = 0;
  const calls: { url: string; signal: AbortSignal }[] = [],
    sleeps: number[] = [],
    retries: unknown[] = [];
  const client = createRegistryClient({
    fetch: async (url: string, init: { signal: AbortSignal }) => {
      calls.push({ url, signal: init.signal });
      assert.ok(results.length, "No unexpected fetch calls");
      const result = results.shift()!;
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result() : result;
    },
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    now: () => currentTime,
    onRetry: (event: unknown) => retries.push(event),
    ...options,
  });
  return {
    client,
    calls,
    sleeps,
    retries,
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
    get time() {
      return currentTime;
    },
  };
}

test("prepare treats missing versions as absent immediately without sleeping", async () => {
  const h = harness([new Response(null, { status: 404 })]);
  assert.equal(
    await checkRegistryPackage(h.client, registry, localBytes),
    null,
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("verify waits for metadata and tarball propagation, then validates the exact bytes", async () => {
  const h = harness([
    new Response(null, { status: 404 }),
    new Response(null, { status: 503 }),
    json(metadata),
    new Response(null, { status: 404 }),
    new Response(localBytes),
  ]);
  assert.deepEqual(
    await checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    metadata,
  );
  assert.deepEqual(
    h.calls.map((call) => call.url),
    [
      registry,
      registry,
      registry,
      metadata.dist.tarball,
      metadata.dist.tarball,
    ],
  );
  assert.deepEqual(h.sleeps, [1000, 2000, 1000]);
  assert.ok(h.calls.every((call) => call.signal instanceof AbortSignal));
});

test("network failures and rate limiting retry; Retry-After waits stay below 60 seconds", async () => {
  const h = harness([
    new TypeError("fetch failed"),
    new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    json(metadata),
  ]);
  assert.deepEqual(
    await checkRegistryPackage(h.client, registry, localBytes),
    metadata,
  );
  assert.deepEqual(h.sleeps, [1000, 30000]);
  assert.equal(h.time, 31000);
});

test("permanent 4xx errors fail immediately instead of being retried", async () => {
  for (const status of [400, 401, 403, 410, 422]) {
    const h = harness([new Response(null, { status })]);
    await assert.rejects(
      checkRegistryPackage(h.client, registry, localBytes, {
        verifyTarball: true,
      }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.sleeps, []);
  }
});

test("metadata integrity mismatch is immutable and fails without retries or tarball fetch", async () => {
  const h = harness([
    json({
      ...metadata,
      dist: {
        ...metadata.dist,
        integrity: sha512Integrity(new Uint8Array([1])),
      },
    }),
  ]);
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    /immutable npm version/,
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("downloaded tarball mismatch fails immediately even after a propagation retry", async () => {
  const h = harness([
    json(metadata),
    new Response(null, { status: 404 }),
    new Response("different bytes"),
  ]);
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    /Published bytes differ/,
  );
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.sleeps, [1000]);
});

test("malformed successful metadata fails without retrying it as a transient request", async () => {
  const malformed = harness([new Response("{broken json")]);
  await assert.rejects(
    checkRegistryPackage(malformed.client, registry, localBytes, {
      verifyTarball: true,
    }),
    SyntaxError,
  );
  assert.equal(malformed.calls.length, 1);
  assert.deepEqual(malformed.sleeps, []);
  const invalid = harness([json({ dist: {} })]);
  await assert.rejects(
    checkRegistryPackage(invalid.client, registry, localBytes),
    /integrity value/,
  );
  assert.equal(invalid.calls.length, 1);
});

test("metadata and tarball retries share one bounded elapsed-time budget", async () => {
  const h = harness(
    [
      new Response(null, { status: 404 }),
      json(metadata),
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
    ],
    { budgetMs: 3500 },
  );
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    /bounded retry window/,
  );
  assert.deepEqual(h.sleeps, [1000, 1000]);
  assert.equal(h.time, 2000);
  assert.equal(h.calls.length, 4);
});

test("request elapsed time counts against the retry window", async () => {
  let h: ReturnType<typeof harness>;
  h = harness(
    [
      () => {
        h.advance(89_500);
        return new Response(null, { status: 503 });
      },
    ],
    { budgetMs: 90_000 },
  );
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    /bounded retry window/,
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("perpetual propagation failures stop after the configured attempt count", async () => {
  const h = harness(
    Array.from({ length: 15 }, () => new Response(null, { status: 404 })),
  );
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    /HTTP 404/,
  );
  assert.equal(h.calls.length, 15);
  assert.equal(h.time, 290000);
  assert.ok(h.sleeps.every((milliseconds) => milliseconds <= 30000));
});

test("interrupted response bodies retry network transfer without relaxing integrity checks", async () => {
  const failed = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("connection reset"));
      },
    }),
  );
  const h = harness([json(metadata), failed, new Response(localBytes)]);
  assert.deepEqual(
    await checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    metadata,
  );
  assert.deepEqual(h.sleeps, [1000]);
});

test("invalid retry policy is rejected before any request", () => {
  assert.throws(
    () => createRegistryClient({ budgetMs: 0 }),
    /Invalid registry/,
  );
  assert.throws(
    () => createRegistryClient({ backoffMs: [-1] }),
    /Invalid registry/,
  );
});

test("malformed tarball URLs are permanent metadata errors rather than network retries", async () => {
  const h = harness([
    json({
      ...metadata,
      dist: { ...metadata.dist, tarball: "not-an-absolute-url" },
    }),
  ]);
  await assert.rejects(
    checkRegistryPackage(h.client, registry, localBytes, {
      verifyTarball: true,
    }),
    TypeError,
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("default policy tolerates publication becoming available after four minutes eight seconds", async () => {
  let elapsed = 0,
    metadataCalls = 0,
    tarballCalls = 0;
  const waits: number[] = [];
  const client = createRegistryClient({
    now: () => elapsed,
    sleep: async (milliseconds: number) => {
      waits.push(milliseconds);
      elapsed += milliseconds;
    },
    fetch: async (url: string) => {
      if (url === registry) {
        metadataCalls++;
        return elapsed < 248000
          ? new Response(null, { status: 404 })
          : json(metadata);
      }
      tarballCalls++;
      return new Response(localBytes);
    },
  });
  assert.deepEqual(
    await checkRegistryPackage(client, registry, localBytes, {
      verifyTarball: true,
    }),
    metadata,
  );
  assert.equal(elapsed, 260000);
  assert.equal(metadataCalls, 14);
  assert.equal(tarballCalls, 1);
  assert.ok(waits.every((milliseconds) => milliseconds <= 30000));
});
