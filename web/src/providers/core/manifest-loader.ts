import { PROVIDER_CAPABILITIES, ProviderError, ProviderErrorCode, type JsonSchema, type JsonSchemaType, type JsonValue, type ProviderCapability, type ProviderManifest, type ProviderModel } from "./types";

const JSON_SCHEMA_TYPES = new Set<JsonSchemaType>(["string", "number", "integer", "boolean", "object", "array", "null"]);
const PROVIDER_CAPABILITY_SET = new Set<ProviderCapability>(PROVIDER_CAPABILITIES);

type ManifestError = {
    readonly path: string;
    readonly message: string;
};

export function validateProviderManifest(input: unknown): input is ProviderManifest {
    return collectManifestErrors(input).length === 0;
}

export function loadProviderManifest(input: unknown): ProviderManifest {
    const errors = collectManifestErrors(input);
    if (errors.length) {
        throw new ProviderError(ProviderErrorCode.InvalidManifest, `Provider manifest 不合法：${errors[0].path} ${errors[0].message}`, {
            details: { errors: errors.map((error) => `${error.path} ${error.message}`) },
        });
    }
    return input as ProviderManifest;
}

export function collectManifestErrors(input: unknown): readonly ManifestError[] {
    const errors: ManifestError[] = [];
    if (!isRecord(input)) {
        return [{ path: "manifest", message: "必须是对象" }];
    }

    assertNonEmptyString(input.id, "id", errors);
    assertNonEmptyString(input.name, "name", errors);
    assertNonEmptyString(input.version, "version", errors);
    assertCapabilityList(input.capabilities, "capabilities", errors);
    if (input.allowsCustomModels !== undefined && typeof input.allowsCustomModels !== "boolean") {
        errors.push({ path: "allowsCustomModels", message: "必须是布尔值" });
    }
    assertModels(input.models, input.capabilities, input.allowsCustomModels === true, errors);

    if (input.parameterSchemas !== undefined) {
        assertParameterSchemas(input.parameterSchemas, errors);
    }
    if (input.metadata !== undefined && !isJsonValue(input.metadata)) {
        errors.push({ path: "metadata", message: "必须是 JSON 对象" });
    }
    return errors;
}

function assertModels(models: unknown, manifestCapabilities: unknown, allowsCustomModels: boolean, errors: ManifestError[]) {
    if (models === undefined) {
        if (!allowsCustomModels) errors.push({ path: "models", message: "必须是非空数组" });
        return;
    }
    if (!Array.isArray(models) || (!allowsCustomModels && models.length === 0)) {
        errors.push({ path: "models", message: allowsCustomModels ? "必须是数组" : "必须是非空数组" });
        return;
    }

    const knownCapabilities = Array.isArray(manifestCapabilities) ? new Set(manifestCapabilities.filter(isProviderCapability)) : new Set<ProviderCapability>();
    const modelIds = new Set<string>();

    models.forEach((model, index) => {
        const path = `models.${index}`;
        if (!isRecord(model)) {
            errors.push({ path, message: "必须是对象" });
            return;
        }

        assertNonEmptyString(model.id, `${path}.id`, errors);
        if (typeof model.id === "string" && model.id.trim()) {
            if (modelIds.has(model.id)) errors.push({ path: `${path}.id`, message: "不能重复" });
            modelIds.add(model.id);
        }

        assertCapabilityList(model.capabilities, `${path}.capabilities`, errors);
        if (Array.isArray(model.capabilities)) {
            model.capabilities.filter(isProviderCapability).forEach((capability) => {
                if (knownCapabilities.size && !knownCapabilities.has(capability)) {
                    errors.push({ path: `${path}.capabilities`, message: `${capability} 未声明在 manifest capabilities 中` });
                }
            });
        }

        if (model.parameterSchema !== undefined) {
            assertJsonSchema(model.parameterSchema, `${path}.parameterSchema`, errors);
        }
    });
}

function assertParameterSchemas(value: unknown, errors: ManifestError[]) {
    if (!isRecord(value)) {
        errors.push({ path: "parameterSchemas", message: "必须是对象" });
        return;
    }

    Object.entries(value).forEach(([capability, schema]) => {
        if (!isProviderCapability(capability)) {
            errors.push({ path: `parameterSchemas.${capability}`, message: "能力类型不支持" });
            return;
        }
        assertJsonSchema(schema, `parameterSchemas.${capability}`, errors);
    });
}

function assertJsonSchema(schema: unknown, path: string, errors: ManifestError[]) {
    if (!isRecord(schema)) {
        errors.push({ path, message: "必须是对象" });
        return;
    }

    if (schema.type !== undefined) assertJsonSchemaType(schema.type, `${path}.type`, errors);
    if (schema.properties !== undefined) {
        if (!isRecord(schema.properties)) {
            errors.push({ path: `${path}.properties`, message: "必须是对象" });
        } else {
            Object.entries(schema.properties).forEach(([key, child]) => assertJsonSchema(child, `${path}.properties.${key}`, errors));
        }
    }
    if (schema.required !== undefined && !isStringArray(schema.required)) {
        errors.push({ path: `${path}.required`, message: "必须是字符串数组" });
    }
    if (schema.items !== undefined) {
        if (Array.isArray(schema.items)) schema.items.forEach((item, index) => assertJsonSchema(item, `${path}.items.${index}`, errors));
        else assertJsonSchema(schema.items, `${path}.items`, errors);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
        assertJsonSchema(schema.additionalProperties, `${path}.additionalProperties`, errors);
    }
    assertSchemaList(schema.oneOf, `${path}.oneOf`, errors);
    assertSchemaList(schema.anyOf, `${path}.anyOf`, errors);
    assertSchemaList(schema.allOf, `${path}.allOf`, errors);

    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.every(isJsonValue))) {
        errors.push({ path: `${path}.enum`, message: "必须是 JSON 值数组" });
    }
    if (schema.const !== undefined && !isJsonValue(schema.const)) {
        errors.push({ path: `${path}.const`, message: "必须是 JSON 值" });
    }
    if (schema.default !== undefined && !isJsonValue(schema.default)) {
        errors.push({ path: `${path}.default`, message: "必须是 JSON 值" });
    }
}

function assertSchemaList(value: unknown, path: string, errors: ManifestError[]) {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        errors.push({ path, message: "必须是数组" });
        return;
    }
    value.forEach((schema, index) => assertJsonSchema(schema, `${path}.${index}`, errors));
}

function assertJsonSchemaType(value: unknown, path: string, errors: ManifestError[]) {
    if (Array.isArray(value)) {
        if (!value.length || !value.every((item) => typeof item === "string" && JSON_SCHEMA_TYPES.has(item as JsonSchemaType))) {
            errors.push({ path, message: "包含不支持的 JSON Schema type" });
        }
        return;
    }
    if (typeof value !== "string" || !JSON_SCHEMA_TYPES.has(value as JsonSchemaType)) {
        errors.push({ path, message: "不是支持的 JSON Schema type" });
    }
}

function assertCapabilityList(value: unknown, path: string, errors: ManifestError[]) {
    if (!Array.isArray(value) || value.length === 0) {
        errors.push({ path, message: "必须是非空能力数组" });
        return;
    }
    const seen = new Set<ProviderCapability>();
    value.forEach((capability, index) => {
        if (!isProviderCapability(capability)) {
            errors.push({ path: `${path}.${index}`, message: "能力类型不支持" });
            return;
        }
        if (seen.has(capability)) errors.push({ path: `${path}.${index}`, message: "能力不能重复" });
        seen.add(capability);
    });
}

function assertNonEmptyString(value: unknown, path: string, errors: ManifestError[]) {
    if (typeof value !== "string" || !value.trim()) {
        errors.push({ path, message: "必须是非空字符串" });
    }
}

function isProviderCapability(value: unknown): value is ProviderCapability {
    return typeof value === "string" && PROVIDER_CAPABILITY_SET.has(value as ProviderCapability);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null) return true;
    if (["string", "number", "boolean"].includes(typeof value)) return typeof value !== "number" || Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (!isRecord(value)) return false;
    return Object.values(value).every(isJsonValue);
}

export type { JsonSchema, ProviderManifest, ProviderModel };