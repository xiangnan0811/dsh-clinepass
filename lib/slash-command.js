import { publicConfig, parseConfig } from './config.js'
import { smokeMetrics } from './request-metrics.js'
import { upstreamPinFor } from './upstream-pin.js'
import { resolveActiveAccountKey, formatProgressBar, enqueuePlanWrite, noteUserWrite } from './provider-sync.js'
import {
  getAllModels,
  isSupportedModel,
  formatModelContext,
  DEFAULT_MODEL_ID,
} from './models.js'
import {
  isKnownAccountEnv,
  isRateLimitFailure,
} from './account-pool.js'
import {
  resolveAccountPool,
  rotateToNextAccount,
  probeHealth,
  smokeChat,
  fetchUsageLimits,
  recordSessionRequest,
  recentRequests,
  maskAccountEmail,
  clearUsageCache,
  clearProbeCache,
  usageCache,
  usageCacheKey,
  applyCatalogIdentity,
  sessionStats,
} from './cline-client.js'

const HINT = 'quota | usage | models | account | accounts | use <name|auto> | switch <name> | test [model] | ping [model|default] | rotate | stats | telemetry | cost | budget'

function commandText(invocation) {
  if (typeof invocation === 'string') return invocation
  return String(invocation?.rawInput || '')
}

function summaryLine(line) {
  const text = String(line || '').replace(/\s+/g, ' ').trim()
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`
}

function commandResult(text, kind = 'success') {
  const body = String(text || '').trim()
  if (kind === 'error') return { kind: 'error', text: body || 'ClinePass command failed.' }
  return { kind: 'success', text: body }
}

function pad(label, width = 16) {
  return `${label}:`.padEnd(width, ' ')
}

export function registerSlashCommand(ctx, { live, getSettingsApi, syncProviderState, recordMetrics, statistics, modelProbe, economy }) {
  if (typeof ctx?.inject !== 'function') return
  ctx.inject(['commands'], (cmdCtx) => {
    const commands = cmdCtx.commands
    if (typeof commands?.register !== 'function') return

    const executeCommand = async (rawArgs) => {
      const pub = publicConfig(live())
      const parts = String(rawArgs || '').trim().split(/\s+/)
      const subcmd = (parts[0] || 'quota').toLowerCase()
      const param = parts[1] || ''
      if (subcmd === 'cost' || subcmd === 'budget') {
        if (!economy) return commandResult('Cost estimates are unavailable.', 'error')
        const status = await economy.status()
        const amount = estimate => estimate.amount === null ? 'unknown' : estimate.amount.toFixed(6)
        return [`ClinePass local estimates (${status.currency}, current rates, UTC)`, `Day: ${amount(status.day)} / ${pub.dailyBudget || 'off'}`, `Month: ${amount(status.month)} / ${pub.monthlyBudget || 'off'}`, `Guard: ${status.blocked ? status.code : status.enabled ? 'ready' : 'off'}`, 'Reference estimates only: the ClinePass subscription does not bill per request.'].join('\n')
      }

      if (subcmd === 'stats' || subcmd === 'telemetry') {
        const data = await statistics?.query()
        if (!data?.available) return commandResult(data?.error || 'Statistics are unavailable in this host profile.', 'error')
        const total = data.summary
        const measured = (field) => {
          const value = total.measurements[field]
          return value.samples ? `${value.sum} (${value.samples}/${total.requests} measured)` : 'unknown'
        }
        return [summaryLine('ClinePass statistics · current profile · UTC dates'),
          `Requests: ${total.requests} · success ${total.success} · failed ${total.failure} · cancelled ${total.cancelled}`,
          `Transport attempts: ${total.attempts} · quota/rate-limit attempts ${total.rateLimits}`,
          `Uncached input: ${measured('inputTokens')} · output: ${measured('outputTokens')}`,
          `Cache read: ${measured('cacheReadTokens')} · cache write: ${measured('cacheWriteTokens')}`,
          `Reasoning (included in output): ${measured('reasoningTokens')} · total: ${measured('totalTokens')}`,
          ...(data.recent[0] ? [`Latest request: ${new Date(data.recent[0].completedAt).toLocaleString()} · ${data.recent[0].model} · ${data.recent[0].ok ? 'success' : 'failed'} · ${data.recent[0].latencyMs == null ? 'latency unknown' : `${data.recent[0].latencyMs} ms`}`] : []),
          ...data.grouped.model.map((row) => `Model ${row.value}: ${row.totals.requests} requests · ${row.totals.measurements.totalTokens.samples ? `${row.totals.measurements.totalTokens.sum} tokens (${row.totals.measurements.totalTokens.samples}/${row.totals.requests} measured)` : 'tokens unknown'}`),
          `Storage: ${data.persisted ? 'saved' : 'not fully saved'} · pending ${data.pendingRequests}`,
          ...(data.error ? [data.error] : []),
        ].join('\n')
      }

      if (subcmd === 'models') {
        const allModels = getAllModels(live())
        const enabled = new Set(pub.enabledModels || [])
        const lines = [
          summaryLine(`ClinePass models · ${enabled.size} of ${allModels.length} enabled`),
          '',
        ]
        for (const model of allModels) {
          const mark = enabled.has(model.id) ? 'on' : 'off'
          const input = model.input?.includes('image') ? 'image' : 'text'
          const efforts = Array.isArray(model.reasoningLevelIds) && model.reasoningLevelIds.length
            ? ` · reasoning ${model.reasoningLevelIds.join(', ')}`
            : ''
          const context = model.contextKnown ? `${formatModelContext(model.contextLength)} context` : 'context unknown'
          lines.push(`[${mark}] ${model.name}`)
          lines.push(`     ${model.id}`)
          lines.push(`     ${input} · ${context}${efforts}`)
        }
        return lines.join('\n')
      }

      if (subcmd === 'accounts' || subcmd === 'account') {
        const pool = await resolveAccountPool(ctx, live())
        const activeName = pub.activeAccount || pub.apiKeyEnv
        const configured = pool.filter((account) => account.present).length
        const lines = [
          summaryLine(`ClinePass accounts · ${configured} of ${pool.length} configured · active ${activeName}`),
          '',
          `${pad('Active')}${activeName}`,
          '',
        ]
        for (const account of pool) {
          const pin = account.isPinned ? ' pinned' : ''
          const state = account.present ? 'configured' : 'missing key'
          const cacheKey = usageCacheKey(pub.baseUrl, account.value)
          const cached = usageCache.get(cacheKey)?.data
          const usageInfo = cached?.windows?.fiveHour ? ` · 5h ${cached.windows.fiveHour.percentUsed}%` : ''
          lines.push(`${account.label} (${account.apiKeyEnv}): ${state}${pin}${usageInfo}`)
        }
        lines.push('', 'Switch: /cline switch <credential name>')
        return lines.join('\n')
      }

      if (subcmd === 'switch' || subcmd === 'use') {
        if (!param) return 'Name the credential: /cline switch <CLINEBOT_API_KEY_2>'
        const automatic = subcmd === 'use' && param === 'auto'
        if (!automatic && !isKnownAccountEnv(live(), param)) {
          return commandResult(`${param} is not a saved account. Use /cline accounts.`, 'error')
        }
        const settingsApi = getSettingsApi()
        if (!settingsApi?.replace) {
          return commandResult('Settings are not ready, so the active account was not changed.', 'error')
        }
        let next
        noteUserWrite()
        await enqueuePlanWrite(async () => {
          const curr = live()
          if (!automatic && !isKnownAccountEnv(curr, param)) return
          next = parseConfig(applyCatalogIdentity(curr, { ...curr, activeAccount: automatic ? '' : param }))
          await settingsApi.replace(next)
        })
        if (!next) return commandResult(`${param} is not a saved account. Use /cline accounts.`, 'error')
        clearUsageCache()
        clearProbeCache()
        const synced = await syncProviderState(next)
        if (synced?.ok === false) {
          return commandResult(`Active account is now ${param}, but the provider credential was not updated (${synced.error || 'no provider write'}).`, 'error')
        }
        return summaryLine(automatic ? 'Automatic account routing enabled.' : `Active account is now ${param}.`)
      }

      if (subcmd === 'rotate') {
        const before = live()
        const res = await rotateToNextAccount(ctx, before, 'slash_command', getSettingsApi(), live)
        if (res.rotated) {
          const synced = await syncProviderState(res.config || { ...live(), activeAccount: res.activeAccount })
          const providerEnv = synced?.written?.apiKeyEnv
          if (synced?.ok !== false && live().proxyEnabled) return summaryLine(`Rotated from ${res.previousAccount} to ${res.activeAccount}. The proxy's manual account pin is updated.`)
          if (synced?.ok !== false && synced?.written?.removed) return summaryLine(`Active account is now ${res.activeAccount}. No models are currently registered.`)
          if (synced?.ok !== false && providerEnv === res.activeAccount) {
            return summaryLine(`Rotated from ${res.previousAccount} to ${res.activeAccount}. Provider credential is ${providerEnv}.`)
          }
          return commandResult(`Settings now name ${res.activeAccount}, but the provider credential was not updated (${synced?.error || providerEnv || 'no provider write'}).`, 'error')
        }
        if (res.reason === 'failed_to_persist') {
          return commandResult(`Rotation skipped: ${res.message || 'settings were not updated'}.`, 'error')
        }
        return `Rotation skipped: ${res.message || 'no other configured account'}.`
      }

      if (subcmd === 'ping') {
        if (param) {
          if (!modelProbe) return commandResult('Native model probing is unavailable.', 'error')
          const result = await modelProbe.run(param === 'default' ? pub.defaultModel : param)
          return result.ok ? `Streaming probe: ${result.model}\nFirst model output: ${result.ttftMs} ms\nTotal: ${result.totalMs} ms\nThis checks one short request, not all model capabilities.` : commandResult(`Streaming probe failed: ${result.error}`, 'error')
        }
        const health = await probeHealth(pub.baseUrl, { bypassCache: true, timeoutMs: 5000 })
        if (health.ok) return summaryLine(`Cline API reachable at ${pub.baseUrl} (${health.latencyMs} ms, HTTP ${health.status}).`)
        return commandResult(`Cline API ping failed: ${health.error || 'host unreachable'}`, 'error')
      }

      if (subcmd === 'test' || subcmd === 'smoke') {
        if (param && !isSupportedModel(param, live())) {
          return commandResult(`Model ${param} is not recognized. Use /cline models.`, 'error')
        }
        const activeKey = await resolveActiveAccountKey(ctx, live())
        if (!activeKey.value) return commandResult('API key is not configured. Open Settings and save a ClinePass key.', 'error')
        const modelToTest = param || pub.defaultModel || DEFAULT_MODEL_ID
        await economy?.guard()
        const outcome = await smokeChat(pub.baseUrl, activeKey.value, {
          model: modelToTest,
          upstreamPin: upstreamPinFor(pub, modelToTest),
          timeoutMs: pub.smokeTimeoutMs,
        })
        void recordMetrics?.(smokeMetrics(outcome, { model: modelToTest, account: activeKey.apiKeyEnv || activeKey.envName, purpose: 'slash' }))
        recordSessionRequest({
          latencyMs: outcome.latencyMs,
          ok: outcome.ok,
          error: outcome.error,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
          model: modelToTest,
          reason: outcome.ok ? '' : 'smoke',
        })
        let failoverNotice = ''
        if (isRateLimitFailure({ status: outcome.status, message: outcome.error })) {
          const before = live()
          const failover = await rotateToNextAccount(ctx, before, 'smoke_429', getSettingsApi(), live)
          if (failover.rotated) {
            await syncProviderState(failover.config || { ...live(), activeAccount: failover.activeAccount })
            failoverNotice = `\nHTTP ${outcome.status}. Active account rotated to ${failover.activeAccount}.`
          }
        }
        if (outcome.ok) {
          return [
            summaryLine(`Smoke test passed: ${outcome.model}`),
            `${pad('Latency')}${outcome.latencyMs} ms`,
            `${pad('Tokens')}prompt ${outcome.promptTokens}, completion ${outcome.completionTokens}, total ${outcome.totalTokens}`,
            `${pad('Preview')}${outcome.preview || ''}`,
          ].join('\n')
        }
        return commandResult(`Smoke test failed: ${outcome.error} (HTTP ${outcome.status || 'timeout'})${failoverNotice}`, 'error')
      }

      const activeKey = await resolveActiveAccountKey(ctx, live())
      if (!activeKey.value) return commandResult('API key is not configured. Open Settings and save a ClinePass key.', 'error')
      const [health, usage] = await Promise.all([
        probeHealth(pub.baseUrl, { timeoutMs: 5000 }),
        fetchUsageLimits(pub.baseUrl, activeKey.value, { timeoutMs: 8000 }),
      ])
      const fiveHour = usage?.windows?.fiveHour
      const weekly = usage?.windows?.weekly
      const monthly = usage?.windows?.monthly
      const resetOf = (value) => value?.resetsAt ? new Date(value.resetsAt).toLocaleString() : 'n/a'
      const pct = (value) => typeof value?.percentUsed === 'number' ? `${value.percentUsed}%` : 'n/a'
      const plan = usage?.plan || 'ClinePass'
      const lines = [
        summaryLine(`${plan} · 5h ${pct(fiveHour)} · weekly ${pct(weekly)} · monthly ${pct(monthly)}`),
        '',
        `${pad('Plan')}${plan}`,
        `${pad('Active key')}${activeKey.apiKeyEnv || activeKey.envName || pub.apiKeyEnv} (${activeKey.source})`,
        `${pad('Default model')}${pub.defaultModel}`,
        `${pad('Host')}${health.ok ? `${health.latencyMs} ms` : 'unreachable'}`,
      ]
      const accountEmail = maskAccountEmail(usage?.user?.email)
      if (accountEmail) lines.push(`${pad('Account')}${accountEmail}`)
      if (usage?.canceledAt) {
        const when = new Date(usage.canceledAt)
        const label = Number.isNaN(when.getTime()) ? usage.canceledAt : when.toLocaleString()
        lines.push(`${pad('Cancellation')}${label}`)
      }
      if (usage?.cancelAtPeriodEnd) lines.push(`${pad('Cancellation')}at the end of the current period`)
      lines.push(
        '',
        `${pad('5-hour')}${formatProgressBar(fiveHour?.percentUsed)}  reset ${resetOf(fiveHour)}`,
        `${pad('Weekly')}${formatProgressBar(weekly?.percentUsed)}  reset ${resetOf(weekly)}`,
        `${pad('Monthly')}${monthly ? formatProgressBar(monthly.percentUsed) : 'n/a'}  reset ${resetOf(monthly)}`,
      )
      if (fiveHour?.percentUsed >= 95) lines.push('', '5-hour quota is at least 95% used.')
      else if (fiveHour?.percentUsed >= 80) lines.push('', `5-hour quota is ${fiveHour.percentUsed}% used.`)
      if (sessionStats.totalRequests > 0) {
        lines.push('', `Session checks: ${sessionStats.successfulRequests}/${sessionStats.totalRequests} succeeded, about ${sessionStats.totalTokensEst} tokens.`)
      }
      const recent = recentRequests(5)
      if (recent.length) {
        lines.push('', 'Recent requests:')
        for (const entry of recent) {
          const when = new Date(entry.at).toLocaleString()
          const bits = [when, entry.model || 'clinebot']
          if (!entry.ok && entry.reason) bits.push(entry.reason)
          if (entry.upstream) bits.push(entry.upstream)
          lines.push(bits.join(' · '))
        }
      }
      return lines.join('\n')
    }

    const handler = async (invocation) => {
      try {
        const outcome = await executeCommand(commandText(invocation))
        if (outcome && typeof outcome === 'object' && (outcome.kind === 'success' || outcome.kind === 'error')) {
          return outcome
        }
        return commandResult(outcome)
      } catch (err) {
        return commandResult(`ClinePass command failed: ${err?.message || err}`, 'error')
      }
    }

    let unregister = () => {}
    try {
      unregister = commands.register({
        definitionId: 'dsh-clinepass/cline',
        name: 'cline',
        description: 'ClinePass quota, models, accounts, and a connectivity check.',
        input: { hint: HINT },
        handler,
      }) || (() => {})
    } catch (err) {
      ctx?.logger?.warn?.(`[dsh-clinebot] /cline was not registered: ${err?.message || err}`)
      return
    }
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        try { unregister?.() } catch { /* already gone */ }
      }, 'dsh-clinebot: slash-command')
    }
  })
}
