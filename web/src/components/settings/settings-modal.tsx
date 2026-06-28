"use client";

import { Modal } from "antd";
import { useEffect, useMemo, useState } from "react";

import { SettingsSidebar } from "./settings-sidebar";
import type { SettingsSection } from "./types";

type SettingsModalProps = {
    open: boolean;
    sections: readonly SettingsSection[];
    onOpenChange: (open: boolean) => void;
};

export function SettingsModal({ open, sections, onOpenChange }: SettingsModalProps) {
    const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || "");
    const abortController = useMemo(() => (open ? new AbortController() : null), [open]);
    const activeSection = useMemo(() => sections.find((section) => section.id === activeSectionId) || sections[0], [activeSectionId, sections]);
    const ActiveComponent = activeSection?.component;

    useEffect(() => {
        return () => abortController?.abort();
    }, [abortController]);

    const close = () => {
        abortController?.abort();
        onOpenChange(false);
    };

    return (
        <Modal title="设置" open={open} width={1120} centered footer={null} onCancel={close} destroyOnHidden>
            <div className="mt-2 grid h-[720px] max-h-[calc(100vh-120px)] min-h-[600px] grid-cols-[190px_minmax(0,1fr)] overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <SettingsSidebar sections={sections} activeSectionId={activeSection?.id || ""} onSelect={setActiveSectionId} />
                <div className="thin-scrollbar min-h-0 min-w-0 overflow-auto border-l border-stone-200 bg-stone-50/60 p-5 dark:border-stone-800 dark:bg-stone-950">
                    {ActiveComponent ? <ActiveComponent abortSignal={abortController?.signal} /> : null}
                </div>
            </div>
        </Modal>
    );
}