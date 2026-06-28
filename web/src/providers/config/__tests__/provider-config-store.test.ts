import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { collectManifestErrors } from "../../core/manifest-loader";
import { resetProfileModelListLoaderForTests, setProfileModelListLoaderForTests, useProviderConfigStore } from "../use-provider-config-store";

beforeEach(() => {
    resetProfileModelListLoaderForTests();
    useProviderConfigStore.getState().resetProviderConfig();
});

test("creates, updates and keeps provider profile in store", () => {
    const created = useProviderConfigStore.getState().createProfile({
        name: "OpenAI Compatible 1",
        providerId: "openai-compat",
        auth: { baseUrl: "https://api.example.com", apiKey: "key-1" },
        baseUrl: "https://api.example.com",
        apiKey: "key-1",
    });

    assert.equal(useProviderConfigStore.getState().mode, "legacy");
    assert.equal(useProviderConfigStore.getState().profiles[created.id].name, "OpenAI Compatible 1");
    assert.equal(useProviderConfigStore.getState().profiles[created.id].enabled, true);

    useProviderConfigStore.getState().updateProfile(created.id, { name: "Custom OpenAI", auth: { baseUrl: "https://api.example.com", apiKey: "key-2" }, apiKey: "key-2" });

    assert.equal(useProviderConfigStore.getState().profiles[created.id].name, "Custom OpenAI");
    assert.equal(useProviderConfigStore.getState().profiles[created.id].apiKey, "key-2");
});

test("returns null when default profile is disabled", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "GRSAI 1", providerId: "grsai", auth: { apiKey: "key" }, apiKey: "key" });

    useProviderConfigStore.getState().setDefaultSelection("image", { profileId: profile.id, modelId: "nano-banana" });
    assert.deepEqual(useProviderConfigStore.getState().getEffectiveDefault("image"), { profileId: profile.id, modelId: "nano-banana" });

    useProviderConfigStore.getState().setProfileEnabled(profile.id, false);
    assert.equal(useProviderConfigStore.getState().getEffectiveDefault("image"), null);
});

test("setDefault writes and clears defaults without changing legacy mode", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });

    useProviderConfigStore.getState().setDefault("text", { profileId: profile.id, modelId: "gpt-4.1" });
    useProviderConfigStore.getState().setDefault("image", { profileId: profile.id, modelId: "gpt-image-1" });
    useProviderConfigStore.getState().setDefault("video", { profileId: profile.id, modelId: "sora" });
    useProviderConfigStore.getState().setDefault("audio", { profileId: profile.id, modelId: "gpt-4o-mini-tts" });

    assert.equal(useProviderConfigStore.getState().mode, "legacy");
    assert.deepEqual(useProviderConfigStore.getState().getEffectiveDefault("image"), { profileId: profile.id, modelId: "gpt-image-1" });

    useProviderConfigStore.getState().setDefault("image", null);
    assert.equal(useProviderConfigStore.getState().mode, "legacy");
    assert.equal(useProviderConfigStore.getState().getEffectiveDefault("image"), null);
});

test("setDefault does not change an existing profiles mode", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });

    useProviderConfigStore.getState().setMode("profiles");
    useProviderConfigStore.getState().setDefault("audio", { profileId: profile.id, modelId: "gpt-4o-mini-tts" });
    useProviderConfigStore.getState().setDefault("audio", null);

    assert.equal(useProviderConfigStore.getState().mode, "profiles");
    assert.equal(useProviderConfigStore.getState().getEffectiveDefault("audio"), null);
});

test("refreshProfileModels stores model cache and clears previous error", async () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });
    useProviderConfigStore.getState().updateProfile(profile.id, { modelsFetchError: "旧错误" });
    setProfileModelListLoaderForTests(async (providerId, profileId) => {
        assert.equal(providerId, "openai-compat");
        assert.equal(profileId, profile.id);
        return { source: "remote", models: [{ id: "gpt-4.1", name: "GPT 4.1" }, { id: "gpt-image-1" }] };
    });

    await useProviderConfigStore.getState().refreshProfileModels(profile.id);

    const stored = useProviderConfigStore.getState().profiles[profile.id];
    assert.deepEqual(stored.cachedModels, [{ id: "gpt-4.1", name: "GPT 4.1" }, { id: "gpt-image-1" }]);
    assert.equal(typeof stored.modelsFetchedAt, "number");
    assert.equal(stored.modelsFetchError, undefined);
    assert.deepEqual(useProviderConfigStore.getState().getProfileModels(profile.id).models, stored.cachedModels);
});

test("mergeProfileModels appends new model ids without reordering existing ids", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", models: ["gpt-4o", "GPT-4o"] });

    const result = useProviderConfigStore.getState().mergeProfileModels(profile.id, ["GPT-4o", "gpt-image-1", "gpt-4o", "sora"]);

    assert.deepEqual(result, { total: 4, added: 2 });
    assert.deepEqual(useProviderConfigStore.getState().profiles[profile.id].models, ["gpt-4o", "GPT-4o", "gpt-image-1", "sora"]);
});

test("refreshProfileModels keeps old cache when loading fails", async () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });
    useProviderConfigStore.getState().updateProfile(profile.id, { cachedModels: [{ id: "cached-model" }], modelsFetchedAt: 123 });
    setProfileModelListLoaderForTests(async () => {
        throw new Error("上游不可用");
    });

    await useProviderConfigStore.getState().refreshProfileModels(profile.id);

    const stored = useProviderConfigStore.getState().profiles[profile.id];
    assert.deepEqual(stored.cachedModels, [{ id: "cached-model" }]);
    assert.equal(stored.modelsFetchedAt, 123);
    assert.equal(stored.modelsFetchError, "上游不可用");
});

test("refreshProfileModels ignores canceled loading without changing cache state", async () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });
    useProviderConfigStore.getState().updateProfile(profile.id, { cachedModels: [{ id: "cached-model" }], modelsFetchedAt: 123, modelsFetchError: "旧错误" });
    setProfileModelListLoaderForTests(async () => {
        throw new DOMException("Aborted", "AbortError");
    });

    await useProviderConfigStore.getState().refreshProfileModels(profile.id);

    const stored = useProviderConfigStore.getState().profiles[profile.id];
    assert.deepEqual(stored.cachedModels, [{ id: "cached-model" }]);
    assert.equal(stored.modelsFetchedAt, 123);
    assert.equal(stored.modelsFetchError, "旧错误");
});

test("refreshProfileModels ignores missing profile", async () => {
    let called = false;
    setProfileModelListLoaderForTests(async () => {
        called = true;
        return { source: "remote", models: [] };
    });

    await useProviderConfigStore.getState().refreshProfileModels("missing-profile");

    assert.equal(called, false);
    assert.deepEqual(useProviderConfigStore.getState().profiles, {});
});

test("recordModelUsage creates and increments recent model usage", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });

    useProviderConfigStore.getState().recordModelUsage(profile.id, "gpt-4.1");
    useProviderConfigStore.getState().recordModelUsage(profile.id, "gpt-image-1");
    useProviderConfigStore.getState().recordModelUsage(profile.id, "gpt-4.1");

    assert.deepEqual(
        useProviderConfigStore.getState().profiles[profile.id].recentlyUsedModels?.map((item) => ({ modelId: item.modelId, count: item.count })),
        [
            { modelId: "gpt-4.1", count: 2 },
            { modelId: "gpt-image-1", count: 1 },
        ],
    );
});

test("recordModelUsage keeps only top 20 models by count", () => {
    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });

    for (let index = 0; index < 25; index += 1) {
        useProviderConfigStore.getState().recordModelUsage(profile.id, `model-${index}`);
    }
    useProviderConfigStore.getState().recordModelUsage(profile.id, "model-0");

    const usage = useProviderConfigStore.getState().profiles[profile.id].recentlyUsedModels || [];
    assert.equal(usage.length, 20);
    assert.equal(usage[0].modelId, "model-0");
    assert.equal(usage[0].count, 2);
    assert.equal(usage.every((item) => item.modelId === "model-0" || item.count === 1), true);
});

test("recordModelUsage ignores missing profile or blank model", () => {
    useProviderConfigStore.getState().recordModelUsage("missing", "gpt-4.1");
    assert.deepEqual(useProviderConfigStore.getState().profiles, {});

    const profile = useProviderConfigStore.getState().createProfile({ name: "OpenAI Compatible 1", providerId: "openai-compat", auth: { baseUrl: "https://api.example.com", apiKey: "key" }, baseUrl: "https://api.example.com", apiKey: "key" });
    useProviderConfigStore.getState().recordModelUsage(profile.id, "  ");
    assert.equal(useProviderConfigStore.getState().profiles[profile.id].recentlyUsedModels, undefined);
});

test("validates provider manifest auth fields", () => {
    const errors = collectManifestErrors({
        id: "test",
        name: "Test",
        version: "0.1.0",
        responseMode: "sync",
        capabilities: ["image"],
        allowsCustomModels: true,
        models: [],
        auth: {
            fields: [{ key: "apiKey", type: "password", label: "API Key", required: true }],
        },
    });

    assert.deepEqual(errors, []);

    const badErrors = collectManifestErrors({
        id: "test",
        name: "Test",
        version: "0.1.0",
        responseMode: "sync",
        capabilities: ["image"],
        allowsCustomModels: true,
        models: [],
        auth: {
            fields: [{ key: "apiKey", type: "secret", label: "API Key" }],
        },
    });

    assert.equal(badErrors.some((error) => error.path === "auth.fields.0.type"), true);
});