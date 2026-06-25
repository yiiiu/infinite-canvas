import { NextRequest, NextResponse } from "next/server";

const STRIP_REQUEST_HEADERS = new Set([
    "host",
    "connection",
    "content-length",
    "accept-encoding",
    "origin",
    "referer",
    "x-forwarded-host",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-real-ip",
]);

const STRIP_RESPONSE_HEADERS = new Set([
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
]);

async function handleProxy(request: NextRequest) {
    const targetUrl = request.nextUrl.searchParams.get("url");
    if (!targetUrl) {
        return NextResponse.json({ error: "Missing target URL" }, { status: 400 });
    }

    try {
        const parsedUrl = new URL(targetUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            throw new Error("Invalid protocol");
        }
    } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const upstreamHeaders = new Headers();
    request.headers.forEach((value, key) => {
        if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
            upstreamHeaders.set(key, value);
        }
    });

    try {
        const upstreamResponse = await fetch(targetUrl, {
            method: request.method,
            headers: upstreamHeaders,
            body: request.method !== "GET" && request.method !== "HEAD" ? await request.blob() : undefined,
            redirect: "manual",
        });

        const responseHeaders = new Headers();
        upstreamResponse.headers.forEach((value, key) => {
            if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
                responseHeaders.set(key, value);
            }
        });

        return new NextResponse(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error("[Proxy] Upstream request failed:", error);
        return NextResponse.json(
            {
                error: "Upstream request failed",
                message: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 502 },
        );
    }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;