"use client";

import { Button, Empty, Input, Popover } from "antd";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { defaultProviderRegistry, type ModelInfo } from "@/providers";
import type { ProviderConfigCapability } from "@/providers/config";
import { useProviderConfigStore } from "@/providers/config";

type ModelPickerProps = {
    profileId: string;
    providerId: string | undefined;
    capability: ProviderConfigCapability;
    value: string;
    onChange: (modelId: string) => void;
};

export function ModelPicker({ profileId, providerId, value, onChange }: ModelPickerProps) {
    const profile = useProviderConfigStore((state) => (profileId ? state.profiles[profileId] : undefined));
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState(value);
    const profileBaseUrl = profile?.baseUrl || profile?.auth?.baseUrl || "";
    const models = useMemo(() => modelOptions(profile?.modelsFetchError ? undefined : profile?.cachedModels, providerId, profileBaseUrl), [profile?.cachedModels, profile?.modelsFetchError, profileBaseUrl, providerId]);
    const normalizedValue = value.trim();
    const dropdown = models.length > 0;
    const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
    const selectedModel = normalizedValue ? models.find((model) => model.id === normalizedValue) : undefined;
    const valueInList = normalizedValue ? Boolean(selectedModel) : true;
    const triggerLabel = normalizedValue ? (selectedModel ? modelLabel(selectedModel) : `${normalizedValue}（自定义）`) : "选择模型";

    useEffect(() => setDraft(value), [value]);

    if (!profileId) {
        return <Input value="" placeholder="请先选配置档" disabled />;
    }

    if (!dropdown) {
        const commit = () => {
            const next = draft.trim();
            if (next && next !== normalizedValue) onChange(next);
        };
        return (
            <div className="grid gap-1.5">
                <Input value={draft} placeholder="手动输入模型 ID" onBlur={commit} onPressEnter={(event) => event.currentTarget.blur()} onChange={(event) => setDraft(event.target.value)} />
                {profile?.modelsFetchError ? <div className="text-xs text-amber-600 dark:text-amber-400">模型列表加载失败，可到 AI 服务商中刷新后再选择。</div> : null}
            </div>
        );
    }

    return (
        <Popover
            open={open}
            trigger="click"
            placement="bottomLeft"
            onOpenChange={setOpen}
            content={
                <div className="w-[min(420px,calc(100vw-48px))]">
                    {profile?.modelsFetchedAt ? <div className="mb-2 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-300">上次更新 {formatTimeAgo(profile.modelsFetchedAt)}</div> : null}
                    <Input value={query} placeholder="搜索模型" allowClear onChange={(event) => setQuery(event.target.value)} />
                    <div className="thin-scrollbar mt-2 max-h-64 overflow-y-auto pr-1">
                        {!valueInList && normalizedValue ? <ModelOption id={normalizedValue} label={`${normalizedValue}（自定义）`} active onSelect={() => { onChange(normalizedValue); setOpen(false); }} /> : null}
                        {filteredModels.length ? (
                            filteredModels.map((model) => <ModelOption key={model.id} id={model.id} label={modelLabel(model)} active={model.id === normalizedValue} onSelect={() => { onChange(model.id); setOpen(false); }} />)
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模型" />
                        )}
                    </div>
                </div>
            }
        >
            <Button className="!flex h-9 w-full items-center justify-between !px-3" aria-label="选择模型">
                <span className={cn("truncate text-left", normalizedValue ? "text-stone-900 dark:text-stone-100" : "text-stone-400")}>{triggerLabel}</span>
                <ChevronDown className="size-4 shrink-0 text-stone-400" />
            </Button>
        </Popover>
    );
}

function modelOptions(cachedModels: readonly ModelInfo[] | undefined, providerId: string | undefined, profileBaseUrl: string) {
    if (cachedModels?.length) return uniqueModels(cachedModels);
    if (!providerId || isVolcengineAgentPlanProfile(providerId, profileBaseUrl)) return [];
    const manifestModels = defaultProviderRegistry.get(providerId)?.manifest.models || [];
    return uniqueModels(manifestModels.map((model) => ({ id: model.id, name: model.name })));
}

function uniqueModels(models: readonly Pick<ModelInfo, "id" | "name">[]) {
    const seen = new Set<string>();
    return models.filter((model) => {
        const id = model.id.trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function filterModels(models: readonly Pick<ModelInfo, "id" | "name">[], query: string) {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((model) => `${model.id} ${model.name || ""}`.toLowerCase().includes(keyword));
}

function modelLabel(model: Pick<ModelInfo, "id" | "name">) {
    return model.name?.trim() || model.id;
}

function isVolcengineAgentPlanProfile(providerId: string, profileBaseUrl: string) {
    if (providerId !== "volcengine") return false;
    const baseUrl = profileBaseUrl.trim().replace(/\/+$/, "").toLowerCase();
    return baseUrl.endsWith("/api/plan/v3");
}

function ModelOption({ id, label, active, onSelect }: { id: string; label: string; active: boolean; onSelect: () => void }) {
    return (
        <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800" onClick={onSelect}>
            <span className="min-w-0 truncate">{label}</span>
            {active ? <Check className="size-4 shrink-0 text-emerald-500" /> : null}
        </button>
    );
}

function formatTimeAgo(timestamp: number) {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return new Date(timestamp).toISOString().slice(0, 10);
}