import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useProviderConfigStore } from "@/providers/config";
import { CanvasNodeType, type CanvasNodeData } from "../../types";
import { createCanvasNode } from "../../utils/canvas-node-config";
import { CanvasNodePromptPanel, providerOverrideIssue } from "../canvas-node-prompt-panel";

const baseNode: CanvasNodeData = {
    id: "image-1",
    type: CanvasNodeType.Image,
    title: "图片节点",
    position: { x: 0, y: 0 },
    width: 320,
    height: 320,
    providerOverride: { profileId: "profile-1", modelId: "gpt-image-1" },
    metadata: { prompt: "画一只猫" },
};

const renderPanel = (node: CanvasNodeData) =>
    renderToString(
        <QueryClientProvider client={new QueryClient()}>
            <CanvasNodePromptPanel
                node={node}
                isRunning={false}
                mentionReferences={[]}
                onPromptChange={() => undefined}
                onConfigChange={() => undefined}
                onProviderOverrideChange={() => undefined}
                onGenerate={() => undefined}
                onStop={() => undefined}
            />
        </QueryClientProvider>,
    );

beforeEach(() => {
    useProviderConfigStore.getState().resetProviderConfig();
});

test("creating image node snapshots global image default", () => {
    useProviderConfigStore.setState({
        defaults: { image: { profileId: "profile-1", modelId: "gpt-image-1" }, text: { profileId: "text-profile", modelId: "gpt-4.1" } },
    });

    const imageNode = createCanvasNode(CanvasNodeType.Image, { x: 160, y: 160 });
    const textNode = createCanvasNode(CanvasNodeType.Text, { x: 160, y: 160 });

    assert.deepEqual(imageNode.providerOverride, { profileId: "profile-1", modelId: "gpt-image-1" });
    assert.equal(textNode.providerOverride, undefined);
});

test("image provider override reports disabled profile", () => {
    assert.equal(
        providerOverrideIssue({ profileId: "profile-1", modelId: "gpt-image-1" }, [
            {
                id: "profile-1",
                name: "已禁用配置档",
                providerId: "openai-compat",
                enabled: false,
                models: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ]),
        "Profile 已禁用，请重选",
    );
});

test("image prompt panel shows deleted profile warning", () => {
    const html = renderPanel(baseNode);

    assert.match(html, /Profile 不存在/);
    assert.match(html, /disabled/);
});

test("image provider override clears warning when profile is enabled", () => {
    assert.equal(
        providerOverrideIssue({ profileId: "profile-1", modelId: "gpt-image-1" }, [
            {
                id: "profile-1",
                name: "可用配置档",
                providerId: "openai-compat",
                enabled: true,
                models: [],
                cachedModels: [{ id: "gpt-image-1", capability: "image" }],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ]),
        null,
    );
});