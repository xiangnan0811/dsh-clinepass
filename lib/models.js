/**
 * Public model helpers. Capability policy lives in catalog.js and model-registry.js.
 */

export {
  CATALOG_VERIFIED_ON,
  DEFAULT_REQUEST_OUTPUT_BUDGET,
  TOKEN_UNIT,
} from './catalog.js'

export {
  assembleModels,
  findModel,
  formatModelContext,
  formatModelDescription,
  getActiveModelIds,
  getAllModels,
  getDefaultModelIds,
  isSupportedModel,
  isVisionModel,
  mergeDiscovered,
  migrateConfig,
  parsePlanIncludedModels,
  reasoningLevelsOf,
  selectedIds,
  upsertOverride,
} from './model-registry.js'

export { loadModelsDiskCache, saveModelsDiskCache } from './model-cache.js'

export const PROVIDER_ID = 'clinebot'
export const PROVIDER_DISPLAY_NAME = 'ClineBot (ClinePass)'
export const DEFAULT_MODEL_ID = 'cline-pass/deepseek-v4.1-flash'
