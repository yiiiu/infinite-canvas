import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { AiConfig } from "@/stores/use-config-store";
import { aiConfigToProviderRequest } from "../../openai-compat/config-bridge";
import { ProviderError, ProviderErrorCode } from "../../core/types";
import { resolveProviderRequestConfig, resolveProviderRouting } from "../compat";
import { useProviderConfigStore } from "../use-provider-config-store";

const config: AiConfig = {
    channelMode: "local",
    baseUrl: "https://legacy.test",
    apiKey: "legacy-key",
    apiFormat: "openai",
    channels: [{ id: "default", name: "默认渠道", baseUrl: "https://legacy.test", apiKey: "legacy-key", apiFormat: "openai", models: ["legacy-image"] }],
    model: "default::legacy-image",
    imageModel: "default::legacy-image",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: ["default::legacy-image"],
    imageModels: ["default::legacy-image"],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "3",
};

beforeEach(() => {
    useProviderConfigStore.getState().resetProviderConfig();
});

test("uses global default without relying on profile mode", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            profile1: {
                id: "profile1",
                name: "Profile 1",
                providerId: "openai-compat",
                baseUrl: "https://profile.test",
                apiKey: "profile-key",
                apiFormat: "openai",
                models: ["profile-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "profile1", modelId: "profile-image" } },
    });

    const result = resolveProviderRequestConfig(config, config.imageModel, "image");

    assert.equal(result.profileId, "profile1");
    assert.equal(result.providerId, "openai-compat");
    assert.equal(result.baseUrl, "https://profile.test");
    assert.equal(result.apiKey, "profile-key");
    assert.equal(result.model, "profile-image");
});

test("node override wins over global default", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            global: {
                id: "global",
                name: "Global Profile",
                providerId: "openai-compat",
                baseUrl: "https://global.test",
                apiKey: "global-key",
                apiFormat: "openai",
                models: ["global-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            node: {
                id: "node",
                name: "Node Profile",
                providerId: "openai-compat",
                baseUrl: "https://node.test",
                apiKey: "node-key",
                apiFormat: "openai",
                models: ["node-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "global", modelId: "global-image" } },
    });

    const result = resolveProviderRequestConfig(config, config.imageModel, "image", { providerOverride: { profileId: "node", modelId: "node-image" } });

    assert.equal(result.profileId, "node");
    assert.equal(result.providerId, "openai-compat");
    assert.equal(result.baseUrl, "https://node.test");
    assert.equal(result.apiKey, "node-key");
    assert.equal(result.model, "node-image");
});

test("falls back to legacy when capability has no default or override", () => {
    useProviderConfigStore.setState({ mode: "legacy", profiles: {}, defaults: {} });

    const result = resolveProviderRequestConfig(config, config.imageModel, "image");

    assert.equal(result.baseUrl, "https://legacy.test");
    assert.equal(result.apiKey, "legacy-key");
    assert.equal(result.model, "legacy-image");
    assert.equal(result.providerId, undefined);
    assert.deepEqual(resolveProviderRouting("image"), { type: "legacy" });
});

test("throws clear error when node override profile is disabled or deleted", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            disabled: {
                id: "disabled",
                name: "Disabled Profile",
                providerId: "openai-compat",
                enabled: false,
                baseUrl: "https://disabled.test",
                apiKey: "disabled-key",
                apiFormat: "openai",
                models: ["disabled-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: {},
    });

    assert.throws(
        () => resolveProviderRequestConfig(config, config.imageModel, "image", { providerOverride: { profileId: "disabled", modelId: "disabled-image" } }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.InvalidRequest && error.message === "节点指定的 Profile 已被禁用/删除，请重新选择",
    );
    assert.throws(
        () => resolveProviderRequestConfig(config, config.imageModel, "image", { providerOverride: { profileId: "deleted", modelId: "deleted-image" } }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.InvalidRequest && error.message === "节点指定的 Profile 已被禁用/删除，请重新选择",
    );
});

test("throws clear error when global default profile is disabled or deleted", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            disabled: {
                id: "disabled",
                name: "Disabled Profile",
                providerId: "openai-compat",
                enabled: false,
                baseUrl: "https://disabled.test",
                apiKey: "disabled-key",
                apiFormat: "openai",
                models: ["disabled-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "disabled", modelId: "disabled-image" } },
    });

    assert.throws(
        () => resolveProviderRequestConfig(config, config.imageModel, "image"),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.InvalidRequest && error.message === "默认模型指定的 Profile 已被禁用/删除，请重新配置",
    );
});

test("marks profiles without providerId as needing explicit configuration", () => {
    useProviderConfigStore.setState({
        mode: "profiles",
        profiles: {
            gemini: {
                id: "gemini",
                name: "Gemini",
                baseUrl: "https://generativelanguage.googleapis.com",
                apiKey: "gemini-key",
                apiFormat: "gemini",
                models: ["gemini-2.5-pro"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { text: { profileId: "gemini", modelId: "gemini-2.5-pro" } },
    });

    const result = resolveProviderRequestConfig(config, config.model, "text");

    assert.equal(result.profileId, "gemini");
    assert.equal(result.providerId, undefined);
    assert.equal(result.needsProviderConfiguration, true);
    assert.equal(result.baseUrl, "https://legacy.test");
});

test("uses manifest auth requirements for runnable profiles", () => {
    useProviderConfigStore.setState({
        mode: "profiles",
        profiles: {
            grsai: {
                id: "grsai",
                name: "GRSAI",
                providerId: "grsai",
                auth: { apiKey: "grsai-key" },
                apiKey: "grsai-key",
                models: ["nano-banana"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "grsai", modelId: "nano-banana" } },
    });

    const result = resolveProviderRequestConfig(config, config.imageModel, "image");

    assert.equal(result.profileId, "grsai");
    assert.equal(result.providerId, "grsai");
    assert.equal(result.apiKey, "grsai-key");
    assert.equal(result.needsProviderConfiguration, undefined);
});

test("grsai profile uses its custom baseUrl instead of legacy OpenAI-compatible config", () => {
    useProviderConfigStore.setState({
        mode: "profiles",
        profiles: {
            grsai: {
                id: "grsai",
                name: "GRSAI",
                providerId: "grsai",
                auth: { apiKey: "grsai-key", baseUrl: "https://grsai.example/v1" },
                models: ["nano-banana"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "grsai", modelId: "nano-banana" } },
    });

    const result = resolveProviderRequestConfig(config, config.imageModel, "image");

    assert.equal(result.profileId, "grsai");
    assert.equal(result.providerId, "grsai");
    assert.equal(result.baseUrl, "https://grsai.example/v1");
    assert.equal(result.apiKey, "grsai-key");
    assert.equal(result.model, "nano-banana");
});

test("grsai profile without baseUrl does not inherit legacy OpenAI-compatible baseUrl", () => {
    const openAiLegacyConfig: AiConfig = {
        ...config,
        baseUrl: "https://api.openai.com/v1",
        channels: [{ id: "default", name: "默认渠道", baseUrl: "https://api.openai.com/v1", apiKey: "legacy-openai-key", apiFormat: "openai", models: ["legacy-image"] }],
    };

    useProviderConfigStore.setState({
        mode: "profiles",
        profiles: {
            grsai: {
                id: "grsai",
                name: "GRSAI",
                providerId: "grsai",
                auth: { apiKey: "grsai-key" },
                models: ["nano-banana"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "grsai", modelId: "nano-banana" } },
    });

    const result = resolveProviderRequestConfig(openAiLegacyConfig, openAiLegacyConfig.imageModel, "image");

    assert.equal(result.profileId, "grsai");
    assert.equal(result.providerId, "grsai");
    assert.equal(result.baseUrl, "");
    assert.equal(result.apiKey, "grsai-key");
    assert.equal(result.model, "nano-banana");
});

test("provider request uses node override profile and model over global default", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            global: {
                id: "global",
                name: "Global Profile",
                providerId: "openai-compat",
                baseUrl: "https://global.test",
                apiKey: "global-key",
                apiFormat: "openai",
                models: ["global-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            node: {
                id: "node",
                name: "Node Profile",
                providerId: "openai-compat",
                baseUrl: "https://node.test",
                apiKey: "node-key",
                apiFormat: "openai",
                models: ["node-image"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "global", modelId: "global-image" } },
    });

    const request = aiConfigToProviderRequest(config, "image", { prompt: "hello" }, { providerOverride: { profileId: "node", modelId: "node-image" } });

    assert.equal(request.profileId, "node");
    assert.equal(request.providerId, "openai-compat");
    assert.equal(request.modelId, "node-image");
    assert.equal(request.params.model, "node-image");
    assert.equal(request.params.baseUrl, "https://node.test");
    assert.equal(request.params.apiKey, "node-key");
});

test("video provider request uses node override model over legacy default", () => {
    useProviderConfigStore.setState({
        mode: "legacy",
        profiles: {
            volcengine: {
                id: "volcengine",
                name: "火山方舟",
                providerId: "volcengine",
                baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
                apiKey: "volc-key",
                apiFormat: "openai",
                models: ["seedance-2-0-pro-250528"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { video: { profileId: "volcengine", modelId: "seedance-2-0-pro-250528" } },
    });

    const request = aiConfigToProviderRequest({ ...config, videoModel: "default::grok-imagine-video", model: "default::grok-imagine-video" }, "video", { prompt: "hello" }, { providerOverride: { profileId: "volcengine", modelId: "seedance-2-0-pro-250528" } });

    assert.equal(request.providerId, "volcengine");
    assert.equal(request.modelId, "seedance-2-0-pro-250528");
    assert.equal(request.params.model, "seedance-2-0-pro-250528");
    assert.equal(request.params.baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
});

test("blocks provider requests when profile mode default is incomplete", () => {
    useProviderConfigStore.setState({
        mode: "profiles",
        profiles: {
            gemini: {
                id: "gemini",
                name: "Gemini",
                baseUrl: "https://generativelanguage.googleapis.com",
                apiKey: "gemini-key",
                apiFormat: "gemini",
                models: ["gemini-2.5-pro"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: { image: { profileId: "gemini", modelId: "gemini-2.5-pro" } },
    });

    assert.throws(
        () => aiConfigToProviderRequest(config, "image", { prompt: "hello" }),
        (error) => error instanceof ProviderError && error.code === ProviderErrorCode.InvalidRequest && error.message === "请先完成 Provider 配置",
    );
});
