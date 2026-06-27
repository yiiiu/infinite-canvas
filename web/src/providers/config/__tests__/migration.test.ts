import assert from "node:assert/strict";
import { test } from "node:test";

import { migrateAiConfigToProviderConfig, resolveLegacyModelSelection } from "../migration";
import type { ProviderConfigData } from "../types";

const emptyConfig: ProviderConfigData = {
    migrationVersion: 0,
    mode: "legacy",
    profiles: {},
    defaults: {},
};

test("migrates legacy channels into provider profiles and defaults", () => {
    const result = migrateAiConfigToProviderConfig(
        {
            channels: [
                { id: "default", name: "默认渠道", baseUrl: "https://api.openai.com", apiKey: "key-1", apiFormat: "openai", models: ["gpt-image-2", "gpt-5.5", "grok-imagine-video"] },
                { id: "grsai", name: "GRSAI", baseUrl: "https://api.grsai.test", apiKey: "key-2", apiFormat: "openai", models: ["nano-banana"] },
            ],
            imageModel: "grsai::nano-banana",
            videoModel: "default::grok-imagine-video",
            textModel: "default::gpt-5.5",
            audioModel: "",
        },
        emptyConfig,
        new Date("2026-01-01T00:00:00.000Z"),
    );

    assert.equal(result.migrationVersion, 2);
    assert.equal(result.mode, "legacy");
    assert.equal(result.profiles["legacy-default"].providerId, "openai-compat");
    assert.equal(result.profiles["legacy-grsai"].providerId, "grsai");
    assert.deepEqual(result.defaults.image, { profileId: "legacy-grsai", modelId: "nano-banana" });
    assert.deepEqual(result.defaults.video, { profileId: "legacy-default", modelId: "grok-imagine-video" });
    assert.deepEqual(result.defaults.text, { profileId: "legacy-default", modelId: "gpt-5.5" });
    assert.equal(result.defaults.audio, undefined);
});

test("leaves inaccurate or blank defaults undefined", () => {
    const result = migrateAiConfigToProviderConfig(
        {
            channels: [{ id: "default", name: "默认渠道", baseUrl: "https://api.openai.com", apiKey: "", apiFormat: "openai", models: ["gpt-image-2"] }],
            imageModel: "",
            videoModel: "unknown-video",
            model: "",
        },
        emptyConfig,
    );

    assert.equal(result.defaults.image, undefined);
    assert.equal(result.defaults.video, undefined);
    assert.equal(result.defaults.text, undefined);
    assert.equal(result.defaults.audio, undefined);
});

test("does not use audioVoice as audio model fallback", () => {
    const result = migrateAiConfigToProviderConfig(
        {
            channels: [{ id: "default", name: "默认渠道", baseUrl: "https://api.openai.com", apiKey: "", apiFormat: "openai", models: ["gpt-4o-mini-tts"] }],
        },
        emptyConfig,
    );

    assert.equal(result.defaults.audio, undefined);
});

test("maps raw legacy model only when it matches exactly one channel", () => {
    const channels = [
        { id: "a", name: "A", baseUrl: "https://a.test", apiKey: "", apiFormat: "openai" as const, models: ["shared", "unique-a"] },
        { id: "b", name: "B", baseUrl: "https://b.test", apiKey: "", apiFormat: "openai" as const, models: ["shared"] },
    ];

    assert.deepEqual(resolveLegacyModelSelection("unique-a", channels), { profileId: "legacy-a", modelId: "unique-a" });
    assert.equal(resolveLegacyModelSelection("shared", channels), undefined);
    assert.equal(resolveLegacyModelSelection("missing", channels), undefined);
});

test("reshapes version 1 provider config without recreating profiles", () => {
    const current: ProviderConfigData = {
        migrationVersion: 1,
        mode: "profiles",
        profiles: {
            existing: {
                id: "existing",
                name: "Existing",
                providerId: "openai-compat",
                models: [],
                recentlyUsedModels: ["gpt-4.1", "gpt-image-1"] as unknown as never,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        },
        defaults: {},
    };

    const result = migrateAiConfigToProviderConfig(
        {
            channels: [{ id: "default", name: "默认渠道", baseUrl: "https://api.openai.com", apiKey: "", apiFormat: "openai", models: ["gpt-image-2"] }],
            imageModel: "default::gpt-image-2",
        },
        current,
    );

    assert.equal(result.migrationVersion, 2);
    assert.deepEqual(Object.keys(result.profiles), ["existing"]);
    assert.deepEqual(result.profiles.existing.recentlyUsedModels, [
        { modelId: "gpt-4.1", count: 1, lastUsedAt: 0 },
        { modelId: "gpt-image-1", count: 1, lastUsedAt: 0 },
    ]);
});

test("treats missing migrationVersion as not migrated", () => {
    const result = migrateAiConfigToProviderConfig(
        {
            channels: [{ id: "default", name: "默认渠道", baseUrl: "https://api.openai.com", apiKey: "", apiFormat: "openai", models: ["gpt-image-2"] }],
            imageModel: "default::gpt-image-2",
        },
        { mode: "legacy", profiles: {}, defaults: {} },
    );

    assert.equal(result.migrationVersion, 2);
    assert.deepEqual(result.defaults.image, { profileId: "legacy-default", modelId: "gpt-image-2" });
});

test("leaves providerId undefined when legacy channel has no registered provider mapping", () => {
    const result = migrateAiConfigToProviderConfig(
        {
            channels: [{ id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "", apiFormat: "gemini", models: ["gemini-2.5-pro"] }],
            textModel: "gemini::gemini-2.5-pro",
        },
        emptyConfig,
    );

    assert.equal(result.profiles["legacy-gemini"].providerId, undefined);
    assert.deepEqual(result.defaults.text, { profileId: "legacy-gemini", modelId: "gemini-2.5-pro" });
});