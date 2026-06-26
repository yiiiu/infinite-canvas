"use client";

import { Button, Input } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AuthField, ProviderManifest } from "@/providers/core/types";
import type { ProviderProfile } from "@/providers/config";
import { ProfileField } from "./profile-field";
import { TestConnectionButton } from "./test-connection-button";

export type ProviderOption = {
    id: string;
    label: string;
    manifest: ProviderManifest;
};

export type ProfileFormValue = {
    name: string;
    providerId: string;
    auth: Record<string, string>;
    baseUrl?: string;
    apiKey?: string;
};

type ProfileFormProps = {
    profile?: ProviderProfile;
    profiles: readonly ProviderProfile[];
    providerOptions: readonly ProviderOption[];
    initialProviderId?: string;
    onSave: (value: ProfileFormValue) => void;
    onCancelCreate?: () => void;
};

export function ProfileForm({ profile, profiles, providerOptions, initialProviderId, onSave, onCancelCreate }: ProfileFormProps) {
    const firstProviderId = initialProviderId || providerOptions[0]?.id || "";
    const [providerId, setProviderId] = useState(profile?.providerId || firstProviderId);
    const [name, setName] = useState(profile?.name || "");
    const [auth, setAuth] = useState<Record<string, string>>({});
    const provider = useMemo(() => providerOptions.find((option) => option.id === providerId) || providerOptions[0], [providerId, providerOptions]);
    const fields = provider?.manifest.auth?.fields || [];
    const creating = !profile;

    useEffect(() => {
        const nextProviderId = profile?.providerId || firstProviderId;
        const nextProvider = providerOptions.find((option) => option.id === nextProviderId) || providerOptions[0];
        setProviderId(nextProviderId);
        setName(profile?.name || defaultProfileName(nextProvider?.label || "Provider", nextProviderId, profiles));
        setAuth(profileAuth(profile));
    }, [firstProviderId, profile, profiles, providerOptions]);

    const updateProvider = (nextProviderId: string) => {
        const nextProvider = providerOptions.find((option) => option.id === nextProviderId);
        setProviderId(nextProviderId);
        setAuth({});
        if (creating) setName(defaultProfileName(nextProvider?.label || "Provider", nextProviderId, profiles));
    };

    const updateAuth = (field: AuthField, value: string) => {
        setAuth((current) => ({ ...current, [field.key]: value }));
    };

    const canSave = Boolean(providerId && name.trim()) && fields.every((field) => !field.required || Boolean((auth[field.key] || "").trim()));

    const save = () => {
        const nextAuth = normalizeAuth(auth, fields);
        onSave({
            name: name.trim(),
            providerId,
            auth: nextAuth,
            baseUrl: nextAuth.baseUrl,
            apiKey: nextAuth.apiKey,
        });
    };

    if (!provider) {
        return <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-400 dark:border-stone-700">暂无可用服务商</div>;
    }

    return (
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <div className="border-b border-stone-200 px-5 py-4 dark:border-stone-800">
                <div className="text-base font-semibold text-stone-950 dark:text-stone-100">{creating ? "新增配置档" : "编辑配置档"}</div>
                <div className="mt-1 text-xs text-stone-400">连接信息只保存到配置档，默认模型请到“默认模型”页面选择</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid gap-4">
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium text-stone-700 dark:text-stone-200">服务商</span>
                        <Select value={providerId || undefined} onValueChange={updateProvider} disabled={!creating}>
                            <SelectTrigger className="h-9 w-full bg-white dark:bg-stone-900">
                                <SelectValue placeholder="选择服务商" />
                            </SelectTrigger>
                            <SelectContent>
                                {providerOptions.map((option) => (
                                    <SelectItem key={option.id} value={option.id}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>

                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium text-stone-700 dark:text-stone-200">显示名称</span>
                        <Input value={name} placeholder="例如 OpenAI Compatible 1" onChange={(event) => setName(event.target.value)} />
                    </label>

                    {fields.map((field) => (
                        <label key={field.key} className="grid gap-1.5 text-sm">
                            <span className="font-medium text-stone-700 dark:text-stone-200">
                                {field.label}
                                {field.required ? <span className="ml-1 text-red-500">*</span> : null}
                            </span>
                            <ProfileField field={field} value={auth[field.key] || ""} onChange={(value) => updateAuth(field, value)} />
                        </label>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-5 py-4 dark:border-stone-800">
                <TestConnectionButton providerId={providerId} auth={normalizeAuth(auth, fields)} />
                <div className="flex items-center gap-2">
                    {creating && onCancelCreate ? <Button onClick={onCancelCreate}>取消</Button> : null}
                    <Button type="primary" disabled={!canSave} onClick={save}>
                        保存
                    </Button>
                </div>
            </div>
        </div>
    );
}

function profileAuth(profile: ProviderProfile | undefined) {
    return {
        ...(profile?.auth || {}),
        ...(profile?.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        ...(profile?.apiKey ? { apiKey: profile.apiKey } : {}),
    };
}

function normalizeAuth(auth: Record<string, string>, fields: readonly AuthField[]) {
    return Object.fromEntries(fields.map((field) => [field.key, (auth[field.key] || "").trim()]).filter(([, value]) => value)) as Record<string, string>;
}

function defaultProfileName(providerLabel: string, providerId: string, profiles: readonly ProviderProfile[]) {
    const count = profiles.filter((profile) => profile.providerId === providerId).length + 1;
    return `${providerLabel} ${count}`;
}