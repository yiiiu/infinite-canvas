import { loadProviderManifest } from "./manifest-loader";
import { ProviderError, ProviderErrorCode, type ProviderAdapter } from "./types";

export type ProviderRegistry = {
    register: (adapter: ProviderAdapter) => void;
    get: (providerId: string) => ProviderAdapter | undefined;
    has: (providerId: string) => boolean;
    list: () => readonly ProviderAdapter[];
    clear: () => void;
};

export function createProviderRegistry(): ProviderRegistry {
    const adapters = new Map<string, ProviderAdapter>();

    return {
        register(adapter) {
            if (typeof adapter.generate !== "function") {
                throw new ProviderError(ProviderErrorCode.InvalidManifest, "Provider adapter 必须提供 generate 方法");
            }

            const manifest = loadProviderManifest(adapter.manifest);
            if (adapters.has(manifest.id)) {
                throw new ProviderError(ProviderErrorCode.DuplicateProvider, `Provider 已注册：${manifest.id}`, {
                    details: { providerId: manifest.id },
                });
            }
            adapters.set(manifest.id, adapter);
        },

        get(providerId) {
            return adapters.get(providerId);
        },

        has(providerId) {
            return adapters.has(providerId);
        },

        list() {
            return Array.from(adapters.values());
        },

        clear() {
            adapters.clear();
        },
    };
}

export const providerRegistry = createProviderRegistry();