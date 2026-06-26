import type { ComponentType, ReactNode } from "react";

export type SettingsSection = {
    id: string;
    title: string;
    icon: ReactNode;
    component: ComponentType;
};