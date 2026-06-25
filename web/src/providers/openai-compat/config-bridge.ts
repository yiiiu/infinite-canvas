import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { GenerateRequest, JsonObject, JsonValue, ProviderCapability } from "../core/types";

export function aiConfigToProviderRequest(config: AiConfig, capability: ProviderCapability, extraParams: JsonObject): GenerateRequest {
    const selectedModel = selectedModelForCapability(config, capability);
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return {
        capability,
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