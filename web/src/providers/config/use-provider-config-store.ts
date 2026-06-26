"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { migrateAiConfigToProviderConfig } from "./migration";
import { PROVIDER_CONFIG_STORE_KEY, type ProviderConfigData, type ProviderConfigCapability, type ProviderConfigMode, type ProviderModelSelection, type ProviderProfile } from "./types";

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
        return JSON.parse(value) as StorageValue<ProviderConfigStore>;
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
