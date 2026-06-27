"use client";

import { Button, Tooltip } from "antd";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { useMemo, useState, type RefObject } from "react";

import { proxyFetch } from "@/providers/core/proxy-fetch";
import type { JsonObject } from "@/providers/core/types";
import { defaultProviderRegistry } from "@/providers";
import type { GrsaiBalanceRef } from "./grsai-balance";

type TestStatus =
    | { type: "idle" }
    | { type: "success"; message: string }
    | { type: "error"; message: string };

type TestConnectionButtonProps = {
    providerId: string;
    auth: Record<string, string>;
    grsaiBalanceRef?: RefObject<GrsaiBalanceRef>;
};

export function TestConnectionButton({ providerId, auth, grsaiBalanceRef }: TestConnectionButtonProps) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<TestStatus>({ type: "idle" });
    const adapter = useMemo(() => defaultProviderRegistry.get(providerId), [providerId]);
    const disabled = !adapter?.testConnection;

    const testConnection = async () => {
        if (!adapter?.testConnection) return;
        setLoading(true);
        setStatus({ type: "idle" });
        try {
            const result = await adapter.testConnection(
                { auth: auth as JsonObject },
                {
                    fetch: proxyFetch,
                    now: () => new Date(),
                    responseMode: adapter.manifest.responseMode,
                },
            );

            // 如果是 GrsAI，调用余额查询
            if (result.ok && grsaiBalanceRef?.current) {
                await grsaiBalanceRef.current.fetchBalance();
            }

            setStatus({ type: result.ok ? "success" : "error", message: result.ok ? "连接成功" : (result.message || "连接失败") });
        } catch (error) {
            setStatus({ type: "error", message: error instanceof Error ? error.message : "连接测试失败" });
        } finally {
            setLoading(false);
        }
    };

    const resultView = status.type === "idle" ? <span className="inline-flex items-center gap-1 text-stone-400"><CircleHelp className="size-3.5" />未测试</span> : status.type === "success" ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3.5" />{status.message}</span> : <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="size-3.5" />{status.message}</span>;

    return (
        <div className="flex items-center gap-3">
            <Tooltip title={disabled ? "当前 Provider 暂未实现连接测试" : undefined}>
                <Button type="default" size="small" loading={loading} disabled={disabled} onClick={testConnection}>
                    测试连接
                </Button>
            </Tooltip>
            <div className="min-w-0 truncate text-xs">{resultView}</div>
        </div>
    );
}