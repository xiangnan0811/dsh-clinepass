function smokeChoices(models, config) {
  const all = Array.isArray(models) ? models : []
  const enabled = new Set(config?.enabledModels || [])
  const chosen = enabled.size ? all.filter((model) => enabled.has(model.id)) : all
  return chosen.length ? chosen : all
}

function pickSmokeModel(config, models) {
  const ids = models.map((model) => model.id)
  const preferred = config?.defaultModel || ''
  if (preferred && ids.includes(preferred)) return preferred
  if (ids.includes('cline-pass/deepseek-v4.1-flash')) return 'cline-pass/deepseek-v4.1-flash'
  return ids[0] || ''
}

function SettingsPage(props) {
  const t = props?.t || makeT(en, en)
  const scope = props?.scope || null
  const scopeError = props?.scopeError || ''

  const subscribe = React.useMemo(() => {
    return (cb) => {
      if (!scope?.subscribe) return () => {}
      try {
        return scope.subscribe(cb) || (() => {})
      } catch (_) {
        return () => {}
      }
    }
  }, [scope])

  const getSnapshot = React.useCallback(() => {
    if (!scope?.getSnapshot) return SNAPSHOT_LOADING
    try {
      return scope.getSnapshot() || SNAPSHOT_LOADING
    } catch (_) {
      return SNAPSHOT_LOADING
    }
  }, [scope])

  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    React.useCallback(() => SNAPSHOT_LOADING, [])
  )
  const snapshotStatus = snapshot?.status || 'loading'

  const [status, setStatus] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [busy, setBusy] = React.useState('')
  const [err, setErr] = React.useState('')
  const [msg, setMsg] = React.useState('')
  const [smokeResult, setSmokeResult] = React.useState(null)
  const [smokeModel, setSmokeModel] = React.useState('')

  // Plugin in-app updater state
  const [updateState, setUpdateState] = React.useState({
    checking: false,
    updating: false,
    currentVersion: '',
    latestVersion: '',
    updateAvailable: false,
    canAutoUpdate: true,
    error: '',
    notice: '',
  })

  // Key input state
  const [apiKeyInput, setApiKeyInput] = React.useState('')
  const [baseUrlInput, setBaseUrlInput] = React.useState('')
  const [showKey, setShowKey] = React.useState(false)

  // Accounts state
  const [newAccountLabel, setNewAccountLabel] = React.useState('')
  const [newAccountEnv, setNewAccountEnv] = React.useState('')
  const [showAddAccount, setShowAddAccount] = React.useState(false)

  // Filter & Search for Models
  const [modelsFilter, setModelsFilter] = React.useState('all')
  const [modelsSearch, setModelsSearch] = React.useState('')
  const [disabledModels, setDisabledModels] = React.useState([])
  const [advancedOpen, setAdvancedOpen] = React.useState(false)

  // Loopback fast login state
  const [fastLoginActive, setFastLoginActive] = React.useState(false)
  const [fastLoginNotice, setFastLoginNotice] = React.useState('')

  React.useEffect(() => {
    ensureCss()
  }, [])

  const load = React.useCallback(async () => {
    setErr('')
    const res = await fetch(`${ROUTE_PREFIX}/status`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    setStatus(data)
    setDraft(data.config || {})
    setBaseUrlInput(data.config?.baseUrl || '')
    const choices = smokeChoices(data.availableModels, data.config)
    setSmokeModel((current) => (current && choices.some((model) => model.id === current) ? current : pickSmokeModel(data.config, choices)))
  }, [])

  React.useEffect(() => {
    load().catch((e) => setErr(String(e.message || e)))
  }, [load])

  const checkUpdate = React.useCallback(async () => {
    setUpdateState((s) => ({ ...s, checking: true, error: '' }))
    try {
      const res = await fetch(`${ROUTE_PREFIX}/update`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      setUpdateState((s) => ({
        ...s,
        checking: false,
        currentVersion: data.currentVersion || s.currentVersion,
        latestVersion: data.latestVersion || '',
        updateAvailable: !!data.updateAvailable,
        canAutoUpdate: data.canAutoUpdate !== false,
      }))
    } catch (_) {
      setUpdateState((s) => ({ ...s, checking: false }))
    }
  }, [])

  React.useEffect(() => {
    checkUpdate()
  }, [checkUpdate])

  async function handleTriggerUpdate() {
    if (updateState.updating) return
    setUpdateState((s) => ({ ...s, updating: true, error: '', notice: '' }))
    try {
      const res = await fetch(`${ROUTE_PREFIX}/update`, {
        method: 'POST',
        headers: { 'x-dsh-plugin-update': '1' },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const newVer = data.updatedVersion || updateState.latestVersion || updateState.currentVersion
      setUpdateState((s) => ({
        ...s,
        updating: false,
        updateAvailable: false,
        currentVersion: newVer,
        notice: t('update.done', { version: newVer }),
      }))
      setTimeout(() => checkUpdate(), 2000)
    } catch (err) {
      setUpdateState((s) => ({
        ...s,
        updating: false,
        error: t('update.failed', { error: String(err.message || err) }),
      }))
    }
  }

  async function handleSaveBaseUrl() {
    const next = String(baseUrlInput || '').trim()
    if (!next) {
      setErr(t('key.local_base', { url: '' }))
      return
    }
    setBusy('save-base')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg(t('key.save_base'))
      await load()
    } catch (error) {
      setErr(String(error.message || error))
    } finally {
      setBusy('')
    }
  }

  async function handleSaveKey() {
    const keyVal = String(apiKeyInput || '').trim()
    if (!keyVal) {
      setErr(t('key.empty_err'))
      return
    }
    setBusy('save-key')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/save-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: keyVal, apiKeyEnv: draft?.apiKeyEnv }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setApiKeyInput('')
      setMsg(data.validated
        ? t('key.saved_msg', { status: 'OK' })
        : t('key.saved_unverified', { error: data.validationError || `HTTP ${res.status}` }))
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleRefreshQuota() {
    setBusy('refresh-quota')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/usage`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatus((prev) => (prev ? { ...prev, usage: data } : prev))
      setMsg(t('quota.refreshed_msg'))
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleSyncPlanModels() {
    setBusy('sync-models')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/models/sync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg(t('models.synced_msg', { total: data.totalModelsCount, discovered: data.discoveredCount }))
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleRegister() {
    setBusy('register')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/register`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const count = status?.availableModels?.filter((m) => !(draft?.disabledModels || []).includes(m.id)).length || 0
      setMsg(t('diag.resynced_msg', { count }))
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleUnregister() {
    setBusy('unregister')
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/unregister`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg(t('diag.unregistered_msg'))
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleSmoke() {
    setBusy('smoke')
    setErr('')
    setSmokeResult(null)
    try {
      const res = await fetch(`${ROUTE_PREFIX}/smoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: smokeModel }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSmokeResult(data)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handleFastLogin() {
    setBusy('fast-login')
    setErr('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/auth/begin`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.authUrl) {
        window.open(data.authUrl, '_blank')
      }
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function handlePinAccount(accountEnv) {
    setBusy('pin-account')
    setErr('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/accounts/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: accountEnv }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  const debounceTimerRef = typeof React.useRef === 'function' ? React.useRef(null) : { current: null }
  function debounceSaveDisabledModels(nextDisabled) {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${ROUTE_PREFIX}/models/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectionKind: 'all-except-disabled', disabledModels: nextDisabled }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.warning) setMsg(data.warning)
      } catch (error) {
        setErr(String(error.message || error))
      }
    }, 400)
  }

  async function saveModelPatch(body) {
    setBusy('model-edit')
    setErr('')
    try {
      const res = await fetch(`${ROUTE_PREFIX}/models/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg(data.warning || t('models.saved'))
      await load()
    } catch (error) {
      setErr(String(error.message || error))
    } finally {
      setBusy('')
    }
  }

  function handleToggleModel(id) {
    const all = status?.availableModels || []
    if ((draft?.selectionKind || status?.config?.selectionKind) === 'explicit') {
      const curr = new Set(draft?.explicitModels || [])
      if (curr.has(id)) curr.delete(id)
      else curr.add(id)
      const explicitModels = [...curr]
      setDraft({ ...draft, selectionKind: 'explicit', explicitModels, enabledModels: explicitModels })
      saveModelPatch({ selectionKind: 'explicit', explicitModels })
      return
    }
    const enabled = new Set(enabledIdsOf(draft, all))
    if (enabled.has(id)) enabled.delete(id)
    else enabled.add(id)
    const enabledIds = [...enabled]
    const next = all.map((model) => model.id).filter((modelId) => !enabled.has(modelId))
    setDraft({ ...draft, selectionKind: 'all-except-disabled', disabledModels: next, enabledModels: enabledIds })
    debounceSaveDisabledModels(next)
  }

  function enabledIdsOf(current, all) {
    if (current?.enabledModels?.length || current?.selectionKind === 'explicit') {
      return current.enabledModels || current.explicitModels || []
    }
    const disabled = new Set(current?.disabledModels || [])
    return all.map((model) => model.id).filter((modelId) => !disabled.has(modelId))
  }

  function handleSetModelsFilter(type) {
    setModelsFilter(type)
  }

  if (!scope && scopeError && !status) {
    return React.createElement(
      'div',
      { className: 'cb-page' },
      React.createElement('div', { className: 'cb-alert-err' }, scopeError),
      React.createElement('button', {
        type: 'button',
        className: 'cb-btn',
        style: { marginTop: '12px' },
        onClick: () => {
          setErr('')
          Promise.resolve(props.refreshScope?.()).then(() => load()).catch((error) => setErr(String(error.message || error)))
        },
      }, t('settings.retry'))
    )
  }

  if (!status || !draft) {
    if (err) {
      return React.createElement(
        'div',
        { className: 'cb-page' },
        React.createElement('div', { className: 'cb-alert cb-alert-err' }, `${t('settings.loading')}: ${err}`),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'cb-btn',
            style: { marginTop: '12px', alignSelf: 'flex-start' },
            onClick: () => {
              setErr('')
              load().catch((e) => setErr(String(e.message || e)))
            },
          },
          t('settings.retry')
        )
      )
    }
    return React.createElement('div', { className: 'cb-page' }, t('settings.loading'))
  }

  const healthOk = !!status.health?.ok
  const keyPresent = !!status.key?.present
  const isRegistered = !!status.isRegistered
  const modelsList = (status.availableModels || []).filter((model) => {
    if (modelsFilter === 'vision') return model.input?.includes('image') || model.vendorInput?.includes('image')
    if (modelsFilter === 'coding') return model.category === 'coding'
    if (modelsFilter === 'recommended') return model.recommended
    return true
  })
  const enabledSet = new Set(draft.enabledModels || status.config?.enabledModels || [])
  const enabledCount = (status.availableModels || []).filter((model) => enabledSet.has(model.id)).length
  const scopeNote = scopeError
    || (snapshotStatus === 'unavailable' ? t('settings.unavailable') : '')
    || (snapshotStatus === 'loading' ? t('settings.mirror_loading') : '')
  const usage = status.usage

  return React.createElement(
    'div',
    { className: 'cb-page' },

    // Page Header
    React.createElement(
      'div',
      { className: 'cb-status' },
      React.createElement('span', { className: `cb-badge ${healthOk ? 'cb-badge-ok' : 'cb-badge-bad'}` }, healthOk ? t('badge.online', { latency: status.health?.latencyMs }) : t('badge.offline')),
      React.createElement('span', { className: `cb-badge ${keyPresent ? 'cb-badge-ok' : 'cb-badge-warn'}` }, keyPresent ? t('badge.key_ok', { source: status.key?.source }) : t('badge.key_missing')),
      React.createElement('span', { className: `cb-badge ${isRegistered ? 'cb-badge-ok' : 'cb-badge-warn'}` }, isRegistered ? t('badge.registered', { count: enabledCount }) : t('badge.not_registered')),
    ),

    // In-app Update Bar
    React.createElement(UpdateBanner, { updateState, handleTriggerUpdate, t }),

    // Notifications
    scopeNote ? React.createElement('div', { className: 'cb-banner-warning' }, scopeNote) : null,
    err ? React.createElement('div', { className: 'cb-alert-bad' }, err) : null,
    msg ? React.createElement('div', { className: 'cb-alert-ok' }, msg) : null,

    // Card 1: API Key and Credentials
    React.createElement(KeySection, {
      keyPresent,
      apiKeyInput,
      setApiKeyInput,
      showKey,
      setShowKey,
      busy,
      draft,
      baseUrlInput,
      setBaseUrlInput,
      handleSaveKey,
      handleSaveBaseUrl,
      handleFastLogin,
      t,
    }),

    // Accounts Pool Card
    React.createElement(AccountsSection, { status, busy, handlePinAccount, t }),

    // Quota Warning & Dashboard Card
    React.createElement(QuotaSection, { keyPresent, status, usage, busy, handleRefreshQuota, t }),

    // Card 3: Model Picker Management
    React.createElement(ModelsSection, {
      modelsList,
      enabledSet,
      enabledCount,
      totalCount: (status.availableModels || []).length,
      keyPresent,
      busy,
      modelsFilter,
      providerReasoning: draft.providerReasoning || '',
      handleSyncPlanModels,
      handleSetModelsFilter,
      handleToggleModel,
      saveModelPatch,
      t,
    }),

    // Card 4: Session Metrics & Usage Tracking
    React.createElement(StatsSection, { status, t }),

    // Card 5: Diagnostics & Sync with DSH
    React.createElement(DiagSection, {
      keyPresent,
      isRegistered,
      busy,
      smokeModels: smokeChoices(status.availableModels, draft),
      smokeModel,
      onSmokeModel: (id) => {
        setSmokeModel(id)
        setDraft((prev) => ({ ...(prev || {}), defaultModel: id }))
        fetch(`${ROUTE_PREFIX}/models/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultModel: id }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
        }).catch((e) => setErr(String(e.message || e)))
      },
      smokeResult,
      handleSmoke,
      handleUnregister,
      handleRegister,
      t,
    })
  )
}
