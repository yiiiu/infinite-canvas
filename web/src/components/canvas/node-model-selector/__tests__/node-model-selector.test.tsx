import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { NodeModelSelector } from "../index";
import type { ProviderProfile } from "@/providers/config";

const profiles: ProviderProfile[] = [
    {
        id: "profile-1",
        name: "可用配置档",
        providerId: "openai-compat",
        enabled: true,
        models: [],
        cachedModels: [
            { id: "gpt-image-1", capability: "image" },
            { id: "gpt-4.1", capability: "text" },
        ],
        recentlyUsedModels: [{ modelId: "gpt-image-1", count: 3, lastUsedAt: 10 }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
        id: "profile-disabled",
        name: "禁用配置档",
        providerId: "openai-compat",
        enabled: false,
        models: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
];

test("NodeModelSelector can render independently", () => {
    const html = renderToString(<NodeModelSelector capability="image" profiles={profiles} value={null} onChange={() => undefined} compact />);

    assert.match(html, /请选择/);
    assert.doesNotThrow(() => renderToString(<NodeModelSelector capability="text" profiles={profiles} value={{ profileId: "profile-1", modelId: "gpt-4.1" }} onChange={() => undefined} />));
});