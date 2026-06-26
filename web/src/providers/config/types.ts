import type { ApiCallFormat } from "@/stores/use-config-store";

export const PROVIDER_CONFIG_STORE_KEY = "infinite-canvas:provider_config_store";
export const PROVIDER_CONFIG_MIGRATION_VERSION = 1;

export type ProviderConfigCapability = "image" | "video" | "text" | "audio";
export type ProviderConfigMode = "legacy" | "profiles";

export type ProviderModelSelection = {
    readonly profileId: string;
    readonly modelId: string;
};

export type ProviderProfileSource = {
    readonly type: "legacy-ai-config";
    readonly channelId: string;
};

export type ProviderProfile = {
    readonly id: string;
    readonly name: string;
    readonly providerId?: string;
    readonly enabled?: boolean;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly apiFormat?: ApiCallFormat;
    readonly auth?: Record<string, string>;
    readonly models: readonly string[];
    readonly source?: ProviderProfileSource;
    readonly createdAt: string;
    readonly updatedAt: string;
};

export type ProviderConfigData = {
    readonly migrationVersion: number;
    readonly mode: ProviderConfigMode;
    readonly profiles: Record<string, ProviderProfile>;
    readonly defaults: Partial<Record<ProviderConfigCapability, ProviderModelSelection>>;
};