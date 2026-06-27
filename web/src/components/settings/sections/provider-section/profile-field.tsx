"use client";

import { Input } from "antd";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AuthField } from "@/providers/core/types";

type ProfileFieldProps = {
    field: AuthField;
    value: string;
    onChange: (value: string) => void;
    providerId?: string;
    allAuthValues?: Record<string, string>;
};

export function ProfileField({ field, value, onChange, providerId, allAuthValues }: ProfileFieldProps) {
    if (field.type === "password") {
        return <Input.Password value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />;
    }

    if (field.type === "textarea") {
        return <Input.TextArea value={value} placeholder={field.placeholder} autoSize={{ minRows: 3, maxRows: 6 }} onChange={(event) => onChange(event.target.value)} />;
    }

    if (field.type === "select") {
        return (
            <Select value={value || undefined} onValueChange={onChange}>
                <SelectTrigger className="h-8 w-full bg-white dark:bg-stone-900">
                    <SelectValue placeholder={field.placeholder || "请选择"} />
                </SelectTrigger>
                <SelectContent>
                    {(field.options || []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return <Input value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />;
}