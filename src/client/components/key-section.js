function KeySection({ keyPresent, apiKeyInput, setApiKeyInput, showKey, setShowKey, busy, draft, baseUrlInput, setBaseUrlInput, handleSaveKey, handleSaveBaseUrl, handleFastLogin, t }) {
  const base = String(draft?.baseUrl || '')
  const localApi = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(base)
  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('key.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('key.desc')),
    localApi ? React.createElement('div', { className: 'cb-banner-warning' }, t('key.local_base', { url: base })) : null,
    React.createElement(
      'label',
      { className: 'cb-field' },
      React.createElement('span', { className: 'cb-field-label' }, t('key.address')),
      React.createElement(
        'div',
        { className: 'cb-input-group' },
        React.createElement('input', {
          className: 'cb-input',
          value: baseUrlInput,
          onChange: (event) => setBaseUrlInput(event.target.value),
          spellCheck: false,
        }),
        React.createElement('button', {
          type: 'button',
          className: 'cb-btn',
          disabled: !!busy,
          onClick: handleSaveBaseUrl,
        }, busy === 'save-base' ? t('key.saving') : t('key.save_base')),
      ),
    ),
    React.createElement(
      'label',
      { className: 'cb-field' },
      React.createElement('span', { className: 'cb-field-label' }, t('key.secret')),
      React.createElement(
      'div',
      { className: 'cb-input-group' },
      React.createElement('input', {
        className: 'cb-input',
        type: showKey ? 'text' : 'password',
        placeholder: keyPresent ? t('key.placeholder_has') : t('key.placeholder_empty'),
        value: apiKeyInput,
        onChange: (e) => setApiKeyInput(e.target.value),
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'cb-btn',
          onClick: () => setShowKey((v) => !v),
        },
        showKey ? t('key.hide') : t('key.show')
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'cb-btn cb-btn-primary',
          disabled: !!busy || !String(apiKeyInput || '').trim(),
          onClick: handleSaveKey,
        },
        busy === 'save-key' ? t('key.saving') : t('key.save')
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'cb-btn',
          disabled: !!busy,
          onClick: handleFastLogin,
        },
        busy === 'fast-login' ? '…' : t('key.login_fast')
      )
      ),
    ),
    React.createElement(
      'table',
      { className: 'cb-table cb-facts' },
      React.createElement('tbody', null,
        React.createElement('tr', null,
          React.createElement('th', { scope: 'row' }, t('key.env_label')),
          React.createElement('td', null, React.createElement('code', null, draft.apiKeyEnv || 'CLINEBOT_API_KEY')),
        ),
        React.createElement('tr', null,
          React.createElement('th', { scope: 'row' }, t('key.get_key_label')),
          React.createElement('td', null, React.createElement('a', {
            href: 'https://app.cline.bot',
            target: '_blank',
            rel: 'noreferrer',
          }, t('key.get_key'))),
        ),
      ),
    )
  )
}
