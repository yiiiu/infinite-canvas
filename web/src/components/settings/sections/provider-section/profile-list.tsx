"use client";

import { Empty, Popconfirm, Switch } from "antd";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProviderProfile } from "@/providers/config";

type ProviderGroup = {
    providerId: string;
    label: string;
    profiles: ProviderProfile[];
};

type ProfileListProps = {
    groups: readonly ProviderGroup[];
    selectedProfileId: string;
    onCreate: () => void;
    onSelect: (profileId: string) => void;
    onToggle: (profileId: string, enabled: boolean) => void;
    onDelete: (profileId: string) => void;
};

export function ProfileList({ groups, selectedProfileId, onCreate, onSelect, onToggle, onDelete }: ProfileListProps) {
    const empty = groups.every((group) => group.profiles.length === 0);

    return (
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                <div>
                    <div className="text-sm font-medium text-stone-950 dark:text-stone-100">Profile</div>
                    <div className="text-xs text-stone-400">按 Provider 分组</div>
                </div>
                <button type="button" onClick={onCreate} className="inline-flex size-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white" aria-label="新增 Profile" title="新增 Profile">
                    <Plus className="size-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {empty ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Profile" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groups.map((group) => (
                            <section key={group.providerId} className="space-y-2">
                                <div className="px-1 text-xs font-medium text-stone-400">{group.label}</div>
                                {group.profiles.map((profile) => {
                                    const active = profile.id === selectedProfileId;
                                    const enabled = profile.enabled !== false;
                                    return (
                                        <div key={profile.id} className={cn("rounded-lg border p-3 transition", active ? "border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-900" : "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900")}> 
                                            <button type="button" className="block w-full text-left" onClick={() => onSelect(profile.id)}>
                                                <div className="truncate text-sm font-medium text-stone-950 dark:text-stone-100">{profile.name}</div>
                                                <div className="mt-1 truncate text-xs text-stone-400">{enabled ? "已启用" : "已禁用"}</div>
                                            </button>
                                            <div className="mt-3 flex items-center justify-between gap-2">
                                                <Switch size="small" checked={enabled} onChange={(checked) => onToggle(profile.id, checked)} />
                                                <Popconfirm title="删除 Profile" description="删除后不可恢复，确认删除？" okText="删除" cancelText="取消" onConfirm={() => onDelete(profile.id)}>
                                                    <button type="button" className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`删除 ${profile.name}`}>
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </Popconfirm>
                                            </div>
                                        </div>
                                    );
                                })}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}