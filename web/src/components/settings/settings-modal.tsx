"use client";

import { Modal } from "antd";
import { useMemo, useState } from "react";

import { SettingsSidebar } from "./settings-sidebar";
import type { SettingsSection } from "./types";

type SettingsModalProps = {
    open: boolean;
    sections: readonly SettingsSection[];
    onOpenChange: (open: boolean) => void;
};

export function SettingsModal({ open, sections, onOpenChange }: SettingsModalProps) {
    const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || "");
    const activeSection = useMemo(() => sections.find((section) => section.id === activeSectionId) || sections[0], [activeSectionId, sections]);
    const ActiveComponent = activeSection?.component;

    return (
        <Modal title="设置" open={open} width={980} centered footer={null} onCancel={() => onOpenChange(false)} destroyOnHidden>
            <div className="mt-2 grid h-[640px] max-h-[calc(100vh-160px)] min-h-[560px] grid-cols-[180px_1fr] overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <SettingsSidebar sections={sections} activeSectionId={activeSection?.id || ""} onSelect={setActiveSectionId} />
                <div className="min-h-0 min-w-0 border-l border-stone-200 bg-stone-50/60 p-5 dark:border-stone-800 dark:bg-stone-950">
                    {ActiveComponent ? <ActiveComponent /> : null}
                </div>
            </div>
        </Modal>
    );
}