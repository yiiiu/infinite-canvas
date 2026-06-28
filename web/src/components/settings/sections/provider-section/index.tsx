"use client";

import { Alert, App } from "antd";
import { ServerCog } from "lucide-react";
import { useMemo, useState } from "react";

import { defaultProviderRegistry } from "@/providers";
import { ProviderError, ProviderErrorCode } from "@/providers/core/types";
import { useProviderConfigStore, type ProviderProfile } from "@/providers/config";
import { ProfileForm, type ProfileFormValue, type ProviderOption } from "./profile-form";
import { ProfileList } from "./profile-list";

type ProviderGroup = {
    providerId: string;
    label: string;
    profiles: ProviderProfile[];
};

type ProviderSettingsSectionProps = {
    abortSignal?: AbortSignal;
};

export function ProviderSettingsSection({ abortSignal }: ProviderSettingsSectionProps) {
    const { message } = App.useApp();
    const profilesMap = useProviderConfigStore((state) => state.profiles);
    const createProfile = useProviderConfigStore((state) => state.createProfile);
    const updateProfile = useProviderConfigStore((state) => state.updateProfile);
    const setProfileEnabled = useProviderConfigStore((state) => state.setProfileEnabled);
    const removeProfile = useProviderConfigStore((state) => state.removeProfile);
    const syncProfileModels = useProviderConfigStore((state) => state.syncProfileModels);
    const [selectedProfileId, setSelectedProfileId] = useState("");
    const [creating, setCreating] = useState(false);
    const [creatingProviderId, setCreatingProviderId] = useState<string | undefined>(undefined);
    const profiles = useMemo(() => Object.values(profilesMap), [profilesMap]);
    const providerOptions = useMemo<ProviderOption[]>(
        () =>
            defaultProviderRegistry.list().map((adapter) => ({
                id: adapter.manifest.id,
                label: providerLabel(adapter.manifest.id, adapter.manifest.name),
                manifest: adapter.manifest,
            })),
        [],
    );
    const groups = useMemo(() => buildGroups(profiles, providerOptions), [profiles, providerOptions]);
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
    const activeProfile = creating ? undefined : selectedProfile || profiles[0];
    const formCreating = creating || !activeProfile;
    const activeKey = formCreating ? "new" : activeProfile.id;

    const startCreate = (providerId?: string) => {
        setCreating(true);
        setSelectedProfileId("");
        setCreatingProviderId(providerId);
    };

    const saveProfile = (value: ProfileFormValue) => {
        if (formCreating) {
            const profile = createProfile({ ...value, enabled: true, models: [] });
            setSelectedProfileId(profile.id);
            setCreating(false);
            setCreatingProviderId(undefined);
            return;
        }
        if (!activeProfile) return;
        updateProfile(activeProfile.id, value);
        setSelectedProfileId(activeProfile.id);
    };

    const deleteProfile = (profileId: string) => {
        removeProfile(profileId);
        if (selectedProfileId === profileId) setSelectedProfileId("");
    };

    const refreshProfileModels = async (profileId: string) => {
        try {
            const result = await syncProfileModels(profileId, abortSignal);
            message.success(`已同步 ${result.total} 个模型，新增 ${result.added} 个`);
        } catch (error) {
            if (isCanceledError(error)) return;
            message.error(error instanceof Error ? error.message : "同步模型失败");
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-lg font-semibold text-stone-950 dark:text-stone-100">
                        <ServerCog className="size-5" />
                        AI 服务商
                    </div>
                    <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">管理 Provider Profile，并在“默认模型”中按能力配置默认模型。</div>
                </div>
            </div>
            <Alert type="info" showIcon message="Profile 只保存连接信息" description="配置档仅保存 API Key、Base URL 等连接信息。模型选择在画布节点上进行。" />
            <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-4">
                <ProfileList groups={groups} selectedProfileId={activeProfile?.id || ""} onCreate={startCreate} onSelect={(id) => { setSelectedProfileId(id); setCreating(false); }} onToggle={setProfileEnabled} onDelete={deleteProfile} onRefreshModels={refreshProfileModels} />
                <ProfileForm key={activeKey} profile={activeProfile} profiles={profiles} providerOptions={providerOptions} initialProviderId={creatingProviderId} onSave={saveProfile} onCancelCreate={creating ? () => { setCreating(false); setCreatingProviderId(undefined); } : undefined} />
            </div>
        </div>
    );
}

function providerLabel(providerId: string, name: string) {
    return providerId === "openai-compat" ? "OpenAI Compatible" : name;
}

function buildGroups(profiles: readonly ProviderProfile[], providerOptions: readonly ProviderOption[]): ProviderGroup[] {
    const labels = new Map(providerOptions.map((option) => [option.id, option.label]));
    const providerIds = new Set([...providerOptions.map((option) => option.id), ...profiles.map((profile) => profile.providerId || "unknown")]);
    return Array.from(providerIds).map((providerId) => ({
        providerId,
        label: labels.get(providerId) || "未配置 Provider",
        profiles: profiles
            .filter((profile) => (profile.providerId || "unknown") === providerId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
}

function isCanceledError(error: unknown) {
    return (error instanceof ProviderError && error.code === ProviderErrorCode.Canceled) || (error instanceof DOMException && error.name === "AbortError");
}