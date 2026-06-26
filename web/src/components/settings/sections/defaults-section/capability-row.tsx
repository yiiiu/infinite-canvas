"use client";

import { Button, Input, message, Tooltip } from "antd";
import { Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultProviderRegistry } from "@/providers";
import type { ProviderCapability, ProviderManifest } from "@/providers/core/types";
import type { ProviderConfigCapability, ProviderModelSelection, ProviderProfile } from "@/providers/config";
import { ModelBrowserDialog } from "./model-browser-dialog";
import { useModelHistory } from "./use-model-history";

const DEFAULT_NOTICE_STORAGE_KEY = "infinite-canvas:provider-profile-default-notice";

export type CapabilityMeta = {
    id: ProviderConfigCapability;
    title: string;
    description: string;
};

type CapabilityRowProps = {
    capability: CapabilityMeta;
    profiles: readonly ProviderProfile[];
    selection: ProviderModelSelection | undefined;
    onChange: (capability: ProviderConfigCapability, value: ProviderModelSelection | null) => void;
};

export function CapabilityRow({ capability, profiles, selection, onChange }: CapabilityRowProps) {
    const profileOptions = useMemo(() => profiles.filter((profile) => profileSupportsCapability(profile, capability.id)), [capability.id, profiles]);
    const [profileId, setProfileId] = useState(selection?.profileId || "");
    const [modelId, setModelId] = useState(selection?.modelId || "");
    const [browserOpen, setBrowserOpen] = useState(false);
    const userEditedRef = useRef(false);
    const { rememberModel } = useModelHistory(capability.id);
    const selectedProfile = profileOptions.find((profile) => profile.id === profileId);
    const saved = Boolean(selection?.profileId && selection.modelId.trim());
    const canBrowse = Boolean(selectedProfile?.providerId);

    useEffect(() => {
        setProfileId(selection?.profileId || profileOptions[0]?.id || "");
    }, [profileOptions, selection?.profileId]);

    useEffect(() => {
        setModelId(selection?.modelId || "");
    }, [selection?.modelId]);

    useEffect(() => {
        if (!userEditedRef.current) return;
        const timer = window.setTimeout(() => {
            const nextModel = modelId.trim();
            if (!nextModel) {
                if (selection) onChange(capability.id, null);
                userEditedRef.current = false;
                return;
            }
            if (!selectedProfile) return;
            if (selection?.profileId === selectedProfile.id && selection.modelId === nextModel) {
                userEditedRef.current = false;
                return;
            }
            rememberModel(nextModel);
            onChange(capability.id, { profileId: selectedProfile.id, modelId: nextModel });
            showFirstDefaultNotice(capability.id, capability.title);
            userEditedRef.current = false;
        }, 300);
        return () => window.clearTimeout(timer);
    }, [capability.id, capability.title, modelId, onChange, rememberModel, selectedProfile, selection]);

    const updateProfile = (nextProfileId: string) => {
        setProfileId(nextProfileId);
        const nextModel = modelId.trim();
        if (!nextModel) return;
        onChange(capability.id, { profileId: nextProfileId, modelId: nextModel });
        showFirstDefaultNotice(capability.id, capability.title);
    };

    const clear = () => {
        setModelId("");
        onChange(capability.id, null);
    };

    const selectModel = (nextModelId: string) => {
        setModelId(nextModelId);
        if (!selectedProfile) return;
        rememberModel(nextModelId);
        onChange(capability.id, { profileId: selectedProfile.id, modelId: nextModelId });
        showFirstDefaultNotice(capability.id, capability.title);
    };

    return (
        <div className="grid gap-3 border-t border-stone-200 px-4 py-4 first:border-t-0 dark:border-stone-800 md:grid-cols-[110px_minmax(180px,260px)_minmax(220px,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-center gap-2">
                <span className={`size-2.5 shrink-0 rounded-full border ${saved ? "border-emerald-500 bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-400 dark:bg-emerald-400" : "border-stone-400 bg-transparent dark:border-stone-500"}`} />
                <div className="min-w-0">
                    <div className="text-sm font-medium text-stone-950 dark:text-stone-100">{capability.title}</div>
                    <div className="mt-0.5 text-xs text-stone-400 md:hidden">{capability.description}</div>
                </div>
            </div>

            <label className="grid gap-1.5 md:block">
                <span className="text-xs font-medium text-stone-500 md:hidden">配置档</span>
                {profileOptions.length ? (
                    <Select value={selectedProfile?.id} onValueChange={updateProfile}>
                        <SelectTrigger className="h-9 w-full bg-white dark:bg-stone-900">
                            <SelectValue placeholder="选择配置档" />
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
                    <div className="rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-400 dark:border-stone-700">暂无支持该能力的配置档</div>
                )}
            </label>

            <label className="grid gap-1.5 md:block">
                <span className="text-xs font-medium text-stone-500 md:hidden">模型 ID</span>
                <Input
                    value={modelId}
                    placeholder="手动输入模型 ID"
                    disabled={!selectedProfile}
                    onChange={(event) => {
                        userEditedRef.current = true;
                        setModelId(event.target.value);
                    }}
                />
            </label>

            <div className="flex items-center gap-2 md:justify-end">
                <Tooltip color="#111827" title={<span className="text-xs font-medium text-white">获取模型</span>}>
                    <span>
                        <Button aria-label="获取模型" className="!flex size-8 items-center justify-center" disabled={!canBrowse} icon={<Search className="size-4" />} onClick={() => setBrowserOpen(true)} />
                    </span>
                </Tooltip>
                {saved ? (
                    <Tooltip color="#111827" title={<span className="text-xs font-medium text-white">清空</span>}>
                        <Button aria-label="清空" className="!flex size-8 items-center justify-center !border-red-200 !bg-red-50 !text-red-500 hover:!border-red-300 hover:!bg-red-100 dark:!border-red-900/40 dark:!bg-red-950/30 dark:!text-red-300" icon={<Trash2 className="size-4" />} onClick={clear} />
                    </Tooltip>
                ) : null}
            </div>

            <ModelBrowserDialog open={browserOpen} profileId={selectedProfile?.id} providerId={selectedProfile?.providerId} capability={capability.id} onSelect={selectModel} onClose={() => setBrowserOpen(false)} />
        </div>
    );
}

export function profileSupportsCapability(profile: ProviderProfile, capability: ProviderConfigCapability) {
    const manifest = providerManifest(profile.providerId);
    return Boolean(manifest?.capabilities.includes(capability as ProviderCapability));
}

export function profileLabel(profile: ProviderProfile) {
    return profile.name || "未命名配置档";
}

function providerManifest(providerId: string | undefined): ProviderManifest | undefined {
    if (!providerId) return undefined;
    return defaultProviderRegistry.get(providerId)?.manifest;
}

function showFirstDefaultNotice(capability: ProviderConfigCapability, title: string) {
    if (!markDefaultNoticeShown(capability)) return;
    message.success(`已为「${title}」启用服务配置档`);
}

function markDefaultNoticeShown(capability: ProviderConfigCapability) {
    if (typeof window === "undefined") return false;
    try {
        const raw = window.localStorage.getItem(DEFAULT_NOTICE_STORAGE_KEY);
        const parsed = JSON.parse(raw || "[]") as unknown;
        const shown = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        if (shown.includes(capability)) return false;
        window.localStorage.setItem(DEFAULT_NOTICE_STORAGE_KEY, JSON.stringify([...shown, capability]));
        return true;
    } catch {
        return false;
    }
}