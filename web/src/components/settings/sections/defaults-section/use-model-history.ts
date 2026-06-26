"use client";

import { useCallback, useEffect, useState } from "react";

import type { ProviderConfigCapability } from "@/providers/config";

const MODEL_HISTORY_STORAGE_KEY = "infinite-canvas:model-history";
const MODEL_HISTORY_LIMIT = 12;

type ModelHistoryState = Partial<Record<ProviderConfigCapability, string[]>>;

export function useModelHistory(capability: ProviderConfigCapability) {
    const [history, setHistory] = useState<string[]>([]);

    useEffect(() => {
        setHistory(readModelHistory()[capability] || []);
    }, [capability]);

    const rememberModel = useCallback(
        (modelId: string) => {
            const normalized = modelId.trim();
            if (!normalized) return;
            const state = readModelHistory();
            const next = [normalized, ...(state[capability] || []).filter((item) => item !== normalized)].slice(0, MODEL_HISTORY_LIMIT);
            writeModelHistory({ ...state, [capability]: next });
            setHistory(next);
        },
        [capability],
    );

    return { history, rememberModel };
}

function readModelHistory(): ModelHistoryState {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(MODEL_HISTORY_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []])) as ModelHistoryState;
    } catch {
        return {};
    }
}

function writeModelHistory(state: ModelHistoryState) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MODEL_HISTORY_STORAGE_KEY, JSON.stringify(state));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}