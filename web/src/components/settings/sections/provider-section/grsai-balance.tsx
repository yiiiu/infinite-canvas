"use client";

import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";

import { cn } from "@/lib/utils";

type GrsaiBalanceProps = {
    apiKey: string;
    baseUrl?: string;
};

type BalanceState = {
    status: "idle" | "loading" | "success" | "error";
    credits?: number;
    error?: string;
};

const GRSAI_DEFAULT_BASE_URL = "https://grsai.dakka.com.cn";

export type GrsaiBalanceRef = {
    fetchBalance: () => Promise<number | null>;
};

export const GrsaiBalance = forwardRef<GrsaiBalanceRef, GrsaiBalanceProps>(({ apiKey, baseUrl }, ref) => {
    const [state, setState] = useState<BalanceState>({ status: "idle" });

    const fetchBalance = async (): Promise<number | null> => {
        if (!apiKey || !apiKey.trim()) {
            setState({ status: "idle" });
            return null;
        }

        setState({ status: "loading" });

        try {
            const url = `${(baseUrl || GRSAI_DEFAULT_BASE_URL).replace(/\/+$/, "")}/client/openapi/getAPIKeyCredits`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ apiKey: apiKey.trim() }),
            });

            const data = await response.json();

            if (data.code === 0 && typeof data.data?.credits === "number") {
                setState({ status: "success", credits: data.data.credits });
                return data.data.credits;
            } else {
                setState({ status: "error", error: data.msg || "获取余额失败" });
                return null;
            }
        } catch (error) {
            setState({ status: "error", error: error instanceof Error ? error.message : "网络错误" });
            return null;
        }
    };

    useImperativeHandle(ref, () => ({
        fetchBalance,
    }));

    if (state.status === "idle") {
        return null;
    }

    return (
        <div className="flex items-center gap-2 text-xs">
            {state.status === "loading" && (
                <span className="text-stone-400">
                    <RefreshCw className="inline size-3 animate-spin" /> 查询余额...
                </span>
            )}
            {state.status === "success" && (
                <>
                    <span className="text-emerald-600 dark:text-emerald-400">
                        余额: {state.credits?.toLocaleString()} credits
                    </span>
                    <Button
                        type="text"
                        size="small"
                        icon={<RefreshCw className="size-3" />}
                        className="!h-5 !px-1 text-stone-400 hover:!text-stone-600"
                        onClick={() => void fetchBalance()}
                    />
                </>
            )}
            {state.status === "error" && (
                <span className={cn("text-red-500 dark:text-red-400")} title={state.error}>
                    获取余额失败
                </span>
            )}
        </div>
    );
});

GrsaiBalance.displayName = "GrsaiBalance";
