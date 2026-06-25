import assert from "node:assert/strict";
import { test } from "node:test";

import { createProviderClient } from "../../core/client";
import { createProviderRegistry } from "../../core/registry";
import { ProviderError, ProviderErrorCode, type ProviderFetch } from "../../core/types";
import { openAICompatAdapter } from "../adapter";

function createClient(fetchMock: ProviderFetch) {
    const registry = createProviderRegistry();
    registry.register(openAICompatAdapter);
    return createProviderClient({ registry, context: { fetch: fetchMock } });
}

test("generates image through ProviderClient with custom model and ctx.fetch", async () => {
    const calls: Array<{ readonly url: string | URL; readonly init?: RequestInit }> = [];
    const fetchMock: ProviderFetch = async (url, init) => {
        calls.push({ url, init });
        assert.equal(String(url), "https://example.test/v1/images/generations");
        assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            model: "gpt-image-custom",
            prompt: "一只猫",
        });
        return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const result = await createClient(fetchMock).generate("openai-compat", {
        capability: "image",
        modelId: "gpt-image-custom",
        params: {
            baseUrl: "https://example.test",
            apiKey: "test-key",
            prompt: "一只猫",
        },
        signal: undefined,
    });

    assert.equal(calls.length, 1);
    assert.equal(result.providerId, "openai-compat");
    assert.equal(result.modelId, "gpt-image-custom");
    assert.deepEqual(result.outputs, [{ type: "image", dataUrl: "data:image/png;base64,aW1hZ2U=", mimeType: "image/png" }]);
});

test("normalizes image generation errors as ProviderError", async () => {
    const fetchMock: ProviderFetch = async () =>
        new Response(JSON.stringify({ error: { message: "bad api key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
        });

    await assert.rejects(
        () =>
            createClient(fetchMock).generate("openai-compat", {
                capability: "image",
                modelId: "gpt-image-custom",
                params: {
                    baseUrl: "https://example.test/v1",
                    apiKey: "bad-key",
                    prompt: "一只猫",
                },
                signal: undefined,
            }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.NetworkError && error.message === "bad api key",
    );
});