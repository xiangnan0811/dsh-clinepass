function SearchSettings({ status, draft, busy, saveSettings, t }) {
  const [timeout, setTimeoutValue] = React.useState(String(draft.searchTimeoutMs ?? 15000))
  const [notice, setNotice] = React.useState(null)
  React.useEffect(() => setTimeoutValue(String(draft.searchTimeoutMs ?? 15000)), [draft.searchTimeoutMs])
  const save = async () => {
    const value = Number(timeout)
    if (!Number.isSafeInteger(value) || value < 50) { setNotice({ ok: false, message: t('search.bad_timeout') }); return }
    setNotice(await saveSettings({ searchTimeoutMs: value }))
  }
  const state = status.webSearch
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('search.title')),
    React.createElement('p', { className: 'cb-section-desc' }, t('search.hint')),
    React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: draft.webSearchEnabled === true, disabled: !!busy, onChange: async (event) => setNotice(await saveSettings({ webSearchEnabled: event.target.checked })) }), t('search.enabled')),
    React.createElement('p', { className: 'cb-section-desc', role: 'status' }, !state?.serviceAvailable ? t('search.unavailable') : state.registered ? t('search.registered') : t('search.disabled')),
    React.createElement('div', { className: 'cb-row' }, React.createElement('label', { className: 'cb-field' }, t('search.timeout'), React.createElement('input', { className: 'cb-input', type: 'number', min: 50, step: 1, value: timeout, disabled: !!busy, onChange: (event) => setTimeoutValue(event.target.value) })), React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: save }, t('search.save'))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
