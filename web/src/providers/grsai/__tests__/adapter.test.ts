import assert from "node:assert/strict";
import { test } from "node:test";

import { createProviderClient } from "../../core/client";
import { createProviderRegistry } from "../../core/registry";
import { ProviderError, ProviderErrorCode, type ProviderFetch } from "../../core/types";
import { grsaiAdapter } from "../adapter";

function createClient(fetchMock: ProviderFetch) {
    const registry = createProviderRegistry();
    registry.register(grsaiAdapter);
    return createProviderClient({ registry, context: { fetch: fetchMock } });
}

test("generates text-to-image through GrsAI completions endpoint", async () => {
    const fetchMock: ProviderFetch = async (url, init) => {
        assert.equal(String(url), "https://grsai.example.test/v1/draw/completions");
        assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            model: "gpt-image-2",
            prompt: "一只猫",
            urls: [],
            shutProgress: true,
            cdn: "zh",
            size: "1024x1024",
            variants: 2,
        });
        return new Response(JSON.stringify({ status: "succeeded", results: [{ url: "https://cdn.example.test/a.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const result = await createClient(fetchMock).generate("grsai", {
        capability: "image",
        modelId: "gpt-image-2",
        params: {
            baseUrl: "https://grsai.example.test",
            apiKey: "test-key",
            prompt: "一只猫",
            size: "1024x1024",
            count: 2,
        },
        signal: undefined,
    });

    assert.equal(result.providerId, "grsai");
    assert.equal(result.modelId, "gpt-image-2");
    assert.deepEqual(result.outputs, [{ type: "image", url: "https://cdn.example.test/a.png" }]);
});

test("generates image-to-image through GrsAI nano-banana endpoint", async () => {
    const fetchMock: ProviderFetch = async (url, init) => {
        assert.equal(String(url), "https://grsai.example.test/v1/draw/nano-banana");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            model: "nano-banana-fast",
            prompt: "把参考图改成赛博朋克风格",
            urls: ["https://assets.example.test/ref.png"],
            shutProgress: true,
            cdn: "zh",
            imageSize: "1K",
            aspectRatio: "1:1",
        });
        return new Response(JSON.stringify({ url: "https://cdn.example.test/b.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const result = await createClient(fetchMock).generate("grsai", {
        capability: "image",
        modelId: "nano-banana-fast",
        params: {
            baseUrl: "https://grsai.example.test/v1",
            apiKey: "test-key",
            prompt: "把参考图改成赛博朋克风格",
            size: "1K",
            aspectRatio: "1:1",
            referenceImages: [{ url: "https://assets.example.test/ref.png" }],
        },
        signal: undefined,
    });

    assert.deepEqual(result.outputs, [{ type: "image", url: "https://cdn.example.test/b.png" }]);
});

test("maps GrsAI error response to ProviderError", async () => {
    const fetchMock: ProviderFetch = async () =>
        new Response(JSON.stringify({ msg: "请求频率过高，请稍后重试" }), {
            status: 429,
            headers: { "content-type": "application/json" },
        });

    await assert.rejects(
        () =>
            createClient(fetchMock).generate("grsai", {
                capability: "image",
                modelId: "gpt-image-2",
                params: {
                    baseUrl: "https://grsai.example.test",
                    apiKey: "test-key",
                    prompt: "一只猫",
                },
                signal: undefined,
            }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.RateLimited,
    );
});