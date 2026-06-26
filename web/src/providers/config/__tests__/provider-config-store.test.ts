import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { collectManifestErrors } from "../../core/manifest-loader";
import { useProviderConfigStore } from "../use-provider-config-store";

beforeEach(() => {
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