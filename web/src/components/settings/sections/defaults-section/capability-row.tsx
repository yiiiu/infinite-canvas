"use client";

import { Button, message } from "antd";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultProviderRegistry } from "@/providers";
import type { ProviderCapability, ProviderManifest } from "@/providers/core/types";
import type { ProviderConfigCapability, ProviderModelSelection, ProviderProfile } from "@/providers/config";
import { ModelPicker } from "./model-picker";

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
    const fallbackProfileId = profileOptions[0]?.id || "";
    const selectedProfileId = selection?.profileId && profileOptions.some((profile) => profile.id === selection.profileId) ? selection.profileId : fallbackProfileId;
    const [profileId, setProfileId] = useState(selectedProfileId);
    const [modelId, setModelId] = useState(selection?.modelId || "");
    const selectedProfile = profileOptions.find((profile) => profile.id === profileId);
    const saved = Boolean(selection?.profileId && selection.modelId.trim());

    useEffect(() => {
        setProfileId(selectedProfileId);
    }, [selectedProfileId]);

    useEffect(() => {
        setModelId(selection?.modelId || "");
    }, [selection?.modelId]);

    const save = (nextProfileId: string, nextModelId: string) => {
        const normalizedModelId = nextModelId.trim();
        if (!nextProfileId || !normalizedModelId) return;
        onChange(capability.id, { profileId: nextProfileId, modelId: normalizedModelId });
        showFirstDefaultNotice(capability.id, capability.title);
    };

    const updateProfile = (nextProfileId: string) => {
        setProfileId(nextProfileId);
        save(nextProfileId, modelId);
    };

    const updateModel = (nextModelId: string) => {
        setModelId(nextModelId);
        save(profileId, nextModelId);
    };

    const clear = () => {
        setModelId("");
        onChange(capability.id, null);
    };

    return (
        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <span className={`mt-0.5 size-2.5 shrink-0 rounded-full border ${saved ? "border-emerald-500 bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-400 dark:bg-emerald-400" : "border-stone-400 bg-transparent dark:border-stone-500"}`} aria-label={saved ? "已配置" : "未配置"} />
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-950 dark:text-stone-100">{capability.title}</div>
                        <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{capability.description}</div>
                    </div>
                </div>
                {saved && (
                    <Button
                        aria-label="清空"
                        className="!flex size-8 shrink-0 items-center justify-center !border-red-200 !bg-red-50 !text-red-500 hover:!border-red-300 hover:!bg-red-100 dark:!border-red-900/40 dark:!bg-red-950/30 dark:!text-red-300"
                        icon={<Trash2 className="size-4" />}
                        onClick={clear}
                    />
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-stone-500 dark:text-stone-400">配置档</span>
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

                <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-stone-500 dark:text-stone-400">模型</span>
                    <ModelPicker profileId={selectedProfile?.id || ""} providerId={selectedProfile?.providerId} capability={capability.id} value={modelId} onChange={updateModel} />
                </label>
            </div>
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
    message.success(`已为「${title}」启用 Provider Profile 配置`);
}

function markDefaultNoticeShown(capability: ProviderConfigCapability) {
    if (typeof window === "undefined") return false;
    try {
        const key = `${DEFAULT_NOTICE_STORAGE_KEY}:${capability}`;
        if (window.localStorage.getItem(key)) return false;
        window.localStorage.setItem(key, "1");
        return true;
    } catch {
        return false;
    }
}