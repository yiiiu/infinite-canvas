"use client";

import { Empty, Popconfirm, Switch } from "antd";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { defaultProviderRegistry } from "@/providers";
import type { ProviderProfile } from "@/providers/config";

type ProviderGroup = {
    providerId: string;
    label: string;
    profiles: ProviderProfile[];
};

type ProfileListProps = {
    groups: readonly ProviderGroup[];
    selectedProfileId: string;
    onCreate: (providerId?: string) => void;
    onSelect: (profileId: string) => void;
    onToggle: (profileId: string, enabled: boolean) => void;
    onDelete: (profileId: string) => void;
    onRefreshModels?: (profileId: string) => Promise<void> | void;
};

export function ProfileList({ groups, selectedProfileId, onCreate, onSelect, onToggle, onDelete, onRefreshModels }: ProfileListProps) {
    const empty = groups.length === 0;
    const [refreshingId, setRefreshingId] = useState("");

    const refreshModels = (profileId: string) => {
        if (!onRefreshModels) return;
        setRefreshingId(profileId);
        void Promise.resolve(onRefreshModels(profileId)).finally(() => setRefreshingId((current) => (current === profileId ? "" : current)));
    };

    return (
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                <div>
                    <div className="text-sm font-medium text-stone-950 dark:text-stone-100">配置档</div>
                    <div className="text-xs text-stone-400">按服务商分组</div>
                </div>
                <button type="button" onClick={() => onCreate()} className="inline-flex size-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white" aria-label="新增配置档" title="新增配置档">
                    <Plus className="size-4" />
                </button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto p-3 pr-2">
                {empty ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置档" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groups.map((group) => (
                            <section key={group.providerId} className="space-y-2">
                                <div className="px-1 text-xs font-medium text-stone-400">{group.label}</div>
                                {group.profiles.length ? group.profiles.map((profile) => {
                                    const active = profile.id === selectedProfileId;
                                    const enabled = profile.enabled !== false;
                                    const supportsModelList = Boolean(onRefreshModels && profile.providerId && defaultProviderRegistry.get(profile.providerId)?.listModels);
                                    return (
                                        <div key={profile.id} className={cn("rounded-lg border p-3 transition", active ? "border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-900" : "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900")}> 
                                            <button type="button" className="block w-full text-left" onClick={() => onSelect(profile.id)}>
                                                <div className="truncate text-sm font-medium text-stone-950 dark:text-stone-100">{profile.name}</div>
                                                <div className={cn("mt-1 truncate text-xs", enabled ? "text-emerald-500 dark:text-emerald-400" : "text-stone-400")}>{enabled ? "已启用" : "已禁用"}</div>
                                                {supportsModelList ? <div className={cn("mt-1 truncate text-xs", profile.modelsFetchError ? "text-red-500 dark:text-red-400" : "text-stone-400")}>{profileModelStatus(profile)}</div> : null}
                                            </button>
                                            <div className="mt-3 flex items-center justify-between gap-2">
                                                <Switch size="small" checked={enabled} className="[&.ant-switch-checked]:!bg-emerald-500 [&.ant-switch-checked:hover]:!bg-emerald-500 dark:[&.ant-switch-checked]:!bg-emerald-400 dark:[&.ant-switch-checked:hover]:!bg-emerald-400" onChange={(checked) => onToggle(profile.id, checked)} />
                                                <div className="flex items-center gap-1">
                                                    {supportsModelList ? (
                                                        <button type="button" className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-100" aria-label={`刷新 ${profile.name} 模型列表`} title="刷新模型列表" disabled={refreshingId === profile.id} onClick={() => refreshModels(profile.id)}>
                                                            <RefreshCw className={cn("size-3.5", refreshingId === profile.id && "animate-spin")} />
                                                        </button>
                                                    ) : null}
                                                    <Popconfirm title="删除配置档" description="删除后不可恢复，确认删除？" okText="删除" cancelText="取消" onConfirm={() => onDelete(profile.id)}>
                                                        <button type="button" className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`删除 ${profile.name}`}>
                                                            <Trash2 className="size-3.5" />
                                                        </button>
                                                    </Popconfirm>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <button type="button" className="block w-full rounded-lg border border-dashed border-stone-300 bg-white p-3 text-left text-sm text-stone-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:border-emerald-700/60 dark:hover:bg-emerald-950/20 dark:hover:text-emerald-300" onClick={() => onCreate(group.providerId)}>
                                        <div className="font-medium">未配置</div>
                                        <div className="mt-1 text-xs opacity-80">点击新增该服务商的配置档</div>
                                    </button>
                                )}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function profileModelStatus(profile: ProviderProfile) {
    if (profile.modelsFetchError) return `加载失败 · ${profile.modelsFetchError}`;
    if (!profile.modelsFetchedAt) return "未加载模型列表";
    return `${profile.cachedModels?.length || 0} 个模型 · 上次更新 ${formatTimeAgo(profile.modelsFetchedAt)}`;
}

function formatTimeAgo(timestamp: number) {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return new Date(timestamp).toISOString().slice(0, 10);
}
