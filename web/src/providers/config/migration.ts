import type { AiConfig, ModelChannel } from "@/stores/use-config-store";
import { PROVIDER_CONFIG_MIGRATION_VERSION, type ProviderConfigCapability, type ProviderConfigData, type ProviderModelSelection, type ProviderProfile } from "./types";

type LegacyModelField = "imageModel" | "videoModel" | "textModel" | "model" | "audioModel";

type MigrationInput = Partial<Pick<AiConfig, "channels" | LegacyModelField>>;
type MigrationState = Omit<ProviderConfigData, "migrationVersion" | "mode"> & Partial<Pick<ProviderConfigData, "migrationVersion" | "mode">>;

const MODEL_SEPARATOR = "::";

export function migrateAiConfigToProviderConfig(input: MigrationInput, current: MigrationState, now = new Date()): ProviderConfigData {
    const currentVersion = current.migrationVersion ?? 0;
    if (currentVersion >= PROVIDER_CONFIG_MIGRATION_VERSION) {
        if (current.migrationVersion === currentVersion && current.mode) return current as ProviderConfigData;
        return { ...current, migrationVersion: currentVersion, mode: current.mode ?? "legacy" };
    }

    const timestamp = now.toISOString();
    const channels = Array.isArray(input.channels) ? input.channels : [];
    const profiles = Object.fromEntries(channels.map((channel, index) => [profileIdForChannel(channel, index), createProfile(channel, index, timestamp)]));

    return {
        migrationVersion: PROVIDER_CONFIG_MIGRATION_VERSION,
        mode: current.mode ?? "legacy",
        profiles,
        defaults: {
            ...defaultSelection("image", input.imageModel, channels),
            ...defaultSelection("video", input.videoModel, channels),
            ...defaultSelection("text", input.textModel || input.model, channels),
            ...defaultSelection("audio", input.audioModel, channels),
        },
    };
}

function createProfile(channel: ModelChannel, index: number, timestamp: string): ProviderProfile {
    return {
        id: profileIdForChannel(channel, index),
        name: channel.name?.trim() || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
        providerId: inferProviderId(channel),
        baseUrl: trimmedOrUndefined(channel.baseUrl),
        apiKey: channel.apiKey || undefined,
        apiFormat: channel.apiFormat,
        models: uniqueModels(channel.models),
        source: { type: "legacy-ai-config", channelId: channel.id || `channel-${index + 1}` },
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function defaultSelection(capability: ProviderConfigCapability, value: string | undefined, channels: ModelChannel[]): Partial<Record<ProviderConfigCapability, ProviderModelSelection>> {
    const selection = resolveLegacyModelSelection(value, channels);
    return selection ? { [capability]: selection } : {};
}

export function resolveLegacyModelSelection(value: string | undefined, channels: ModelChannel[]): ProviderModelSelection | undefined {
    const raw = value?.trim();
    if (!raw) return undefined;

    const decoded = decodeChannelModel(raw);
    if (decoded) {
        const channelIndex = channels.findIndex((channel) => channel.id === decoded.channelId);
        if (channelIndex < 0 || !decoded.model) return undefined;
        return { profileId: profileIdForChannel(channels[channelIndex], channelIndex), modelId: decoded.model };
    }

    const matches = channels
        .map((channel, index) => ({ channel, index }))
        .filter(({ channel }) => uniqueModels(channel.models).includes(raw));
    if (matches.length !== 1) return undefined;
    return { profileId: profileIdForChannel(matches[0].channel, matches[0].index), modelId: raw };
}

function decodeChannelModel(value: string) {
    const index = value.indexOf(MODEL_SEPARATOR);
    if (index < 0) return undefined;
    return { channelId: value.slice(0, index), model: value.slice(index + MODEL_SEPARATOR.length).trim() };
}

function inferProviderId(channel: ModelChannel) {
    const baseUrl = channel.baseUrl?.toLowerCase() || "";
    if (baseUrl.includes("grsai")) return "grsai";
    if (channel.apiFormat === "openai") return "openai-compat";
    return undefined;
}

function profileIdForChannel(channel: Pick<ModelChannel, "id">, index: number) {
    return `legacy-${slug(channel.id || `channel-${index + 1}`)}`;
}

function slug(value: string) {
    return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "default";
}

function uniqueModels(models: readonly string[] | undefined) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function trimmedOrUndefined(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed || undefined;
}