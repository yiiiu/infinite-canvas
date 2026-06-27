"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, Square, Tag, X } from "lucide-react";
import { Button, Tooltip } from "antd";

import { NodeModelSelector } from "@/components/canvas/node-model-selector";
import { ModelPicker } from "@/components/model-picker";
import { useProviderConfigStore, type ProviderModelSelection, type ProviderProfile } from "@/providers/config";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageCountSelect, clampCanvasImageCount } from "./canvas-image-count-select";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onProviderOverrideChange: (nodeId: string, value: ProviderModelSelection) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    referencePicking?: boolean;
    onStartReferencePick?: (nodeId: string) => void;
    onRemoveReference?: (nodeId: string, referenceNodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onProviderOverrideChange, onGenerate, onStop, mentionReferences = [], referencePicking = false, onStartReferencePick, onRemoveReference, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const providerProfilesById = useProviderConfigStore((state) => state.profiles);
    const providerProfiles = useMemo(() => Object.values(providerProfilesById), [providerProfilesById]);
    const imageProviderIssue = mode === "image" ? providerOverrideIssue(node.providerOverride, providerProfiles) : null;
    const config = buildNodeConfig(globalConfig, node, mode);
    const imageCount = clampCanvasImageCount(config.count);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const credits = requestCreditCost({ channelMode: config.channelMode, model: config.model, count: mode === "image" ? imageCount : 1 });
    const imageReferences = useMemo(() => mentionReferences.filter((reference) => reference.kind === "image" && reference.previewUrl), [mentionReferences]);

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || imageProviderIssue) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    if (mode === "image") {
        return (
            <div
                className="w-[min(820px,calc(100vw-48px))] rounded-2xl border px-4 pb-3 pt-4 shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <div className="flex items-center gap-2">
                    <ImagePanelAction icon={<Tag className="size-4" />} title="标记" theme={theme} />
                    <ImageReferenceStrip references={imageReferences} active={referencePicking} theme={theme} onAdd={() => onStartReferencePick?.(node.id)} onRemove={(referenceNodeId) => onRemoveReference?.(node.id, referenceNodeId)} />
                </div>

                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar min-h-28 w-full resize-none border-0 bg-transparent px-0 py-5 text-base leading-7 outline-none placeholder:opacity-45"
                    style={{ color: theme.node.text }}
                    placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                />

                <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <CanvasPromptLibrary onSelect={updatePrompt} />
                        <NodeModelSelector capability="image" profiles={providerProfiles} value={node.providerOverride} onChange={(value) => onProviderOverrideChange(node.id, value)} compact />
                        <CanvasImageSettingsPopover
                            config={config}
                            placement="topLeft"
                            hideCount
                            buttonClassName="!h-9 !max-w-[220px] !justify-start !rounded-full !border-0 !px-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                            onMissingConfig={() => openConfigDialog(true)}
                            onOpenChange={onImageSettingsOpenChange}
                        />
                        <CanvasImageCountSelect value={imageCount} theme={theme} onChange={(count) => onConfigChange(node.id, { count })} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums" style={{ color: theme.node.muted }}>
                            <CreditSymbol />
                            {credits.toLocaleString()}
                        </span>
                        <Tooltip title={!isRunning && imageProviderIssue ? imageProviderIssue : undefined}>
                            <span className="shrink-0">
                                <Button
                                    type="primary"
                                    shape="circle"
                                    className="!h-10 !w-10 !min-w-10 shrink-0"
                                    danger={isRunning}
                                    disabled={!isRunning && (!prompt.trim() || Boolean(imageProviderIssue))}
                                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                                    aria-label={isRunning ? "停止生成" : "生成"}
                                    icon={isRunning ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                                />
                            </span>
                        </Tooltip>
                    </div>
                </div>
                {imageProviderIssue ? <div className="mt-2 px-1 text-xs text-red-500">{imageProviderIssue}</div> : null}
            </div>
        );
    }

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Tooltip title={!isRunning && imageProviderIssue ? imageProviderIssue : undefined}>
                    <span className="shrink-0">
                        <Button
                            type="primary"
                            className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                            danger={isRunning}
                            disabled={!isRunning && (!prompt.trim() || Boolean(imageProviderIssue))}
                            onClick={() => (isRunning ? onStop(node.id) : submit())}
                            aria-label={isRunning ? "停止生成" : "生成"}
                        >
                            <span className="flex items-center gap-1.5">
                                {isRunning ? (
                                    <>
                                        <LoaderCircle className="size-4 animate-spin" />
                                        <Square className="size-3.5 fill-current" />
                                        <span className="text-xs font-medium">停止</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                            <CreditSymbol />
                                            {credits.toLocaleString()}
                                        </span>
                                        <ArrowUp className="size-4" />
                                    </>
                                )}
                            </span>
                        </Button>
                    </span>
                </Tooltip>
            </div>
            {imageProviderIssue ? <div className="mt-1 px-1 text-xs text-red-500">{imageProviderIssue}</div> : null}
        </div>
    );
}

export function providerOverrideIssue(value: ProviderModelSelection | undefined, profiles: readonly ProviderProfile[]) {
    const profileId = value?.profileId?.trim();
    if (!profileId) return null;
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return "Profile 不存在";
    if (profile.enabled === false) return "Profile 已禁用，请重选";
    return null;
}

function ImagePanelAction({ icon, title, theme }: { icon: ReactNode; title: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <button type="button" className="flex h-14 min-w-16 flex-col items-center justify-center gap-1 rounded-xl border px-3 text-xs transition hover:opacity-80" style={{ borderColor: theme.node.stroke, color: theme.node.muted, background: "transparent" }}>
            {icon}
            <span>{title}</span>
        </button>
    );
}

function ImageReferenceStrip({ references, active, theme, onAdd, onRemove }: { references: CanvasResourceReference[]; active: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onAdd: () => void; onRemove: (referenceNodeId: string) => void }) {
    return (
        <div className="thin-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
            <button
                type="button"
                className="flex h-14 min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-3 text-xs transition hover:opacity-80"
                style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: active ? theme.node.text : theme.node.muted, background: active ? theme.toolbar.activeBg : "transparent" }}
                onClick={onAdd}
            >
                <span>参考</span>
            </button>
            {references.map((reference) => (
                <div key={reference.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={reference.title}>
                    <img src={reference.previewUrl} alt={reference.title} className="size-full object-cover" />
                    <span className="absolute bottom-1 left-1 max-w-[46px] truncate rounded-md px-1 py-0.5 text-[10px] font-medium text-white shadow" style={{ background: "rgba(0,0,0,.48)" }}>
                        {reference.label}
                    </span>
                    <button
                        type="button"
                        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-0 shadow-sm transition group-hover:opacity-100"
                        onClick={(event) => {
                            event.stopPropagation();
                            onRemove(reference.nodeId);
                        }}
                        aria-label="移除参考图"
                    >
                        <X className="size-3" />
                    </button>
                </div>
            ))}
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(mode === "image" ? clampCanvasImageCount(node.metadata?.count || globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count) : node.metadata?.count || globalConfig.count || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
