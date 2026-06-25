import { createProviderClient } from "./core/client";
import { createProviderRegistry } from "./core/registry";
import { grsaiAdapter } from "./grsai/adapter";
import { openAICompatAdapter } from "./openai-compat/adapter";

export const defaultProviderRegistry = createProviderRegistry();
defaultProviderRegistry.register(openAICompatAdapter);
defaultProviderRegistry.register(grsaiAdapter);

export const defaultProviderClient = createProviderClient({ registry: defaultProviderRegistry });

declare global {
    interface Window {
        __providerClient?: typeof defaultProviderClient;
        __providerRegistry?: typeof defaultProviderRegistry;
    }
}

if (typeof window !== "undefined") {
    window.__providerClient = defaultProviderClient;
    window.__providerRegistry = defaultProviderRegistry;
}

export { grsaiAdapter, grsaiManifest } from "./grsai/adapter";
export { openAICompatAdapter, openAICompatManifest } from "./openai-compat/adapter";
export type { ProviderAdapter, ProviderCapability, ProviderManifest } from "./core/types";