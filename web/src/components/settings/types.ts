import type { ComponentType, ReactNode } from "react";

export type SettingsSectionComponentProps = {
    abortSignal?: AbortSignal;
};

export type SettingsSection = {
    id: string;
    title: string;
    icon: ReactNode;
    component: ComponentType<SettingsSectionComponentProps>;
};