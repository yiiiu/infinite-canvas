import assert from "node:assert/strict";
import { test } from "node:test";

import { useProviderConfigStore } from "../../config";
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

test("generates image edit with reference images through ProviderClient", async () => {
    const calls: string[] = [];
    const fetchMock: ProviderFetch = async (url, init) => {
        calls.push(String(url));
        if (String(url) === "https://assets.example.test/ref.png") {
            return new Response(new Blob(["ref"], { type: "image/png" }), {
                status: 200,
                headers: { "content-type": "image/png" },
            });
        }
        assert.equal(String(url), "https://example.test/v1/images/edits");
        assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        const body = init?.body as FormData;
        assert.equal(body.get("model"), "gpt-image-custom");
        assert.equal(body.get("prompt"), "一只猫");
        assert.equal(body.getAll("image").length, 1);
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.test/out.png" }] }), {
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
            referenceImages: [{ url: "https://assets.example.test/ref.png" }],
        },
        signal: undefined,
    });

    assert.deepEqual(calls, ["https://assets.example.test/ref.png", "https://example.test/v1/images/edits"]);
    assert.deepEqual(result.outputs, [{ type: "image", url: "https://cdn.example.test/out.png" }]);
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
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.Unauthorized && error.message === "bad api key",
    );
});

test("lists OpenAI compatible models through ProviderClient", async () => {
    useProviderConfigStore.getState().resetProviderConfig();
    useProviderConfigStore.setState({
        profiles: {
            "profile-openai": {
                id: "profile-openai",
                name: "OpenAI Profile",
                providerId: "openai-compat",
                enabled: true,
                auth: { baseUrl: "https://example.test", apiKey: "test-key" },
                models: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
    });

    const fetchMock: ProviderFetch = async (url, init) => {
        assert.equal(String(url), "https://example.test/v1/models");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        return new Response(JSON.stringify({ data: [{ id: "gpt-image-1", object: "model" }, { id: "tts-1", name: "TTS 1" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const result = await createClient(fetchMock).listModels("openai-compat", "profile-openai");

    assert.equal(result.source, "remote");
    assert.deepEqual(result.models.map((item) => item.id), ["gpt-image-1", "tts-1"]);
    assert.equal(result.models[1]?.name, "TTS 1");
});

test("maps OpenAI compatible listModels 401 to Unauthorized ProviderError", async () => {
    useProviderConfigStore.getState().resetProviderConfig();
    useProviderConfigStore.setState({
        profiles: {
            "profile-openai": {
                id: "profile-openai",
                name: "OpenAI Profile",
                providerId: "openai-compat",
                enabled: true,
                auth: { baseUrl: "https://example.test", apiKey: "bad-key" },
                models: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
    });

    const fetchMock: ProviderFetch = async () =>
        new Response(JSON.stringify({ error: { message: "bad api key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
        });

    await assert.rejects(
        () => createClient(fetchMock).listModels("openai-compat", "profile-openai"),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.Unauthorized && error.message === "bad api key",
    );
});

test("maps OpenAI compatible listModels network failures to NetworkError", async () => {
    useProviderConfigStore.getState().resetProviderConfig();
    useProviderConfigStore.setState({
        profiles: {
            "profile-openai": {
                id: "profile-openai",
                name: "OpenAI Profile",
                providerId: "openai-compat",
                enabled: true,
                auth: { baseUrl: "https://example.test", apiKey: "test-key" },
                models: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
    });

    const fetchMock: ProviderFetch = async () => {
        throw new Error("fetch failed");
    };

    await assert.rejects(
        () => createClient(fetchMock).listModels("openai-compat", "profile-openai"),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.NetworkError && error.message === "fetch failed",
    );
});
