import { defaultProviderRegistry } from "@/providers";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { JsonObject, ProviderCapability } from "../core/types";
import { useProviderConfigStore } from "./use-provider-config-store";
import type { ProviderConfigCapability, ProviderProfile } from "./types";

export type ProviderCompatRequestConfig = ReturnType<typeof resolveModelRequestConfig> & {
    readonly providerId?: string;
    readonly profileId?: string;
    readonly needsProviderConfiguration?: boolean;
};

export function resolveProviderRequestConfig(config: AiConfig, value: string, capability?: ProviderCapability): ProviderCompatRequestConfig {
    const legacyConfig = resolveModelRequestConfig(config, value);
    const providerCapability = toProviderConfigCapability(capability);
    if (!providerCapability) return legacyConfig;

    const providerConfig = useProviderConfigStore.getState();
    if (providerConfig.mode !== "profiles") return legacyConfig;

    const selection = providerConfig.defaults[providerCapability];
    const profile = selection ? providerConfig.profiles[selection.profileId] : undefined;
    if (!selection || !profile) return legacyConfig;

    if (!isRunnableProfile(profile)) {
        return {
            ...legacyConfig,
            profileId: profile.id,
            providerId: profile.providerId,
            needsProviderConfiguration: true,
        };
    }

    const auth = profileAuth(profile);
    return {
        ...legacyConfig,
        ...auth,
        profileId: profile.id,
        providerId: profile.providerId,
        baseUrl: stringValue(auth.baseUrl) || profile.baseUrl || legacyConfig.baseUrl,
        apiKey: stringValue(auth.apiKey) || profile.apiKey || legacyConfig.apiKey,
        apiFormat: profile.apiFormat || legacyConfig.apiFormat,
        model: selection.modelId,
    };
}

export function providerIdFromCompatConfig(config: ProviderCompatRequestConfig) {
    return config.providerId;
}

function isRunnableProfile(profile: ProviderProfile): profile is ProviderProfile & { providerId: string } {
    if (!profile.providerId) return false;
    const adapter = defaultProviderRegistry.get(profile.providerId);
    if (!adapter) return false;
    const auth = profileAuth(profile);
    return (adapter.manifest.auth?.fields || []).every((field) => !field.required || Boolean(stringValue(auth[field.key]).trim()));
}

function profileAuth(profile: ProviderProfile): JsonObject {
    return {
        ...(profile.auth || {}),
        ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
    };
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function toProviderConfigCapability(capability: ProviderCapability | undefined): ProviderConfigCapability | undefined {
    if (capability === "image" || capability === "image-edit") return "image";
    if (capability === "video" || capability === "text" || capability === "audio") return capability;
    return undefined;
}

export { modelOptionName };