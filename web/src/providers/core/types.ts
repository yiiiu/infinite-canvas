export const PROVIDER_CAPABILITIES = ["text", "image", "image-edit", "video", "audio"] as const;
export const PROVIDER_RESPONSE_MODES = ["sync", "async-pollable"] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export type ProviderResponseMode = (typeof PROVIDER_RESPONSE_MODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];

export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export type JsonSchema = {
    readonly type?: JsonSchemaType | readonly JsonSchemaType[];
    readonly title?: string;
    readonly description?: string;
    readonly default?: JsonValue;
    readonly enum?: readonly JsonValue[];
    readonly const?: JsonValue;
    readonly properties?: Readonly<Record<string, JsonSchema>>;
    readonly required?: readonly string[];
    readonly items?: JsonSchema | readonly JsonSchema[];
    readonly additionalProperties?: boolean | JsonSchema;
    readonly oneOf?: readonly JsonSchema[];
    readonly anyOf?: readonly JsonSchema[];
    readonly allOf?: readonly JsonSchema[];
};

export type ReferenceImageInput = {
    readonly url: string;
};

export type ProviderTaskContext = {
    readonly projectId: string;
    readonly nodeId: string;
    readonly referenceImageIds?: readonly string[];
    readonly recoverable?: boolean;
    readonly unrecoverableReason?: string;
};

export type ProviderTaskUpdate = {
    readonly runtimeTaskId?: string;
    readonly status?: "running" | "completed" | "failed";
    readonly message?: string;
    readonly progress?: number;
    readonly metadata?: JsonObject;
};

export type ProviderModel = {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly capabilities: readonly ProviderCapability[];
    readonly supportsReferenceImages?: boolean;
    readonly parameterSchema?: JsonSchema;
};

export type ProviderManifest = {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly homepage?: string;
    readonly responseMode: ProviderResponseMode;
    readonly capabilities: readonly ProviderCapability[];
    readonly allowsCustomModels?: boolean;
    readonly models?: readonly ProviderModel[];
    readonly parameterSchemas?: Partial<Record<ProviderCapability, JsonSchema>>;
    readonly metadata?: JsonObject;
};

export type GenerateRequest<TParams extends JsonObject = JsonObject> = {
    readonly capability: ProviderCapability;
    readonly modelId: string;
    readonly params: TParams;
    readonly signal: AbortSignal | undefined;
    readonly pendingId?: string;
    readonly taskContext?: ProviderTaskContext;
    readonly metadata?: JsonObject;
};

export type ProviderOutput =
    | { readonly type: "text"; readonly text: string; readonly metadata?: JsonObject }
    | { readonly type: "image"; readonly url?: string; readonly dataUrl?: string; readonly mimeType?: string; readonly metadata?: JsonObject }
    | { readonly type: "video"; readonly url?: string; readonly blob?: Blob; readonly mimeType?: string; readonly metadata?: JsonObject }
    | { readonly type: "audio"; readonly url?: string; readonly blob?: Blob; readonly mimeType?: string; readonly metadata?: JsonObject }
    | { readonly type: "json"; readonly value: JsonValue; readonly metadata?: JsonObject }
    | { readonly type: "file"; readonly url: string; readonly mimeType?: string; readonly metadata?: JsonObject };

export type GenerateResult = {
    readonly id?: string;
    readonly providerId: string;
    readonly capability: ProviderCapability;
    readonly modelId: string;
    readonly outputs: readonly ProviderOutput[];
    readonly usage?: {
        readonly inputTokens?: number;
        readonly outputTokens?: number;
        readonly totalTokens?: number;
    };
    readonly raw?: unknown;
    readonly metadata?: JsonObject;
};

export type ProviderFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type AdapterContext = {
    readonly fetch: ProviderFetch;
    readonly now: () => Date;
    readonly responseMode: ProviderResponseMode;
    readonly pendingId?: string;
    readonly updateTask?: (patch: ProviderTaskUpdate) => void | Promise<void>;
};

export type ProviderAdapter = {
    readonly manifest: ProviderManifest;
    generate<TParams extends JsonObject = JsonObject>(request: GenerateRequest<TParams>, context: AdapterContext): Promise<GenerateResult>;
};

export enum ProviderErrorCode {
    InvalidManifest = "invalid_manifest",
    DuplicateProvider = "duplicate_provider",
    ProviderNotFound = "provider_not_found",
    UnsupportedCapability = "unsupported_capability",
    ModelNotFound = "model_not_found",
    InvalidRequest = "invalid_request",
    Unauthorized = "unauthorized",
    RateLimited = "rate_limited",
    InsufficientBalance = "insufficient_balance",
    AdapterError = "adapter_error",
    NetworkError = "network_error",
    Canceled = "canceled",
    Timeout = "timeout",
}

export class ProviderError extends Error {
    readonly code: ProviderErrorCode;
    readonly details?: JsonObject;
    readonly cause?: unknown;

    constructor(code: ProviderErrorCode, message: string, options: { readonly details?: JsonObject; readonly cause?: unknown } = {}) {
        super(message);
        this.name = "ProviderError";
        this.code = code;
        this.details = options.details;
        this.cause = options.cause;
    }
}