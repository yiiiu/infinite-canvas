import { defaultProviderRegistry } from "@/providers";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { ProviderError, ProviderErrorCode, type JsonObject, type ProviderCapability } from "../core/types";
import { useProviderConfigStore } from "./use-provider-config-store";
import type { ProviderConfigCapability, ProviderModelSelection, ProviderProfile } from "./types";

export type ProviderRoutingNode = {
    readonly providerOverride?: ProviderModelSelection | null;
};

export type ProviderCompatRequestConfig = ReturnType<typeof resolveModelRequestConfig> & {
    readonly providerId?: string;
    readonly profileId?: string;
    readonly needsProviderConfiguration?: boolean;
};

export type ProviderRouting =
    | { readonly type: "legacy" }
    | { readonly type: "override" | "default"; readonly selection: ProviderModelSelection; readonly profile: ProviderProfile };

export function resolveProviderRouting(capability: ProviderCapability, node?: ProviderRoutingNode): ProviderRouting {
    const providerCapability = toProviderConfigCapability(capability);
    if (!providerCapability) return { type: "legacy" };

    const state = useProviderConfigStore.getState();
    const override = completeSelection(node?.providerOverride);
    if (override) {
        return { type: "override", selection: override, profile: resolveProfile(override.profileId, "节点指定的 Profile 已被禁用/删除，请重新选择") };
    }

    const defaultSelection = completeSelection(state.defaults[providerCapability]);
    if (!defaultSelection) return { type: "legacy" };
    return { type: "default", selection: defaultSelection, profile: resolveProfile(defaultSelection.profileId, "默认模型指定的 Profile 已被禁用/删除，请重新配置") };
}

export function resolveProviderRequestConfig(config: AiConfig, value: string, capability?: ProviderCapability, node?: ProviderRoutingNode): ProviderCompatRequestConfig {
    const legacyConfig = resolveModelRequestConfig(config, value);
    if (!capability) return legacyConfig;

    const routing = resolveProviderRouting(capability, node);
    if (routing.type === "legacy") return legacyConfig;

    if (!isRunnableProfile(routing.profile)) {
        return {
            ...legacyConfig,
            profileId: routing.profile.id,
            providerId: routing.profile.providerId,
            needsProviderConfiguration: true,
        };
    }

    const auth = profileAuth(routing.profile);
    const profileBaseUrl = stringValue(auth.baseUrl) || routing.profile.baseUrl || "";
    const profileApiKey = stringValue(auth.apiKey) || routing.profile.apiKey || "";
    return {
        ...legacyConfig,
        ...auth,
        profileId: routing.profile.id,
        providerId: routing.profile.providerId,
        baseUrl: profileBaseUrl,
        apiKey: profileApiKey,
        apiFormat: routing.profile.apiFormat || legacyConfig.apiFormat,
        model: routing.selection.modelId,
    };
}

export function providerIdFromCompatConfig(config: ProviderCompatRequestConfig) {
    return config.providerId;
}

function resolveProfile(profileId: string, message: string) {
    const profile = useProviderConfigStore.getState().profiles[profileId];
    if (!profile || profile.enabled === false) {
        throw new ProviderError(ProviderErrorCode.InvalidRequest, message, { details: { profileId } });
    }
    return profile;
}

function completeSelection(selection: ProviderModelSelection | null | undefined): ProviderModelSelection | undefined {
    const profileId = selection?.profileId?.trim();
    const modelId = selection?.modelId?.trim();
    return profileId && modelId ? { profileId, modelId } : undefined;
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