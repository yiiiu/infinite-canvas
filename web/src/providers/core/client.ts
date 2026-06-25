import { proxyFetch } from "./proxy-fetch";
import { providerRegistry, type ProviderRegistry } from "./registry";
import { ProviderError, ProviderErrorCode, type AdapterContext, type GenerateRequest, type GenerateResult, type JsonObject, type ProviderAdapter, type ProviderCapability } from "./types";

export type ProviderClient = {
    generate: <TParams extends JsonObject = JsonObject>(providerId: string, request: GenerateRequest<TParams>) => Promise<GenerateResult>;
};

export type ProviderClientOptions = {
    readonly registry?: ProviderRegistry;
    readonly context?: Partial<AdapterContext>;
};

export function createProviderClient(options: ProviderClientOptions = {}): ProviderClient {
    const registry = options.registry ?? providerRegistry;
    const context: AdapterContext = {
        now: options.context?.now ?? (() => new Date()),
        fetch: options.context?.fetch ?? proxyFetch,
    };

    return {
        async generate(providerId, request) {
            const adapter = registry.get(providerId);
            if (!adapter) {
                throw new ProviderError(ProviderErrorCode.ProviderNotFound, `Provider 未注册：${providerId}`, {
                    details: { providerId },
                });
            }

            assertRequestSupported(adapter, request.capability, request.modelId);

            try {
                return await adapter.generate(request, context);
            } catch (error) {
                if (error instanceof ProviderError) throw error;
                if (isAbortError(error)) throw new ProviderError(ProviderErrorCode.Canceled, "请求已取消", { cause: error });
                throw new ProviderError(ProviderErrorCode.AdapterError, error instanceof Error ? error.message : "Provider adapter 调用失败", {
                    cause: error,
                    details: { providerId, modelId: request.modelId, capability: request.capability },
                });
            }
        },
    };
}

function assertRequestSupported(adapter: ProviderAdapter, capability: ProviderCapability, modelId: string) {
    const manifest = adapter.manifest;
    if (!manifest.capabilities.includes(capability)) {
        throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `Provider ${manifest.id} 不支持 ${capability}`, {
            details: { providerId: manifest.id, capability },
        });
    }

    if (manifest.allowsCustomModels === true) return;

    const model = manifest.models?.find((item) => item.id === modelId);
    if (!model) {
        throw new ProviderError(ProviderErrorCode.ModelNotFound, `Provider ${manifest.id} 未声明模型：${modelId}`, {
            details: { providerId: manifest.id, modelId },
        });
    }

    if (!model.capabilities.includes(capability)) {
        throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `模型 ${modelId} 不支持 ${capability}`, {
            details: { providerId: manifest.id, modelId, capability },
        });
    }
}

export const providerClient = createProviderClient();

function isAbortError(error: unknown) {
    return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}