import path from "node:path";
import { z } from "zod";
import { createContentItem, updateContentItemImage } from "@/db/repository";
import { aiRuntime, type StructuredChatResponse } from "@/features/ai-runtime";
import { imagePromptSchema } from "@/lib/ai/schemas";
import { beginAiBudgetCall } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { artifactsRoot } from "@/lib/paths";
import { generateTopicPost } from "@/lib/scraper";
import { runSiteBrowserTool } from "@/lib/browser-preview";
import { generateImageFile as callImageGenerationEndpoint } from "./image-generation";
import { playwrightSessionManager } from "./playwright-session";
import { ToolRegistry } from "./tool-registry";

async function activePage(context: Parameters<typeof playwrightSessionManager.getPage>[0]) {
  const session = await playwrightSessionManager.getPage(context);
  return session.page;
}

function profileKeyForContext(accountId?: string) {
  return accountId || "default";
}

function needsApproval(permission: "auto" | "confirm") {
  return permission !== "auto";
}

export function createDefaultToolRegistry() {
  return new ToolRegistry()
    .register({
      name: "browser_open_page",
      description: "Open an HTTP(S) page in a local Playwright Chrome profile.",
      inputSchema: z.object({ url: z.string().url() }),
      outputSchema: z.object({ url: z.string(), title: z.string(), text: z.string() }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.browserStep),
      async execute(input, context) {
        const site = context.site;
        if (site) {
          const output = await runSiteBrowserTool(site, { name: "browser_goto", args: { url: input.url } });
          return { url: output.url, title: output.title, text: output.text };
        }
        const page = await activePage({
          profileKey: profileKeyForContext(context.site?.id),
          profilePath: context.profilePath,
          startUrl: input.url,
        });
        await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
        return { url: page.url(), title: await page.title().catch(() => ""), text: text.slice(0, 4000) };
      },
    })
    .register({
      name: "browser_click",
      description: "Click the first matching selector on the active local browser page.",
      inputSchema: z.object({
        selector: z.string().min(1),
        intent: z.string().optional(),
        isFinalPublish: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({ url: z.string(), clicked: z.boolean() }),
      requiresApproval: (input, context) =>
        needsApproval(input.isFinalPublish ? context.settings.agentPermissions.browserPostContent : context.settings.agentPermissions.browserStep),
      async execute(input, context) {
        const site = context.site;
        if (site) {
          const output = await runSiteBrowserTool(site, {
            name: "browser_click",
            args: { selector: input.selector },
          });
          return { url: output.url, clicked: true };
        }
        const page = await activePage({
          profileKey: profileKeyForContext(context.site?.id),
          profilePath: context.profilePath,
          startUrl: context.site?.url,
        });
        await page.locator(input.selector).first().click({ timeout: 15_000 });
        return { url: page.url(), clicked: true };
      },
    })
    .register({
      name: "browser_type",
      description: "Type or fill text into the first matching selector on the active local browser page.",
      inputSchema: z.object({
        selector: z.string().min(1),
        text: z.string(),
        clear: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({ url: z.string(), typed: z.boolean() }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.browserStep),
      async execute(input, context) {
        const site = context.site;
        if (site) {
          const output = await runSiteBrowserTool(site, {
            name: "browser_type",
            args: { selector: input.selector, text: input.text, clear: input.clear },
          });
          return { url: output.url, typed: true };
        }
        const page = await activePage({
          profileKey: profileKeyForContext(context.site?.id),
          profilePath: context.profilePath,
          startUrl: context.site?.url,
        });
        const locator = page.locator(input.selector).first();
        if (input.clear) {
          await locator.fill(input.text, { timeout: 15_000 });
        } else {
          await locator.type(input.text, { timeout: 15_000 });
        }
        return { url: page.url(), typed: true };
      },
    })
    .register({
      name: "browser_screenshot",
      description: "Capture a screenshot of the active local browser page.",
      inputSchema: z.object({ fullPage: z.boolean().optional().default(true) }),
      outputSchema: z.object({ url: z.string(), path: z.string() }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.browserStep),
      async execute(input, context) {
        const site = context.site;
        if (site) {
          const output = await runSiteBrowserTool(site, {
            name: "browser_screenshot",
            args: { fullPage: input.fullPage },
          }) as { url: string; path?: unknown };
          return { url: output.url, path: typeof output.path === "string" ? output.path : "" };
        }
        const page = await activePage({
          profileKey: profileKeyForContext(context.site?.id),
          profilePath: context.profilePath,
          startUrl: context.site?.url,
        });
        const filePath = path.join(artifactsRoot(), `${context.agentRunId}-browser.png`);
        await page.screenshot({ path: filePath, fullPage: input.fullPage });
        return { url: page.url(), path: filePath };
      },
    })
    .register({
      name: "generate_social_post_draft",
      description: "Generate a basic social post draft and store it as local content.",
      inputSchema: z.object({
        topic: z.string().min(1),
        prompt: z.string().optional().default(""),
        language: z.string().optional().default("Simplified Chinese"),
        maxWords: z.number().int().min(50).max(1000).optional().default(260),
      }),
      outputSchema: z.object({
        title: z.string(),
        body: z.string(),
        postReadyText: z.string(),
        itemId: z.string(),
        provider: z.string(),
        model: z.string(),
      }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.generatePostContent),
      async execute(input, context) {
        const generated = await generateTopicPost({
          topic: input.topic,
          prompt: [input.prompt, context.site ? `Target site: ${context.site.name} (${context.site.platform})` : ""]
            .filter(Boolean)
            .join("\n"),
          language: input.language,
          maxWords: input.maxWords,
          systemPrompt: context.systemPrompt,
        });
        const item = await createContentItem({
          title: generated.title,
          body: generated.body,
          postReadyText: generated.postReadyText,
          sourceUrls: [],
          metadata: {
            provider: generated.provider,
            model: generated.model,
            prompt: input.prompt,
            generationType: "local_agent_social_post",
          },
          status: "ready",
        });
        return { ...generated, itemId: item.id };
      },
    })
    .register({
      name: "generate_image_prompt",
      description: "Generate a production-ready image prompt for social content.",
      inputSchema: z.object({
        topic: z.string().min(1),
        style: z.string().optional().default(""),
        postContext: z.string().optional().default(""),
      }),
      outputSchema: z.object({ prompt: z.string(), provider: z.string(), model: z.string() }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.generateImage),
      async execute(input, context) {
        // CI-P7-01-04. The agent run that called the tool is the identity; the tool name is the
        // step. The ledger row is written here, before the registry turns a throw into a failed
        // tool call.
        const usageCall: AiUsageCallContext = {
          purpose: "agent-tool",
          runId: context.agentRunId,
          nodeId: "generate_image_prompt",
        };
        let response: StructuredChatResponse<typeof imagePromptSchema>;
        const promptText = [
          "Create one concise image generation prompt for a social media post.",
          "If post context is provided, the image must illustrate that post context and must not invent an unrelated scene.",
          "The prompt field must mention composition, subject, style, lighting, and aspect ratio.",
          `Topic: ${input.topic}`,
          input.postContext ? `Post context: ${input.postContext}` : "",
          input.style ? `Style: ${input.style}` : "",
        ].filter(Boolean).join("\n");

        // CI-P7-03. An agent's tool call is a model call like any other, so it asks the budget first -
        // and it asks it inside the tool, where the request is built, rather than once per agent run.
        // The gate measures the same text the request will carry. A refusal is thrown from here, before
        // the try below, so it writes no ledger row (nothing was sent) and the engine stops the run on
        // it instead of recording a failed tool call the next step would carry on from.
        const budget = await beginAiBudgetCall({
          identity: usageCall,
          purpose: usageCall.purpose,
          capabilities: ["chat"],
          inputText: promptText,
        });
        // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
        // was spent are compared by an id instead of correlated by purpose and time.
        usageCall.budgetReservationId = budget.reservationId ?? undefined;
        try {
          response = await aiRuntime.chatStructured({
            messages: [{ role: "user", content: promptText }],
            schema: imagePromptSchema,
            systemPrompt: context.systemPrompt,
          });
        } catch (error) {
          await recordAiUsageFailure(usageCall, error);
          throw error;
        } finally {
          await budget.release();
        }
        await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
        return { prompt: response.data.prompt.trim(), provider: response.providerId, model: response.model };
      },
    })
    .register({
      name: "generate_image_file",
      description: "Generate an image file through the configured local image provider.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        provider: z.enum(["gemini", "openai"]).optional(),
        contentItemId: z.string().optional(),
        imagePrompt: z.string().optional(),
      }),
      outputSchema: z.object({ path: z.string(), provider: z.string(), model: z.string() }),
      requiresApproval: (_input, context) => needsApproval(context.settings.agentPermissions.generateImage),
      async execute(input) {
        // C4: the content context the tool was given travels with the request, so the ledger row this
        // generation writes is attributable to that item; the association below is the item's own copy.
        const generated = await callImageGenerationEndpoint({
          prompt: input.prompt,
          provider: input.provider,
          contentItemId: input.contentItemId,
        });
        if (input.contentItemId) {
          await updateContentItemImage({
            itemId: input.contentItemId,
            imagePath: generated.path,
            imagePrompt: input.imagePrompt || input.prompt,
            provider: generated.provider,
            model: generated.model,
          });
        }
        return generated;
      },
    })
    .register({
      name: "threads_create_post",
      description: "Draft or publish a Threads post through the selected local browser profile.",
      inputSchema: z.object({
        text: z.string().min(1),
        imagePath: z.string().optional().default(""),
        publish: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({
        url: z.string(),
        drafted: z.boolean(),
        published: z.boolean(),
        text: z.string().optional(),
        loginRequired: z.boolean().optional(),
      }).passthrough(),
      requiresApproval: (input, context) =>
        needsApproval(input.publish ? context.settings.agentPermissions.browserPostContent : context.settings.agentPermissions.browserStep),
      async execute(input, context) {
        const site = context.site;
        if (!site) {
          throw new Error("Mention a Threads site with @ before creating a Threads post.");
        }
        const output = await runSiteBrowserTool(site, {
          name: "threads_create_post",
          args: input,
        }) as {
          url: string;
          drafted?: unknown;
          published?: unknown;
          text?: unknown;
          loginRequired?: unknown;
        };
        return {
          ...output,
          drafted: Boolean(output.drafted),
          published: Boolean(output.published),
          text: typeof output.text === "string" ? output.text : input.text,
          loginRequired: Boolean(output.loginRequired),
        };
      },
    })
    .register({
      name: "xiaohongshu_create_post",
      description:
        "Draft or publish a 小红书 (Xiaohongshu) post through the selected local browser profile.",
      inputSchema: z.object({
        title: z.string().min(1),
        text: z.string().optional().default(""),
        imagePath: z.string().optional().default(""),
        publish: z.boolean().optional().default(false),
      }),
      outputSchema: z
        .object({
          url: z.string(),
          drafted: z.boolean(),
          published: z.boolean(),
          title: z.string().optional(),
          text: z.string().optional(),
          loginRequired: z.boolean().optional(),
        })
        .passthrough(),
      requiresApproval: (input, context) =>
        needsApproval(
          input.publish
            ? context.settings.agentPermissions.browserPostContent
            : context.settings.agentPermissions.browserStep
        ),
      async execute(input, context) {
        const site = context.site;
        if (!site) {
          throw new Error("Mention a 小红书 site with @ before creating a post.");
        }
        const output = (await runSiteBrowserTool(site, {
          name: "xiaohongshu_create_post",
          args: input,
        })) as {
          url: string;
          drafted?: unknown;
          published?: unknown;
          title?: unknown;
          text?: unknown;
          loginRequired?: unknown;
        };
        return {
          ...output,
          drafted: Boolean(output.drafted),
          published: Boolean(output.published),
          title: typeof output.title === "string" ? output.title : input.title,
          text: typeof output.text === "string" ? output.text : input.text,
          loginRequired: Boolean(output.loginRequired),
        };
      },
    });
}
