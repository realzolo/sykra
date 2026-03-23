export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: unknown };

export function asJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function asJsonArray(value: unknown): JsonArray | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value as JsonArray;
}
