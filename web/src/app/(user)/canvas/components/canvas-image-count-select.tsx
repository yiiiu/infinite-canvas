"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";

const COUNT_OPTIONS = [1, 2, 3, 4] as const;

export function clampCanvasImageCount(value: unknown) {
    return Math.max(1, Math.min(4, Math.floor(Math.abs(Number(value)) || 1)));
}

export function CanvasImageCountSelect({
    value,
    theme,
    onChange,
    buttonClassName,
}: {
    value: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (count: number) => void;
    buttonClassName?: string;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const count = clampCanvasImageCount(value);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const closeByKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("pointerdown", close, true);
        window.addEventListener("keydown", closeByKey);
        return () => {
            window.removeEventListener("pointerdown", close, true);
            window.removeEventListener("keydown", closeByKey);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative inline-flex shrink-0">
            <button
                type="button"
                className={cn("inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium transition hover:opacity-85", buttonClassName)}
                style={{ background: theme.node.fill, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setOpen((next) => !next)}
            >
                {count}张
                <ChevronDown className="size-3 text-current opacity-60" />
            </button>
            {open ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 min-w-full overflow-hidden rounded-xl border py-1 shadow-2xl" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} onWheelCapture={(event) => event.stopPropagation()}>
                    {COUNT_OPTIONS.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-xs transition hover:opacity-80"
                            style={{ background: item === count ? theme.toolbar.activeBg : "transparent", color: item === count ? theme.node.text : theme.node.muted }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => {
                                onChange(item);
                                setOpen(false);
                            }}
                        >
                            {item}张
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}