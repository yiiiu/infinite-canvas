import assert from "node:assert/strict";
import { test } from "node:test";

import { createProviderRegistry } from "../registry";
import { ProviderError, ProviderErrorCode, type ProviderAdapter, type ProviderManifest } from "../types";

const manifest = {
    id: "mock",
    name: "Mock Provider",
    version: "0.1.0",
    responseMode: "sync",
    capabilities: ["text"],
    models: [
        {
            id: "mock-text",
            name: "Mock Text",
            capabilities: ["text"],
        },
    ],
    parameterSchemas: {
        text: {
            type: "object",
            properties: {
                prompt: { type: "string" },
            },
            required: ["prompt"],
        },
    },
} satisfies ProviderManifest;

function createMockAdapter(id = manifest.id): ProviderAdapter {
    return {
        manifest: { ...manifest, id },
        async generate(request) {
            return {
                providerId: id,
                capability: request.capability,
                modelId: request.modelId,
                outputs: [{ type: "text", text: "ok" }],
            };
        },
    };
}

test("registers, finds, lists and clears providers", () => {
    const registry = createProviderRegistry();
    const adapter = createMockAdapter();

    registry.register(adapter);

    assert.equal(registry.has("mock"), true);
    assert.equal(registry.get("mock"), adapter);
    assert.deepEqual(registry.list(), [adapter]);

    registry.clear();
    assert.equal(registry.has("mock"), false);
    assert.deepEqual(registry.list(), []);
});

test("rejects duplicate provider ids", () => {
    const registry = createProviderRegistry();
    registry.register(createMockAdapter());

    assert.throws(
        () => registry.register(createMockAdapter()),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.DuplicateProvider,
    );
});

test("rejects invalid manifests", () => {
    const registry = createProviderRegistry();
    const invalidAdapter = {
        ...createMockAdapter(),
        manifest: { ...manifest, id: "" },
    } as ProviderAdapter;

    assert.throws(
        () => registry.register(invalidAdapter),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.InvalidManifest,
    );
});