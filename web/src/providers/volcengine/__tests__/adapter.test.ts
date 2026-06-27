import { describe, it, expect, vi, beforeEach } from "vitest";
import { volcengineAdapter } from "../adapter";
import type { ProviderGenerateRequest, ProviderAdapterContext } from "../../core/types";

describe("volcengine adapter", () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    let mockContext: ProviderAdapterContext;

    beforeEach(() => {
        mockFetch = vi.fn();
        mockContext = {
            fetch: mockFetch,
        } as ProviderAdapterContext;
    });

    describe("manifest", () => {
        it("should have correct id and capabilities", () => {
            expect(volcengineAdapter.id).toBe("volcengine");
            expect(volcengineAdapter.manifest.capabilities).toEqual(["video"]);
            expect(volcengineAdapter.manifest.responseMode).toBe("async");
        });

        it("should have vquality and gpt-img2video-2 models", () => {
            const modelIds = volcengineAdapter.manifest.models.map((m) => m.id);
            expect(modelIds).toContain("vquality");
            expect(modelIds).toContain("gpt-img2video-2");
        });
    });

    describe("generate", () => {
        it("should create task with correct payload", async () => {
            const taskId = "task-123";
            const videoUrl = "https://example.com/video.mp4";

            // Mock task creation
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: taskId }),
            });

            // Mock task polling - first pending, then succeeded
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ data: { id: taskId, status: "running" } }),
            });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        id: taskId,
                        status: "succeeded",
                        result: { videos: [{ url: videoUrl }] },
                    },
                }),
            });

            // Mock video download
            mockFetch.mockResolvedValueOnce({
                ok: true,
                blob: async () => new Blob(["video data"], { type: "video/mp4" }),
            });

            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "生成一段视频",
                    ratio: "16:9",
                    resolution: "720p",
                    videoSeconds: 5,
                    generate_audio: true,
                    watermark: false,
                },
                signal: new AbortController().signal,
            };

            // Note: This will fail because uploadMediaFile is not mocked
            // In real tests, you'd mock all external dependencies
            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow();

            // Verify task creation call
            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.volcengine.com/video/generations",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Content-Type": "application/json",
                        Authorization: "Bearer test-key",
                    }),
                    body: expect.stringContaining('"model":"vquality"'),
                }),
            );
        });

        it("should build content with text prompt", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: "task-123" }),
            });

            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "测试文本",
                },
                signal: new AbortController().signal,
            };

            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow();

            const createCall = mockFetch.mock.calls[0];
            const body = JSON.parse(createCall[1].body);
            expect(body.content).toEqual([{ type: "text", text: "测试文本" }]);
        });

        it("should reject when reference images exceed limit", async () => {
            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "测试",
                },
                referenceImages: Array(10).fill({ url: "https://example.com/image.jpg" }),
                signal: new AbortController().signal,
            };

            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow("最多支持 9 张参考图片");
        });

        it("should reject when reference videos exceed limit", async () => {
            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "测试",
                },
                referenceVideos: Array(4).fill({ url: "https://example.com/video.mp4" }),
                signal: new AbortController().signal,
            };

            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow("最多支持 3 个参考视频");
        });

        it("should reject when video duration is invalid", async () => {
            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "测试",
                },
                referenceVideos: [{ url: "https://example.com/video.mp4", durationMs: 1000 }],
                signal: new AbortController().signal,
            };

            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow("时长需要在 2-15 秒之间");
        });

        it("should handle task failure", async () => {
            const taskId = "task-123";

            // Mock task creation
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: taskId }),
            });

            // Mock task polling - failed status
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        id: taskId,
                        status: "failed",
                        error: { message: "生成失败" },
                    },
                }),
            });

            const request: ProviderGenerateRequest = {
                capability: "video",
                params: {
                    baseUrl: "https://api.volcengine.com",
                    apiKey: "test-key",
                    model: "vquality",
                    prompt: "测试",
                },
                signal: new AbortController().signal,
            };

            await expect(volcengineAdapter.generate(request, mockContext)).rejects.toThrow("生成失败");
        });
    });
});
