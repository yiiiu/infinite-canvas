"use client";

import type { ReactNode } from "react";
import { Segmented, Switch } from "antd";
import { CircleDot, Grid2x2, Moon, Square, Sun } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasAppearanceSettingsSectionProps = {
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
};

export function CanvasAppearanceSettingsSection({ backgroundMode, showImageInfo, onBackgroundModeChange, onShowImageInfoChange }: CanvasAppearanceSettingsSectionProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];

    return (
        <div className="space-y-7">
            <section>
                <h3 className="text-xl font-semibold text-stone-950 dark:text-stone-100">界面外观</h3>
                <div className="mt-5 divide-y divide-stone-200 dark:divide-stone-800">
                    <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,200px)] md:items-center">
                        <div>
                            <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">应用主题</div>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">切换画布整体明暗外观</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 rounded-xl p-1" style={{ background: theme.toolbar.itemHover }}>
                            <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                                <Sun className="size-3.5" />
                                浅色
                            </CanvasThemeButton>
                            <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                                <Moon className="size-3.5" />
                                深色
                            </CanvasThemeButton>
                        </div>
                    </div>

                    <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,200px)] md:items-center">
                        <div>
                            <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">画布网格</div>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">控制画布背景网格样式</p>
                        </div>
                        <Segmented
                            className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-7 [&_.ant-segmented-item-label]:!text-xs [&_.ant-segmented-item-label]:!leading-7"
                            value={backgroundMode}
                            onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                            options={[
                                {
                                    value: "dots",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <CircleDot className="size-3.5" />点
                                        </span>
                                    ),
                                },
                                {
                                    value: "lines",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Grid2x2 className="size-3.5" />线
                                        </span>
                                    ),
                                },
                                {
                                    value: "blank",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Square className="size-3.5" />空白
                                        </span>
                                    ),
                                },
                            ]}
                        />
                    </div>

                    <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,200px)] md:items-center">
                        <div>
                            <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">图片信息</div>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">控制图片节点信息显示</p>
                        </div>
                        <div className="flex justify-end">
                            <Switch size="small" checked={showImageInfo} className="[&.ant-switch-checked]:!bg-emerald-500 [&.ant-switch-checked:hover]:!bg-emerald-500 dark:[&.ant-switch-checked]:!bg-emerald-400 dark:[&.ant-switch-checked:hover]:!bg-emerald-400" onChange={onShowImageInfoChange} />
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-xs transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
            title={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}