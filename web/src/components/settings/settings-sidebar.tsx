"use client";

import { cn } from "@/lib/utils";
import type { SettingsSection } from "./types";

type SettingsSidebarProps = {
    sections: readonly SettingsSection[];
    activeSectionId: string;
    onSelect: (sectionId: string) => void;
};

export function SettingsSidebar({ sections, activeSectionId, onSelect }: SettingsSidebarProps) {
    return (
        <aside className="bg-white p-3 dark:bg-stone-950">
            <div className="mb-3 px-2 text-xs font-medium text-stone-400">设置项</div>
            <nav className="space-y-1">
                {sections.map((section) => {
                    const active = section.id === activeSectionId;
                    return (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => onSelect(section.id)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <span className="inline-flex size-4 items-center justify-center">{section.icon}</span>
                            <span>{section.title}</span>
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
}