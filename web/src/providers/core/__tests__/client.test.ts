import assert from "node:assert/strict";
import { test } from "node:test";

import { createProviderClient } from "../client";
import { createProviderRegistry } from "../registry";
import { ProviderError, ProviderErrorCode, type GenerateRequest, type JsonObject, type ProviderAdapter, type ProviderFetch, type ProviderManifest } from "../types";

const manifest = {
    id: "mock",
    name: "Mock Provider",
    version: "0.1.0",
    responseMode: "sync",
    capabilities: ["text", "image"],
    models: [
        {
            id: "mock-text",
            capabilities: ["text"],
        },
        {
            id: "mock-image",
            capabilities: ["image"],
        },
    ],
} satisfies ProviderManifest;

const request: GenerateRequest<{ readonly prompt: string }> = {
    capability: "text",
    modelId: "mock-text",
    params: { prompt: "hello" },
    signal: undefined,
    pendingId: "pending-1",
};

test("calls a registered adapter with injected context", async () => {
    const registry = createProviderRegistry();
    const fetchMock: ProviderFetch = async () => new Response("ok");
    let receivedParams: JsonObject | undefined;

    const adapter: ProviderAdapter = {
        manifest,
        async generate(generateRequest, context) {
            receivedParams = generateRequest.params;
            assert.equal(context.fetch, fetchMock);
            assert.equal(context.responseMode, "sync");
            assert.equal(context.pendingId, "pending-1");
            return {
                providerId: manifest.id,
                capability: generateRequest.capability,
                modelId: generateRequest.modelId,
                outputs: [{ type: "text", text: String(generateRequest.params.prompt) }],
            };
        },
    };

    registry.register(adapter);
    const client = createProviderClient({ registry, context: { fetch: fetchMock } });

    const result = await client.generate("mock", request);

    assert.deepEqual(receivedParams, { prompt: "hello" });
    assert.equal(result.providerId, "mock");
    assert.deepEqual(result.outputs, [{ type: "text", text: "hello" }]);
});

test("throws ProviderError when provider is missing", async () => {
    const client = createProviderClient({ registry: createProviderRegistry() });

    await assert.rejects(
        () => client.generate("missing", request),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.ProviderNotFound,
    );
});

test("throws ProviderError when capability is not supported by the selected model", async () => {
    const registry = createProviderRegistry();
    registry.register({
        manifest,
        async generate() {
            throw new Error("should not call adapter");
        },
    });

    const client = createProviderClient({ registry });

    await assert.rejects(
        () => client.generate("mock", { ...request, capability: "image", modelId: "mock-text" }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.UnsupportedCapability,
    );
});

test("wraps adapter failures as ProviderError", async () => {
    const registry = createProviderRegistry();
    registry.register({
        manifest,
        async generate() {
            throw new Error("adapter failed");
        },
    });

    const client = createProviderClient({ registry });

    await assert.rejects(
        () => client.generate("mock", request),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.AdapterError,
    );
});

test("normalizes adapter abort errors as canceled ProviderError", async () => {
    const registry = createProviderRegistry();
    registry.register({
        manifest,
        async generate() {
            throw new DOMException("Aborted", "AbortError");
        },
    });

    const client = createProviderClient({ registry });

    await assert.rejects(
        () => client.generate("mock", request),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.Canceled,
    );
});