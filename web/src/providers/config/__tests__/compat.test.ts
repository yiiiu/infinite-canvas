import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { AiConfig } from "@/stores/use-config-store";
import { aiConfigToProviderRequest } from "../../openai-compat/config-bridge";
import { ProviderError, ProviderErrorCode } from "../../core/types";
import { resolveProviderRequestConfig } from "../compat";
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

test("keeps legacy config active until profile mode is enabled", () => {
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

    assert.equal(result.baseUrl, "https://legacy.test");
    assert.equal(result.apiKey, "legacy-key");
    assert.equal(result.model, "legacy-image");
    assert.equal(result.providerId, undefined);
});

test("uses provider profile only after profile mode is enabled", () => {
    useProviderConfigStore.setState({
        mode: "profiles",
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