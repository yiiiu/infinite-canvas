"use client";

import { Empty } from "antd";
import { Boxes } from "lucide-react";
import { useMemo } from "react";

import { useProviderConfigStore } from "@/providers/config";
import { CapabilityRow, type CapabilityMeta } from "./capability-row";

const CAPABILITIES: readonly CapabilityMeta[] = [
    { id: "text", title: "文本", description: "画布助手和文本生成默认模型" },
    { id: "image", title: "图片", description: "文生图、图生图和参考图默认模型" },
    { id: "video", title: "视频", description: "视频生成默认模型" },
    { id: "audio", title: "音频", description: "语音生成默认模型" },
];

export function DefaultsSettingsSection() {
    const profilesMap = useProviderConfigStore((state) => state.profiles);
    const defaults = useProviderConfigStore((state) => state.defaults);
    const setDefault = useProviderConfigStore((state) => state.setDefault);
    const profiles = useMemo(() => Object.values(profilesMap).filter((profile) => profile.enabled !== false), [profilesMap]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-lg font-semibold text-stone-950 dark:text-stone-100">
                        <Boxes className="size-5" />
                        默认模型
                    </div>
                    <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">配置每个能力使用的服务配置档和模型。</div>
                </div>
            </div>

            {profiles.length ? (
                <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                    <div className="hidden grid-cols-[110px_minmax(180px,260px)_minmax(220px,1fr)_auto] gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium text-stone-500 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400 md:grid">
                        <div>能力</div>
                        <div>配置档</div>
                        <div>模型 ID</div>
                        <div className="text-right">操作</div>
                    </div>
                    {CAPABILITIES.map((capability) => (
                        <CapabilityRow key={capability.id} capability={capability} profiles={profiles} selection={defaults[capability.id]} onChange={setDefault} />
                    ))}
                </div>
            ) : (
                <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white dark:border-stone-800 dark:bg-stone-950">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先在 AI 服务商中新增并启用配置档" />
                </div>
            )}
        </div>
    );
}
