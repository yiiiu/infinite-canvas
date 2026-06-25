import type { ProviderCapability } from "./core/types";

const DEFAULT_NEW_PROVIDER_CAPABILITIES = "";

export function isNewProviderEnabled(capability: ProviderCapability) {
    const raw = (process.env.NEXT_PUBLIC_NEW_PROVIDER_CAPABILITIES ?? DEFAULT_NEW_PROVIDER_CAPABILITIES).trim();
    if (!raw || ["0", "false", "off", "none"].includes(raw.toLowerCase())) return false;
    const enabled = new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    return enabled.has("all") || enabled.has("*") || enabled.has(capability);
}