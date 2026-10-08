/**
 * AI runtime (Model Gateway) public surface.
 *
 * Layering: contracts/capability/normalizers → adapters (protocols) → registry
 * (providers, endpoints, models, preferences) → router → `aiRuntime`.
 */
export * from "./contracts";
export {
  adapterFor,
  geminiAdapter,
  implementedProtocols,
  isProtocolImplemented,
  openAICompatibleAdapter,
} from "./adapters";
export type { AdapterChatOptions, AdapterChatResult, AdapterContext, ProtocolAdapter } from "./adapters";
export {
  capabilityFailureReasons,
  detectCapabilities,
  explainRequirement,
  mergeCapabilityRecords,
  missingCapabilities,
  modelTypeForCapabilities,
  requiredCapabilities,
  supportedCapabilities,
} from "./capability";
export type { CapabilityExplanation, CapabilityFailureReason } from "./capability";
export {
  normalizeGatewayModelIds,
  normalizeGeminiCatalog,
  normalizeOpenAICompatibleCatalog,
  normalizeOpenRouterCatalog,
} from "./normalizers";
export {
  ensureModelRuntimeSeeded,
  getRuntimeTotals,
  importLegacyAiSettings,
  listProviderViews,
  loadCallableModel,
  loadModelDefaults,
  loadPreferredProviderId,
  resolveRoute,
  setModelDefaultForCapability,
} from "./registry";
export type { LegacyAiImport, LegacyAiImportEntry, ProviderEndpointView, ProviderView, RouteResolution } from "./registry";
export {
  credentialKeyFingerprint,
  diagnoseCredentialFailure,
  forgetCredentialKeys,
  isCredentialFault,
  isFatalModelError,
  planCredentialKeys,
  rateLimitCooldownMs,
  reportCredentialKeyFailure,
  reportCredentialKeySuccess,
  resetCredentialKey,
  runWithCredentialKey,
  setCredentialKeyEnabled,
} from "./key-pool";
export type { CredentialKeyDiagnosis, CredentialKeyPlan, CredentialKeySelection, KeyedRunResult } from "./key-pool";
export { probeModelCapability, probeableCapabilities } from "./probe";
export { aiRuntime, chat, chatForIntent, chatStructured, generateImage } from "./runtime";
export type { StructuredChatRequest, StructuredChatResponse } from "./runtime";
export { discoverProviderCatalogs, fetchProviderCatalog, syncProviderCatalog } from "./sync";
export type { CatalogSyncResult } from "./sync";
