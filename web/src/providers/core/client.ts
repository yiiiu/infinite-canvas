import { useProviderTaskStore } from "../task-store";
import { proxyFetch } from "./proxy-fetch";
import { providerRegistry, type ProviderRegistry } from "./registry";
import { ProviderError, ProviderErrorCode, type AdapterContext, type GenerateRequest, type GenerateResult, type JsonObject, type ProviderAdapter, type ProviderCapability } from "./types";

export type ProviderClient = {
    generate: <TParams extends JsonObject = JsonObject>(providerId: string, request: GenerateRequest<TParams>) => Promise<GenerateResult>;
};

export type ProviderClientOptions = {
    readonly registry?: ProviderRegistry;
    readonly context?: Partial<Pick<AdapterContext, "fetch" | "now">>;
};

export function createProviderClient(options: ProviderClientOptions = {}): ProviderClient {
    const registry = options.registry ?? providerRegistry;
    const baseContext = {
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

            const shouldTrackTask = Boolean(request.pendingId && request.taskContext);
            const taskStore = shouldTrackTask ? useProviderTaskStore.getState() : null;

            if (shouldTrackTask && request.pendingId && request.taskContext) {
                taskStore?.createTask({
                    pendingId: request.pendingId,
                    providerId,
                    responseMode: adapter.manifest.responseMode,
                    request,
                    taskContext: request.taskContext,
                });
                taskStore?.markRunning(request.pendingId);
            }

            const context: AdapterContext = {
                ...baseContext,
                responseMode: adapter.manifest.responseMode,
                pendingId: request.pendingId,
                updateTask: shouldTrackTask && request.pendingId ? (patch) => useProviderTaskStore.getState().updateTask(request.pendingId!, patch) : undefined,
            };

            try {
                const result = await adapter.generate(request, context);
                if (shouldTrackTask && request.pendingId) useProviderTaskStore.getState().completeTask(request.pendingId, result);
                return result;
            } catch (error) {
                const providerError = toProviderError(error, providerId, request);
                if (shouldTrackTask && request.pendingId) {
                    useProviderTaskStore.getState().failTask(request.pendingId, {
                        code: providerError.code,
                        message: providerError.message,
                        details: providerError.details,
                    });
                }
                throw providerError;
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

function toProviderError(error: unknown, providerId: string, request: GenerateRequest): ProviderError {
    if (error instanceof ProviderError) return error;
    if (isAbortError(error)) return new ProviderError(ProviderErrorCode.Canceled, "请求已取消", { cause: error });
    return new ProviderError(ProviderErrorCode.AdapterError, error instanceof Error ? error.message : "Provider adapter 调用失败", {
        cause: error,
        details: { providerId, modelId: request.modelId, capability: request.capability },
    });
}

function isAbortError(error: unknown) {
    return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}