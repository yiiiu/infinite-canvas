"use client";

import { Button, Empty, Input, Modal, Spin } from "antd";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProviderConfigCapability } from "@/providers/config";
import type { ModelInfo } from "@/providers/core/types";
import { useModelList } from "./use-model-list";

type ModelBrowserDialogProps = {
    open: boolean;
    profileId?: string;
    providerId?: string;
    capability: ProviderConfigCapability;
    onSelect: (modelId: string) => void;
    onClose: () => void;
};

export function ModelBrowserDialog({ open, profileId, providerId, capability, onSelect, onClose }: ModelBrowserDialogProps) {
    const { models, source, loading, error, load, refetch } = useModelList(providerId, profileId);
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const filteredModels = useMemo(() => filterModels(modelsForCapability(models, capability), query), [capability, models, query]);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setSelectedId("");
        void load();
    }, [load, open]);

    const selectAndClose = (modelId: string) => {
        onSelect(modelId);
        onClose();
    };

    const confirm = () => {
        if (!selectedId) return;
        selectAndClose(selectedId);
    };

    return (
        <Modal title="浏览模型" open={open} width={720} centered destroyOnHidden onCancel={onClose} footer={null}>
            <div className="grid gap-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Input prefix={<Search className="size-4 text-stone-400" />} value={query} placeholder="搜索模型 ID 或名称" onChange={(event) => setQuery(event.target.value)} />
                    <div className="shrink-0 text-xs text-stone-400">
                        {loading ? "加载中..." : error ? "加载失败" : source ? `来源：${sourceLabel(source)}` : capabilityLabel(capability)}
                    </div>
                </div>

                <div className="min-h-[320px] rounded-xl border border-stone-200 bg-stone-50/60 p-2 dark:border-stone-800 dark:bg-stone-950/60">
                    {loading ? (
                        <div className="flex h-[320px] items-center justify-center">
                            <Spin tip="正在加载模型" />
                        </div>
                    ) : error ? (
                        <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-sm text-stone-500">
                            <div>加载失败：{error}</div>
                            <Button onClick={() => void refetch()}>重试</Button>
                        </div>
                    ) : models.length === 0 ? (
                        <div className="flex h-[320px] items-center justify-center">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 Provider 未声明模型，请手动输入" />
                        </div>
                    ) : filteredModels.length === 0 ? (
                        <div className="flex h-[320px] items-center justify-center">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模型" />
                        </div>
                    ) : (
                        <div className="max-h-[420px] overflow-y-auto pr-1">
                            <div className="grid gap-2">
                                {filteredModels.map((model) => (
                                    <ModelListItem key={model.id} model={model} source={source || "manifest"} selected={selectedId === model.id} onSelect={setSelectedId} onConfirm={selectAndClose} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={!selectedId} onClick={confirm}>选中并填入</Button>
                </div>
            </div>
        </Modal>
    );
}

type ModelListItemProps = {
    model: ModelInfo;
    source: "remote" | "manifest";
    selected: boolean;
    onSelect: (modelId: string) => void;
    onConfirm: (modelId: string) => void;
};

function ModelListItem({ model, source, selected, onSelect, onConfirm }: ModelListItemProps) {
    return (
        <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left transition ${selected ? "border-stone-900 bg-white shadow-sm dark:border-stone-100 dark:bg-stone-900" : "border-stone-200 bg-white/80 hover:border-stone-400 dark:border-stone-800 dark:bg-stone-900/80"}`}
            onClick={() => onSelect(model.id)}
            onDoubleClick={() => onConfirm(model.id)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-950 dark:text-stone-100">{model.id}</div>
                    {model.name ? <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{model.name}</div> : null}
                </div>
                <span className="rounded-full border border-stone-200 px-2 py-0.5 text-[11px] text-stone-400 dark:border-stone-700">{sourceLabel(source)}</span>
            </div>
        </button>
    );
}

function modelsForCapability(models: readonly ModelInfo[], capability: ProviderConfigCapability) {
    const matched = models.filter((model) => !model.capability || model.capability === capability || (capability === "image" && model.capability === "image-edit"));
    return Array.from(new Map(matched.map((model) => [model.id, model])).values());
}

function filterModels(models: readonly ModelInfo[], query: string) {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((model) => model.id.toLowerCase().includes(keyword) || (model.name || "").toLowerCase().includes(keyword));
}

function sourceLabel(source: "remote" | "manifest") {
    return source === "remote" ? "远程模型" : "内置模型";
}

function capabilityLabel(capability: ProviderConfigCapability) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频" }[capability];
}