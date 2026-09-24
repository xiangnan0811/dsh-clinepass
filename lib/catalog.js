/**
 * Maintained ClinePass catalog.
 *
 * The GitHub page
 * https://github.com/cline/cline/blob/main/docs/getting-started/clinepass.mdx
 * (read 2026-09-24) names some model ids and reference prices. It lists
 * cline-pass/deepseek-v4-flash and omits cline-pass/deepseek-v4.1-flash.
 * That page is not the live catalog. A standard ClinePass usage ledger dated
 * 2026-09-23 records cline-pass/deepseek-v4.1-flash, including inputs of about
 * 530k–545k tokens. api.cline.bot has no GET /models list; OpenAI-style
 * GET /api/v1/models returns 404. With a key, discovery reads
 * GET /users/me/plan and parses feature text. It does not read the usage ledger.
 *
 * Vendor facts for DeepSeek-V4.1-Flash / V4-Pro come from the DeepSeek API
 * docs fetched the same day:
 * https://api-docs.deepseek.com/quick_start/pricing
 * https://api-docs.deepseek.com/api/create-chat-completion
 * https://api-docs.deepseek.com/guides/thinking_mode
 * https://api-docs.deepseek.com/guides/vision
 * Token unit there is the model tokenizer token. "1M" context is recorded as
 * 1000000, matching both that prose and the pi-ai deepseek catalog shipped
 * with DSH 0.1.5-rc.2. "384K" output is the documented maximum 393216.
 * Those vendor ceilings are not ClinePass measurements.
 *
 * Other numeric vendor fields are copied from the first-party pi-ai catalogs
 * bundled with this DSH build (zai.json, xiaomi.json, minimax.json,
 * kimi-coding.json). They describe the vendor endpoint, not api.cline.bot.
 * Where that evidence is missing, the field stays unknown instead of reusing
 * the old plugin's uniform 200000/8192 placeholder.
 */

export const CATALOG_VERIFIED_ON = '2026-09-23'
export const TOKEN_UNIT = 'model tokens'

/**
 * Request budget sent as max_tokens. Distinct from output capability.
 * DeepSeek's own default is 8K when thinking is off, 64K when thinking is on,
 * and 128K at effort max, but this host always sends model.maxTokens.
 * 8192 stopped an isolated V4.1 Flash turn at outputTokens 8192 with
 * stopReason length. 64K matches the vendor thinking default and stays
 * below the 384K capability.
 */
export const DEFAULT_REQUEST_OUTPUT_BUDGET = 65536

/**
 * DSH 0.1.5-rc.2 / pi-ai always materializes some max token value
 * (`options.maxTokens ?? model.maxTokens`). Omitting the field is not
 * available on this host, so the request budget is explicit and small.
 * The vendor API's own omission default (8K non-thinking, 64K thinking,
 * 128K at max effort) is not something this stack can leave unset.
 */
export const REQUEST_BUDGET_NOTE =
  'DSH 0.1.5-rc.2 sends max_tokens from the configured request budget. The vendor maximum is not written into that field.'

/**
 * No `off` entry. On DSH 0.1.5-rc.2 an omitted effort and an explicit Off
 * reach pi-ai as the same missing reasoning option. Declaring `off` makes
 * that path send `thinking: {type: "disabled"}`, which is not the vendor
 * default (thinking on, effort high) and not the menu label "provider default".
 * Low, high, and max stay selectable. The composer default sends no thinking
 * override.
 */
const DEEPSEEK_REASONING = Object.freeze({
  low: 'low',
  high: 'high',
  max: 'max',
})

/** OpenAI `reasoning_effort` plus the vendor `max_tokens` field. No zai/deepseek thinking object. */
const EFFORT_MAX_TOKENS_COMPAT = Object.freeze({
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
})

const DEEPSEEK_COMPAT = Object.freeze({
  thinkingFormat: 'deepseek',
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
  requiresReasoningContentOnAssistantMessages: true,
  supportsDeveloperRole: false,
  supportsStore: false,
})

function entry(partial) {
  return Object.freeze({
    channelListed: true,
    contextWindow: null,
    outputCapability: null,
    vendorInput: ['text'],
    /** Effective image claim before a user override. */
    effectiveImage: false,
    reasoning: null,
    compat: null,
    applyReasoningByDefault: false,
    vendorReasoningNote: '',
    category: 'general',
    recommended: false,
    ...partial,
  })
}

export const CATALOG = Object.freeze([
  entry({
    id: 'cline-pass/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    channelListed: true,
    contextWindow: 1_000_000,
    outputCapability: 393_216,
    vendorInput: ['text', 'image'],
    effectiveImage: true,
    reasoning: DEEPSEEK_REASONING,
    compat: DEEPSEEK_COMPAT,
    applyReasoningByDefault: true,
    category: 'coding',
    recommended: true,
    aliases: [
      'deepseek v4.1 flash',
      'deepseek-v4.1-flash',
      'deepseek-v4.1 flash',
      'deepseek v41 flash',
    ],
    legacyIds: ['cline-pass/deepseek-v41-flash'],
    note: 'Official ClinePass usage on 2026-09-23 records this id on a standard subscription, including inputs of about 530k–545k tokens. The GitHub doc clinepass.mdx (main, read 2026-09-24) still names only cline-pass/deepseek-v4-flash. Image input and the 384K output cap remain DeepSeek vendor documentation; that usage page does not show them.',
  }),
  entry({
    id: 'cline-pass/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    outputCapability: 393_216,
    vendorInput: ['text', 'image'],
    effectiveImage: true,
    reasoning: DEEPSEEK_REASONING,
    compat: DEEPSEEK_COMPAT,
    applyReasoningByDefault: true,
    category: 'coding',
    recommended: true,
    aliases: ['deepseek v4 flash', 'deepseek-v4-flash', 'deepseek flash'],
    note: 'ClinePass id from clinepass.mdx. DeepSeek docs say the legacy API ids deepseek-v4-flash and deepseek-v4-flash-vision-exp are served by V4.1-Flash, which accepts images. Whether api.cline.bot does the same was not measured.',
  }),
  entry({
    id: 'cline-pass/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_000_000,
    outputCapability: 393_216,
    vendorInput: ['text'],
    effectiveImage: false,
    reasoning: DEEPSEEK_REASONING,
    compat: DEEPSEEK_COMPAT,
    applyReasoningByDefault: true,
    category: 'coding',
    recommended: true,
    aliases: ['deepseek v4 pro', 'deepseek-v4-pro'],
    note: 'Vendor vision is not supported. Context 1M and max output 384K are vendor facts. Channel limits were not measured. Reasoning levels follow the 2026-09-19 DeepSeek chat-completions enum (none/low/high/max), not the older pi-ai map that dropped low.',
  }),
  entry({
    id: 'cline-pass/glm-5.2',
    name: 'GLM 5.2',
    contextWindow: 1_000_000,
    outputCapability: 131_072,
    vendorInput: ['text'],
    category: 'general',
    aliases: ['glm 5.2', 'glm-5.2'],
    vendorReasoningNote: 'zai.json lists high and max, thinkingFormat zai, and max_tokens. The vendor override sends reasoning_effort with max_tokens. It does not send the zai thinking object, which this ClinePass route has not been shown to accept.',
    optionalReasoning: { high: 'high', max: 'max' },
    optionalCompat: EFFORT_MAX_TOKENS_COMPAT,
  }),
  entry({
    id: 'cline-pass/glm-5.3',
    name: 'GLM 5.3',
    contextWindow: 1_000_000,
    outputCapability: 131_072,
    vendorInput: ['text'],
    category: 'general',
    aliases: ['glm 5.3', 'glm-5.3'],
    vendorReasoningNote: 'zai.json lists low, high, and max. The vendor override sends those as reasoning_effort with max_tokens, not the zai thinking object.',
    optionalReasoning: { low: 'low', high: 'high', max: 'max' },
    optionalCompat: EFFORT_MAX_TOKENS_COMPAT,
  }),
  entry({
    id: 'cline-pass/kimi-k3',
    name: 'Kimi K3',
    contextWindow: 1_048_576,
    outputCapability: 131_072,
    vendorInput: ['text', 'image'],
    category: 'reasoning',
    recommended: true,
    aliases: ['kimi k3', 'kimi-k3'],
    vendorReasoningNote: 'kimi-coding.json k3 lists low, high, and max. The vendor override sends those as reasoning_effort with max_tokens. Image stays off until a user enables it. Channel vision was not measured.',
    optionalReasoning: { low: 'low', high: 'high', max: 'max' },
    optionalCompat: EFFORT_MAX_TOKENS_COMPAT,
  }),
  entry({
    id: 'cline-pass/kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    category: 'coding',
    aliases: ['kimi k2.7 code', 'kimi-k2.7-code', 'kimi k2.7-code'],
    vendorReasoningNote: 'Listed by Cline. A single vendor context/vision/reasoning record was not pinned, so those fields stay unknown.',
  }),
  entry({
    id: 'cline-pass/kimi-k2.6',
    name: 'Kimi K2.6',
    aliases: ['kimi k2.6', 'kimi-k2.6'],
    vendorReasoningNote: 'Listed by Cline. Vendor context, vision, and reasoning were not pinned to one first-party catalog row, so those fields stay unknown.',
  }),
  entry({
    id: 'cline-pass/mimo-v2.5',
    name: 'MiMo V2.5',
    contextWindow: 1_048_576,
    outputCapability: 131_072,
    vendorInput: ['text', 'image'],
    category: 'general',
    aliases: ['mimo v2.5', 'mimo-v2.5', 'xiaomi mimo v2.5'],
    vendorReasoningNote: 'xiaomi.json mimo-v2.5 has thinkingFormat deepseek and no effort list. This plugin does not invent a level, so the vendor override is not offered.',
  }),
  entry({
    id: 'cline-pass/mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    contextWindow: 1_048_576,
    outputCapability: 131_072,
    vendorInput: ['text'],
    category: 'coding',
    aliases: ['mimo v2.5 pro', 'mimo-v2.5-pro'],
    vendorReasoningNote: 'xiaomi.json mimo-v2.5-pro has thinkingFormat deepseek and no effort list. No reasoning control is offered.',
  }),
  entry({
    id: 'cline-pass/minimax-m3',
    name: 'MiniMax M3',
    contextWindow: 1_048_576,
    outputCapability: 512_000,
    vendorInput: ['text', 'image'],
    category: 'reasoning',
    aliases: ['minimax m3', 'minimax-m3', 'minimax-m3'],
    vendorReasoningNote: 'minimax.json MiniMax-M3 is an anthropic-messages model (image, 1048576 context, 512000 output). That protocol is not what api.cline.bot speaks. Image and reasoning stay off until a user override.',
  }),
  entry({
    id: 'cline-pass/qwen3.8-max',
    name: 'Qwen 3.8 Max',
    category: 'general',
    aliases: ['qwen3.8 max', 'qwen 3.8 max', 'qwen3.8-max'],
    vendorReasoningNote: 'Listed by Cline on 2026-09-23. No first-party context, vision, or reasoning record was verified, so those fields stay unknown.',
  }),
  entry({
    id: 'cline-pass/qwen3.7-max',
    name: 'Qwen 3.7 Max',
    category: 'multimodal',
    aliases: ['qwen3.7 max', 'qwen 3.7 max', 'qwen3.7-max'],
    vendorReasoningNote: 'Listed by Cline. Context, vision, and reasoning were not verified for the ClinePass slug.',
  }),
  entry({
    id: 'cline-pass/qwen3.7-plus',
    name: 'Qwen 3.7 Plus',
    category: 'multimodal',
    aliases: ['qwen3.7 plus', 'qwen 3.7 plus', 'qwen3.7-plus'],
    vendorReasoningNote: 'Listed by Cline. The pricing note about a 256K token tier is a price break, not a measured context window for this gateway.',
  }),
  entry({
    id: 'cline-pass/glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    contextWindow: 1_000_000,
    outputCapability: 131_072,
    vendorInput: ['text', 'image'],
    category: 'general',
    aliases: ['glm 5.3 flash', 'glm-5.3-flash', 'glm-5.3 flash'],
    vendorReasoningNote: 'zai.json glm-5.3-flash lists text and image, context 1000000, max output 131072, and levels low/high/max. Image stays off until a user enables it. The vendor override sends reasoning_effort and max_tokens, not the zai thinking object. A standard ClinePass plan returned this id on 2026-09-24.',
    optionalReasoning: { low: 'low', high: 'high', max: 'max' },
    optionalCompat: EFFORT_MAX_TOKENS_COMPAT,
  }),
  entry({
    id: 'cline-pass/muse-spark-1.3-contributor',
    name: 'Muse Spark 1.3 Contributor',
    category: 'general',
    aliases: ['muse spark 1.3 contributor', 'muse-spark-1.3-contributor'],
    vendorReasoningNote: 'A standard ClinePass plan returned this id on 2026-09-24. No vendor context, vision, or reasoning record was found, so those fields stay unknown.',
  }),
])

const BY_ID = new Map(CATALOG.map((model) => [model.id, model]))

const ALIAS = new Map()
for (const model of CATALOG) {
  ALIAS.set(normalizeAlias(model.name), model.id)
  ALIAS.set(normalizeAlias(model.id.replace(/^cline-pass\//, '')), model.id)
  for (const alias of model.aliases || []) ALIAS.set(normalizeAlias(alias), model.id)
}

const LEGACY = new Map()
for (const model of CATALOG) {
  for (const legacyId of model.legacyIds || []) LEGACY.set(legacyId, model.id)
}

export function normalizeAlias(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/(?<!\d)\.(?!\d)/gu, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function catalogById(id) {
  return BY_ID.get(id) || null
}

export function resolveAlias(name) {
  if (!name) return null
  return ALIAS.get(normalizeAlias(name)) || null
}

export function legacyTarget(id) {
  return LEGACY.get(id) || null
}

export function knownLegacyIds() {
  return [...LEGACY.keys()]
}

/**
 * Slug that keeps decimal points. "DeepSeek V4.1 Flash" → deepseek-v4.1-flash.
 * This is only a display id for an unknown plan name, not a capability claim.
 */
export function slugModelName(name) {
  return normalizeAlias(name).replace(/ /g, '-').replace(/^-|-$/g, '')
}
