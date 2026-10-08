import { describe, expect, it } from "vitest";
import {
  formatGatewaySyncDate,
  gatewayEndpointLabel,
  parseGatewayModelPayload,
} from "./model-gateway-payload";

describe("model gateway payload parsing", () => {
  it("accepts the gateway `{ data: [...] }` envelope", () => {
    expect(parseGatewayModelPayload({ data: ["gpt-5.6-sol", "claude-sonnet-4"] })).toEqual([
      "gpt-5.6-sol",
      "claude-sonnet-4",
    ]);
  });

  it("accepts a bare array payload", () => {
    expect(parseGatewayModelPayload(["kling-v2", "veo-3"])).toEqual(["kling-v2", "veo-3"]);
  });

  it("trims, de-duplicates and drops non-string entries", () => {
    expect(parseGatewayModelPayload({ data: [" model-a ", "model-a", "", 42, null, "model-b"] })).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  it("returns an empty list for payloads without model ids", () => {
    expect(parseGatewayModelPayload(null)).toEqual([]);
    expect(parseGatewayModelPayload({ message: "unauthorized" })).toEqual([]);
    expect(parseGatewayModelPayload({ data: {} })).toEqual([]);
  });
});

describe("model gateway endpoint labels", () => {
  it("labels the endpoint with host and path", () => {
    expect(gatewayEndpointLabel("https://quanzil.com/api/user/models")).toBe("quanzil.com/api/user/models");
    expect(gatewayEndpointLabel("https://quanzil.com/api/user/models/")).toBe("quanzil.com/api/user/models");
    expect(gatewayEndpointLabel("http://127.0.0.1:8080/v1/models")).toBe("127.0.0.1:8080/v1/models");
  });

  it("falls back to the raw value for invalid urls", () => {
    expect(gatewayEndpointLabel("not-a-url")).toBe("not-a-url");
  });
});

describe("model gateway sync dates", () => {
  it("formats a timestamp as a local calendar date", () => {
    const stamp = new Date(2026, 9, 8, 23, 30).getTime();
    expect(formatGatewaySyncDate(stamp)).toBe("2026-10-08");
  });
});
