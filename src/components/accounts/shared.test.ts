import { describe, expect, it } from "vitest";
import {
  changeAccountFormPlatform,
  createEmptyAccountForm,
  defaultUrlForPlatform,
  platformOptions,
} from "./shared";

describe("account platform defaults", () => {
  it("provides a URL default for every platform", () => {
    for (const platform of platformOptions) {
      expect(defaultUrlForPlatform(platform)).toBeTypeOf("string");
    }
    expect(defaultUrlForPlatform("Threads")).toBe("https://www.threads.com/");
    expect(defaultUrlForPlatform("Other")).toBe("");
  });

  it("updates the URL for the add-account flow", () => {
    const form = { ...createEmptyAccountForm(), url: "https://custom.example/" };
    expect(changeAccountFormPlatform(form, "Instagram", true)).toMatchObject({
      platform: "Instagram",
      url: "https://www.instagram.com/",
    });
  });

  it("preserves a custom URL while editing an existing account", () => {
    const form = { ...createEmptyAccountForm(), url: "https://custom.example/" };
    expect(changeAccountFormPlatform(form, "LinkedIn", false)).toMatchObject({
      platform: "LinkedIn",
      url: "https://custom.example/",
    });
  });
});
