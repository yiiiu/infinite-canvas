"use client";

import { Button, Empty, Input, Popover } from "antd";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { defaultProviderRegistry, type ModelInfo } from "@/providers";
import type { ProviderCapability, ProviderManifest } from "@/providers/core/types";
import type { ProviderConfigCapability, ProviderModelSelection, ProviderModelUsage, ProviderProfile } from "@/providers/config";

type NodeModelSelectorProps = {
    capability: ProviderConfigCapability;
    profiles: readonly ProviderProfile[];
    value?: ProviderModelSelection | null;
    onChange: (value: ProviderModelSelection) => void;
    compact?: boolean;
};

type ModelOptionItem = Pick<ModelInfo, "id" | "name">;

export function NodeModelSelector({ capability, profiles, value, onChange, compact = false }: NodeModelSelectorProps) {
    const profileOptions = useMemo(() => profiles.filter((profile) => profile.enabled !== false && profileSupportsCapability(profile, capability)), [capability, profiles]);
    const selectedProfile = profileOptions.find((profile) => profile.id === value?.profileId);
    const [profileId, setProfileId] = useState(selectedProfile?.id || "");
    const [modelId, setModelId] = useState(value?.modelId || "");
    const activeProfile = profileOptions.find((profile) => profile.id === profileId);

    useEffect(() => setProfileId(selectedProfile?.id || ""), [selectedProfile?.id]);
    useEffect(() => setModelId(value?.modelId || ""), [value?.modelId]);

    const updateProfile = (nextProfileId: string) => {
        setProfileId(nextProfileId);
        setModelId("");
    };

    const updateModel = (nextModelId: string) => {
        const normalizedModelId = nextModelId.trim();
        setModelId(nextModelId);
        if (!profileId || !normalizedModelId) return;
        onChange({ profileId, modelId: normalizedModelId });
    };

    if (compact) {
        return <CompactNodeModelSelector capability={capability} profiles={profileOptions} profile={activeProfile} profileId={profileId} modelId={modelId} onProfileChange={updateProfile} onModelChange={updateModel} />;
    }

    return (
        <div className="grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(180px,1fr)]">
            <label className="grid gap-1.5">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">配置档</span>
                {profileOptions.length ? (
                    <Select value={activeProfile?.id} onValueChange={updateProfile}>
                        <SelectTrigger className="h-9 w-full bg-white dark:bg-stone-900">
                            <SelectValue placeholder="请选择" />
                        </SelectTrigger>
                        <SelectContent className="z-[1100]">
                            {profileOptions.map((profile) => (
                                <SelectItem key={profile.id} value={profile.id} textValue={profileLabel(profile)}>
                                    {profileLabel(profile)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <Input value="" placeholder="暂无配置档" disabled />
                )}
            </label>

            <label className="grid gap-1.5">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">模型</span>
                <NodeModelPicker capability={capability} profile={activeProfile} value={modelId} onChange={updateModel} />
            </label>
        </div>
    );
}

function CompactNodeModelSelector({
    capability,
    profiles,
    profile,
    profileId,
    modelId,
    onProfileChange,
    onModelChange,
}: {
    capability: ProviderConfigCapability;
    profiles: readonly ProviderProfile[];
    profile: ProviderProfile | undefined;
    profileId: string;
    modelId: string;
    onProfileChange: (profileId: string) => void;
    onModelChange: (modelId: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState(modelId);
    const rootRef = useRef<HTMLDivElement>(null);
    const models = useMemo(() => modelOptions(profile, capability), [profile, capability]);
    const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
    const normalizedModelId = modelId.trim();
    const valueInList = normalizedModelId ? models.some((model) => model.id === normalizedModelId) : true;
    const triggerLabel = profile ? [profileLabel(profile), normalizedModelId || "请选择模型"].join(" · ") : "请选择模型";

    useEffect(() => setDraft(modelId), [modelId]);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return;
            setOpen(false);
            setQuery("");
        };
        const closeByKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            setQuery("");
        };
        window.addEventListener("pointerdown", close, true);
        window.addEventListener("keydown", closeByKey);
        return () => {
            window.removeEventListener("pointerdown", close, true);
            window.removeEventListener("keydown", closeByKey);
        };
    }, [open]);

    const commitDraft = () => {
        const next = draft.trim();
        if (!next || next === normalizedModelId) return;
        onModelChange(next);
        setOpen(false);
    };

    return (
        <div ref={rootRef} className="relative inline-flex">
            <Button
                className="!flex !h-10 !max-w-[190px] !items-center !justify-start !rounded-full !px-3"
                aria-label="选择图像模型"
                onClick={() => {
                    setOpen((nextOpen) => {
                        if (nextOpen) setQuery("");
                        return !nextOpen;
                    });
                }}
            >
                <span className={cn("min-w-0 flex-1 truncate text-left text-xs", profile && normalizedModelId ? "text-stone-700 dark:text-stone-100" : "text-stone-400")}>{triggerLabel}</span>
                <ChevronDown className="ml-1 size-3.5 shrink-0 text-stone-400" />
            </Button>
            {open ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(520px,calc(100vw-48px))] overflow-hidden rounded-2xl bg-white text-stone-900 shadow-2xl ring-1 ring-stone-200 dark:bg-stone-950 dark:text-stone-100 dark:ring-stone-800" onWheelCapture={(event) => event.stopPropagation()}>
                    <div className="grid min-h-[260px] grid-cols-[168px_minmax(0,1fr)]">
                        <div className="border-r border-stone-200 p-2 dark:border-stone-800">
                            <div className="px-2 pb-2 text-[11px] font-medium text-stone-400">配置档</div>
                            <div className="thin-scrollbar max-h-[238px] space-y-1 overflow-y-auto pr-1">
                                {profiles.length ? (
                                    profiles.map((item) => (
                                        <ProfileOption key={item.id} profile={item} active={item.id === profileId} onSelect={() => onProfileChange(item.id)} />
                                    ))
                                ) : (
                                    <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400 dark:border-stone-800">暂无可用配置档</div>
                                )}
                            </div>
                        </div>
                        <div className="min-w-0 p-2">
                            <div className="flex items-center gap-2 px-1 pb-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-medium text-stone-700 dark:text-stone-200">{profile ? profileLabel(profile) : "未选择配置档"}</div>
                                    <div className="truncate text-[11px] text-stone-400">{profile?.providerId || "先选择配置档"}</div>
                                </div>
                                {normalizedModelId ? <span className="max-w-[150px] truncate rounded-full bg-emerald-50 px-2 py-1 text-[11px] text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300">{normalizedModelId}</span> : null}
                            </div>
                            {profile ? (
                                <>
                                    <Input size="small" value={query} placeholder="搜索模型" allowClear onChange={(event) => setQuery(event.target.value)} />
                                    <div className="thin-scrollbar mt-2 max-h-[178px] overflow-y-auto pr-1">
                                        {!valueInList && normalizedModelId ? <ModelOption id={normalizedModelId} label={`${normalizedModelId}（自定义）`} active onSelect={() => { onModelChange(normalizedModelId); setOpen(false); setQuery(""); }} /> : null}
                                        {filteredModels.length ? (
                                            filteredModels.map((model) => <ModelOption key={model.id} id={model.id} label={model.name && model.name !== model.id ? `${model.id} · ${model.name}` : model.id} active={model.id === normalizedModelId} onSelect={() => { onModelChange(model.id); setOpen(false); setQuery(""); }} />)
                                        ) : models.length ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模型" />
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-stone-200 p-3 dark:border-stone-800">
                                                <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">当前配置档没有模型列表，可手动输入模型 ID。</div>
                                                <Input size="small" value={draft} placeholder="手动输入模型 ID" onBlur={commitDraft} onPressEnter={(event) => event.currentTarget.blur()} onChange={(event) => setDraft(event.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="grid h-[210px] place-items-center rounded-xl border border-dashed border-stone-200 text-xs text-stone-400 dark:border-stone-800">请选择左侧配置档</div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NodeModelPicker({ capability, profile, value, onChange }: { capability: ProviderConfigCapability; profile: ProviderProfile | undefined; value: string; onChange: (modelId: string) => void }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState(value);
    const models = useMemo(() => modelOptions(profile, capability), [profile, capability]);
    const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
    const normalizedValue = value.trim();
    const valueInList = normalizedValue ? models.some((model) => model.id === normalizedValue) : true;
    const triggerLabel = normalizedValue ? (valueInList ? normalizedValue : `${normalizedValue}（自定义）`) : "请选择";

    useEffect(() => setDraft(value), [value]);

    if (!profile) return <Input value="" placeholder="请选择" disabled />;

    if (!models.length) {
        const commit = () => {
            const next = draft.trim();
            if (next && next !== normalizedValue) onChange(next);
        };
        return <Input value={draft} placeholder="手动输入模型 ID" onBlur={commit} onPressEnter={(event) => event.currentTarget.blur()} onChange={(event) => setDraft(event.target.value)} />;
    }

    return (
        <Popover
            open={open}
            trigger="click"
            placement="bottomLeft"
            onOpenChange={setOpen}
            content={
                <div className="w-[min(420px,calc(100vw-48px))]">
                    <Input value={query} placeholder="搜索模型" allowClear onChange={(event) => setQuery(event.target.value)} />
                    <div className="thin-scrollbar mt-2 max-h-64 overflow-y-auto pr-1">
                        {!valueInList && normalizedValue ? <ModelOption id={normalizedValue} label={`${normalizedValue}（自定义）`} active onSelect={() => { onChange(normalizedValue); setOpen(false); }} /> : null}
                        {filteredModels.length ? (
                            filteredModels.map((model) => <ModelOption key={model.id} id={model.id} label={model.name && model.name !== model.id ? `${model.id} · ${model.name}` : model.id} active={model.id === normalizedValue} onSelect={() => { onChange(model.id); setOpen(false); }} />)
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模型" />
                        )}
                    </div>
                </div>
            }
        >
            <Button className="!flex h-9 w-full items-center justify-between !px-3" aria-label="选择节点模型">
                <span className={cn("truncate text-left", normalizedValue ? "text-stone-900 dark:text-stone-100" : "text-stone-400")}>{triggerLabel}</span>
                <ChevronDown className="size-4 shrink-0 text-stone-400" />
            </Button>
        </Popover>
    );
}

function modelOptions(profile: ProviderProfile | undefined, capability: ProviderConfigCapability): readonly ModelOptionItem[] {
    if (!profile) return [];
    const cachedModels = profile.modelsFetchError ? [] : profile.cachedModels || [];
    const sourceModels = cachedModels.length ? cachedModels.filter((model) => !model.capability || model.capability === capability || (model.capability === "image-edit" && capability === "image")) : manifestModels(profile.providerId, capability);
    return sortByUsage(uniqueModels(sourceModels), profile.recentlyUsedModels || []);
}

function manifestModels(providerId: string | undefined, capability: ProviderConfigCapability): readonly ModelOptionItem[] {
    const models = providerManifest(providerId)?.models || [];
    return models.filter((model) => model.capabilities.includes(capability as ProviderCapability) || (capability === "image" && model.capabilities.includes("image-edit"))).map((model) => ({ id: model.id, name: model.name }));
}

function uniqueModels(models: readonly ModelOptionItem[]) {
    const seen = new Set<string>();
    return models.filter((model) => {
        const id = model.id.trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function sortByUsage(models: readonly ModelOptionItem[], usage: readonly ProviderModelUsage[]) {
    const usageByModel = new Map(usage.map((item) => [item.modelId, item]));
    return [...models].sort((a, b) => {
        const aUsage = usageByModel.get(a.id);
        const bUsage = usageByModel.get(b.id);
        return (bUsage?.count || 0) - (aUsage?.count || 0) || (bUsage?.lastUsedAt || 0) - (aUsage?.lastUsedAt || 0);
    });
}

function filterModels(models: readonly ModelOptionItem[], query: string) {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((model) => `${model.id} ${model.name || ""}`.toLowerCase().includes(keyword));
}

function profileSupportsCapability(profile: ProviderProfile, capability: ProviderConfigCapability) {
    return Boolean(providerManifest(profile.providerId)?.capabilities.includes(capability as ProviderCapability));
}

function providerManifest(providerId: string | undefined): ProviderManifest | undefined {
    if (!providerId) return undefined;
    return defaultProviderRegistry.get(providerId)?.manifest;
}

function profileLabel(profile: ProviderProfile) {
    return profile.name || "未命名配置档";
}

function ProfileOption({ profile, active, onSelect }: { profile: ProviderProfile; active: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition",
                active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
            )}
            onClick={onSelect}
        >
            <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{profileLabel(profile)}</span>
                <span className="block truncate text-[11px] opacity-60">{profile.providerId || "未绑定供应商"}</span>
            </span>
            {active ? <Check className="size-3.5 shrink-0" /> : null}
        </button>
    );
}

function ModelOption({ id, label, active, onSelect }: { id: string; label: string; active: boolean; onSelect: () => void }) {
    return (
        <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[15px] leading-6 text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800" onClick={onSelect}>
            <span className="min-w-0 truncate">{label || id}</span>
            {active ? <Check className="size-4 shrink-0 text-emerald-500" /> : null}
        </button>
    );
}