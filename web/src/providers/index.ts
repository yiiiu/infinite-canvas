import { createProviderClient } from "./core/client";
import { createProviderRegistry } from "./core/registry";
import { openAICompatAdapter } from "./openai-compat/adapter";

export const defaultProviderRegistry = createProviderRegistry();
defaultProviderRegistry.register(openAICompatAdapter);

export const defaultProviderClient = createProviderClient({ registry: defaultProviderRegistry });

export { openAICompatAdapter, openAICompatManifest } from "./openai-compat/adapter";
export type { ProviderAdapter, ProviderCapability, ProviderManifest } from "./core/types";