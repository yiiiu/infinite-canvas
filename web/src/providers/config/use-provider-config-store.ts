"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { migrateAiConfigToProviderConfig, normalizeProviderConfigData } from "./migration";
import { PROVIDER_CONFIG_STORE_KEY, type ProviderConfigData, type ProviderConfigCapability, type ProviderConfigMode, type ProviderModelSelection, type ProviderProfile } from "./types";
import type { ModelListResult } from "../core/types";

type ProfileModelListLoader = (providerId: string, profileId: string) => Promise<ModelListResult>;

let profileModelListLoader: ProfileModelListLoader = async (providerId, profileId) => {
    const { defaultProviderClient } = await import("../index");
    return defaultProviderClient.listModels(providerId, profileId);
};

export function setProfileModelListLoaderForTests(loader: ProfileModelListLoader) {
    profileModelListLoader = loader;
}

export function resetProfileModelListLoaderForTests() {
    profileModelListLoader = async (providerId, profileId) => {
        const { defaultProviderClient } = await import("../index");
        return defaultProviderClient.listModels(providerId, profileId);
    };
}

type ProviderProfileInput = {
    readonly name: string;
    readonly providerId: string;
    readonly auth?: Record<string, string>;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly models?: readonly string[];
    readonly enabled?: boolean;
};

type ProviderConfigStore = ProviderConfigData & {
    hydrated: boolean;
    migrateFromAiConfig: (config: Partial<AiConfig>) => void;
    setMode: (mode: ProviderConfigMode) => void;
    createProfile: (input: ProviderProfileInput) => ProviderProfile;
    updateProfile: (profileId: string, patch: Partial<Omit<ProviderProfile, "id" | "createdAt">>) => void;
    setProfileEnabled: (profileId: string, enabled: boolean) => void;
    upsertProfile: (profile: ProviderProfile) => void;
    removeProfile: (profileId: string) => void;
    setDefault: (capability: ProviderConfigCapability, value: ProviderModelSelection | null) => void;
    setDefaultSelection: (capability: ProviderConfigCapability, selection: ProviderModelSelection | undefined) => void;
    refreshProfileModels: (profileId: string) => Promise<void>;
    updateProfileModels: (profileId: string, data: { models: ModelListResult["models"]; fetchedAt: number; error?: string }) => void;
    recordModelUsage: (profileId: string, modelId: string) => void;
    getProfileModels: (profileId: string) => { models: ModelListResult["models"]; fetchedAt?: number; error?: string };
    getProfile: (profileId: string) => ProviderProfile | undefined;
    getEffectiveDefault: (capability: ProviderConfigCapability) => ProviderModelSelection | null;
    resetProviderConfig: () => void;
};

const initialProviderConfig: ProviderConfigData = {
    migrationVersion: 0,
    mode: "legacy",
    profiles: {},
    defaults: {},
};

const providerConfigStorage: PersistStorage<ProviderConfigStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<ProviderConfigStore>;
        return { ...parsed, state: normalizeProviderConfigData(parsed.state) as ProviderConfigStore };
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useProviderConfigStore = create<ProviderConfigStore>()(
    persist(
        (set, get) => ({
            ...initialProviderConfig,
            hydrated: false,
            migrateFromAiConfig: (config) => set((state) => migrateAiConfigToProviderConfig(config, state)),
            setMode: (mode) => set({ mode }),
            createProfile: (input) => {
                const now = new Date().toISOString();
                const profile: ProviderProfile = {
                    id: createProfileId(input.providerId, get().profiles),
                    name: input.name,
                    providerId: input.providerId,
                    enabled: input.enabled ?? true,
                    baseUrl: input.baseUrl,
                    apiKey: input.apiKey,
                    auth: input.auth,
                    models: input.models ?? [],
                    createdAt: now,
                    updatedAt: now,
                };
                set((state) => ({ profiles: { ...state.profiles, [profile.id]: profile } }));
                return profile;
            },
            updateProfile: (profileId, patch) =>
                set((state) => {
                    const profile = state.profiles[profileId];
                    if (!profile) return {};
                    return {
                        profiles: {
                            ...state.profiles,
                            [profileId]: { ...profile, ...patch, updatedAt: new Date().toISOString() },
                        },
                    };
                }),
            setProfileEnabled: (profileId, enabled) =>
                set((state) => {
                    const profile = state.profiles[profileId];
                    if (!profile) return {};
                    return {
                        profiles: {
                            ...state.profiles,
                            [profileId]: { ...profile, enabled, updatedAt: new Date().toISOString() },
                        },
                    };
                }),
            upsertProfile: (profile) =>
                set((state) => ({
                    profiles: { ...state.profiles, [profile.id]: { ...profile, updatedAt: new Date().toISOString() } },
                })),
            removeProfile: (profileId) =>
                set((state) => ({
                    profiles: Object.fromEntries(Object.entries(state.profiles).filter(([id]) => id !== profileId)),
                    defaults: Object.fromEntries(Object.entries(state.defaults).filter(([, selection]) => selection?.profileId !== profileId)),
                })),
            setDefault: (capability, value) =>
                set((state) => ({
                    defaults: value
                        ? { ...state.defaults, [capability]: value }
                        : Object.fromEntries(Object.entries(state.defaults).filter(([key]) => key !== capability)),
                })),
            setDefaultSelection: (capability, selection) => get().setDefault(capability, selection ?? null),
            refreshProfileModels: async (profileId) => {
                const profile = get().profiles[profileId];
                if (!profile?.providerId) return;
                try {
                    const result = await profileModelListLoader(profile.providerId, profileId);
                    set((state) => {
                        const current = state.profiles[profileId];
                        if (!current) return {};
                        const { modelsFetchError: _modelsFetchError, ...profileWithoutError } = current;
                        return {
                            profiles: {
                                ...state.profiles,
                                [profileId]: {
                                    ...profileWithoutError,
                                    cachedModels: result.models,
                                    modelsFetchedAt: Date.now(),
                                    updatedAt: new Date().toISOString(),
                                },
                            },
                        };
                    });
                } catch (error) {
                    set((state) => {
                        const current = state.profiles[profileId];
                        if (!current) return {};
                        return {
                            profiles: {
                                ...state.profiles,
                                [profileId]: {
                                    ...current,
                                    modelsFetchError: error instanceof Error ? error.message : "模型列表加载失败",
                                    updatedAt: new Date().toISOString(),
                                },
                            },
                        };
                    });
                }
            },
            updateProfileModels: (profileId, data) =>
                set((state) => {
                    const profile = state.profiles[profileId];
                    if (!profile) return {};
                    const { modelsFetchError: _modelsFetchError, ...profileWithoutError } = profile;
                    return {
                        profiles: {
                            ...state.profiles,
                            [profileId]: {
                                ...profileWithoutError,
                                cachedModels: data.models,
                                modelsFetchedAt: data.fetchedAt,
                                ...(data.error ? { modelsFetchError: data.error } : {}),
                                updatedAt: new Date().toISOString(),
                            },
                        },
                    };
                }),
            recordModelUsage: (profileId, modelId) =>
                set((state) => {
                    const profile = state.profiles[profileId];
                    const normalizedModelId = modelId.trim();
                    if (!profile || !normalizedModelId) return {};
                    const now = Date.now();
                    const current = profile.recentlyUsedModels || [];
                    const existing = current.find((item) => item.modelId === normalizedModelId);
                    const next = [
                        ...(existing ? current.filter((item) => item.modelId !== normalizedModelId) : current),
                        { modelId: normalizedModelId, count: (existing?.count || 0) + 1, lastUsedAt: now },
                    ]
                        .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
                        .slice(0, 20);
                    return {
                        profiles: {
                            ...state.profiles,
                            [profileId]: { ...profile, recentlyUsedModels: next, updatedAt: new Date().toISOString() },
                        },
                    };
                }),
            getProfileModels: (profileId) => {
                const profile = get().profiles[profileId];
                return { models: [...(profile?.cachedModels || [])], fetchedAt: profile?.modelsFetchedAt, error: profile?.modelsFetchError };
            },
            getProfile: (profileId) => get().profiles[profileId],
            getEffectiveDefault: (capability) => {
                const selection = get().defaults[capability];
                if (!selection) return null;
                const profile = get().profiles[selection.profileId];
                if (!profile || profile.enabled === false) return null;
                return selection;
            },
            resetProviderConfig: () => set(initialProviderConfig),
        }),
        {
            name: PROVIDER_CONFIG_STORE_KEY,
            storage: providerConfigStorage,
            partialize: (state) => ({ migrationVersion: state.migrationVersion, mode: state.mode, profiles: state.profiles, defaults: state.defaults }) as StorageValue<ProviderConfigStore>["state"],
            onRehydrateStorage: () => () => {
                useProviderConfigStore.setState({ hydrated: true });
            },
        },
    ),
);

function createProfileId(providerId: string, profiles: Record<string, ProviderProfile>) {
    const prefix = `profile-${providerId.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Object.keys(profiles).length + 1}`;
}
