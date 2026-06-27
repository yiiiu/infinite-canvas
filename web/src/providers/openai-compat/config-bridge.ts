import { modelOptionName, resolveProviderRequestConfig, type ProviderRoutingNode } from "@/providers/config/compat";
import type { AiConfig } from "@/stores/use-config-store";
import { ProviderError, ProviderErrorCode, type GenerateRequest, type JsonObject, type JsonValue, type ProviderCapability } from "../core/types";

export function aiConfigToProviderRequest(config: AiConfig, capability: ProviderCapability, extraParams: JsonObject, node?: ProviderRoutingNode): GenerateRequest {
    const selectedModel = selectedModelForCapability(config, capability);
    const requestConfig = resolveProviderRequestConfig(config, selectedModel, capability, node);
    if (requestConfig.needsProviderConfiguration) {
        throw new ProviderError(ProviderErrorCode.InvalidRequest, "请先完成 Provider 配置", {
            details: { profileId: requestConfig.profileId || "", providerId: requestConfig.providerId || "" },
        });
    }
    return {
        capability,
        ...(requestConfig.providerId ? { providerId: requestConfig.providerId } : {}),
        ...(requestConfig.profileId ? { profileId: requestConfig.profileId } : {}),
        modelId: requestConfig.model,
        params: {
            baseUrl: requestConfig.baseUrl,
            apiKey: requestConfig.apiKey,
            model: modelOptionName(requestConfig.model),
            ...defaultParams(requestConfig, capability),
            ...extraParams,
        },
        signal: undefined,
    };
}

function selectedModelForCapability(config: AiConfig, capability: ProviderCapability) {
    if (capability === "image" || capability === "image-edit") return config.model || config.imageModel;
    if (capability === "video") return config.model || config.videoModel;
    if (capability === "audio") return config.model || config.audioModel;
    return config.model || config.textModel;
}

function defaultParams(config: AiConfig, capability: ProviderCapability): JsonObject {
    if (capability === "image" || capability === "image-edit") return compact({ size: config.size, quality: config.quality, count: numberValue(config.count), responseFormat: "b64_json" });
    if (capability === "audio") return compact({ voice: config.audioVoice, format: config.audioFormat, speed: numberValue(config.audioSpeed), instructions: config.audioInstructions });
    if (capability === "video") return compact({ size: config.size, seconds: numberValue(config.videoSeconds) });
    return {};
}

function compact(values: Record<string, JsonValue | undefined>): JsonObject {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== "")) as JsonObject;
}

function numberValue(value: string) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}