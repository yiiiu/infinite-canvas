import assert from "node:assert/strict";
import { test } from "node:test";

import type { AdapterContext, GenerateRequest, ProviderFetch } from "../../core/types";
import { volcengineAdapter } from "../adapter";

test("reads Seedance video URL from content.video_url", async () => {
    const videoUrl = "https://ark-content-generation-cn-beijing.example/video.mp4";
    const calls: string[] = [];
    const fetchMock: ProviderFetch = async (url, init) => {
        calls.push(String(url));
        if (String(url).endsWith("/contents/generations/tasks")) {
            assert.equal(init?.method, "POST");
            return new Response(JSON.stringify({ id: "task-1" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (String(url).endsWith("/contents/generations/tasks/task-1")) {
            return new Response(JSON.stringify({ id: "task-1", status: "succeeded", content: { video_url: videoUrl } }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        assert.equal(String(url), videoUrl);
        return new Response(new Blob(["video"], { type: "video/mp4" }), {
            status: 200,
            headers: { "content-type": "video/mp4" },
        });
    };
    const context: AdapterContext = {
        fetch: fetchMock,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        responseMode: "async-pollable",
    };
    const request: GenerateRequest = {
        capability: "video",
        modelId: "doubao-seedance-1-5-pro-250115",
        params: {
            baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            apiKey: "test-key",
            model: "doubao-seedance-1-5-pro-250115",
            prompt: "test video",
            videoSeconds: 6,
        },
        signal: undefined,
    };

    const result = await volcengineAdapter.generate(request, context);

    assert.deepEqual(calls, [
        "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-1",
        videoUrl,
    ]);
    const output = result.outputs[0];
    assert.equal(output?.type, "video");
    if (output?.type !== "video") throw new Error("expected video output");
    assert.equal(output.mimeType, "video/mp4");
});
