"use client";

import { useCallback, useRef, useState } from "react";

import { defaultProviderClient, type ModelListResult } from "@/providers";

function cacheKey(providerId: string, profileId: string | undefined) {
    return `${providerId}::${profileId || ""}`;
}

export function useModelList(providerId: string | undefined, profileId: string | undefined) {
    const [result, setResult] = useState<ModelListResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cacheRef = useRef(new Map<string, ModelListResult>());

    const load = useCallback(
        async (options: { force?: boolean } = {}) => {
            if (!providerId) return;
            const key = cacheKey(providerId, profileId);
            const cached = cacheRef.current.get(key);
            if (cached && !options.force) {
                setResult(cached);
                setError(null);
                return;
            }

            setLoading(true);
            setError(null);
            try {
                const next = await defaultProviderClient.listModels(providerId, profileId);
                cacheRef.current.set(key, next);
                setResult(next);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "模型列表加载失败");
            } finally {
                setLoading(false);
            }
        },
        [profileId, providerId],
    );

    const refetch = useCallback(() => load({ force: true }), [load]);

    return { result, models: result?.models || [], source: result?.source, loading, error, load, refetch };
}