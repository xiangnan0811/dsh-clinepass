function AccountsSection({ status, busy, handlePinAccount, handleAddAccount, handleDeleteAccount, t }) {
  const accounts = Array.isArray(status?.accounts) ? status.accounts : []
  const primary = status?.config?.apiKeyEnv || 'CLINEBOT_API_KEY'
  const [label, setLabel] = React.useState('')
  const [envName, setEnvName] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [showSecret, setShowSecret] = React.useState(false)
  const [showForm, setShowForm] = React.useState(false)
  const [notice, setNotice] = React.useState(null)
  const [confirmEnv, setConfirmEnv] = React.useState('')
  const [deleteSecret, setDeleteSecret] = React.useState(false)
  const failover = status?.lastFailover

  async function submitAccount() {
    const result = await handleAddAccount({
      label,
      apiKeyEnv: envName,
      apiKey: secret,
    })
    if (!result) return
    setNotice(result)
    if (result.ok) {
      setLabel('')
      setEnvName('')
      setSecret('')
      setShowSecret(false)
      setShowForm(false)
    }
  }

  function closeForm() {
    setLabel('')
    setEnvName('')
    setSecret('')
    setShowSecret(false)
    setShowForm(false)
    setNotice(null)
  }

  async function submitDelete() {
    const result = await handleDeleteAccount({
      apiKeyEnv: confirmEnv,
      deleteSecret,
    })
    if (!result) return
    setNotice(result.ok
      ? {
          ok: !result.warning,
          message: result.secretDeleted
            ? t('accounts.removed_secret')
            : (result.warning ? t('accounts.secret_kept') : t('accounts.removed')),
        }
      : result)
    if (result.ok) {
      setConfirmEnv('')
      setDeleteSecret(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('accounts.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('accounts.desc')),
    failover
      ? React.createElement(
          'table',
          { className: 'cb-table cb-facts' },
          React.createElement('tbody', null,
            React.createElement('tr', null,
              React.createElement('th', { scope: 'row' }, t('accounts.last_failover')),
              React.createElement('td', null, `${failover.from} → ${failover.to}`),
            ),
          ),
        )
      : null,
    accounts.length
      ? React.createElement(
          'table',
          { className: 'cb-table' },
          React.createElement(
            'thead',
            null,
            React.createElement('tr', null,
              React.createElement('th', null, t('accounts.col_name')),
              React.createElement('th', null, t('accounts.col_ref')),
              React.createElement('th', null, t('accounts.col_status')),
              React.createElement('th', null, t('accounts.col_action')),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            accounts.map((acc) => {
              const isActive = status.activeAccount === acc.apiKeyEnv || (!status.activeAccount && acc.id === 'default')
              const isPrimary = acc.id === 'default' || acc.apiKeyEnv === primary
              return React.createElement(
                'tr',
                { key: acc.id || acc.apiKeyEnv },
                React.createElement('td', null, React.createElement('strong', null, acc.label)),
                React.createElement('td', null, React.createElement('code', null, acc.apiKeyEnv)),
                React.createElement(
                  'td',
                  null,
                  acc.present
                    ? React.createElement('span', { className: 'cb-badge cb-badge-ok' }, t('accounts.configured', { source: acc.source }))
                    : React.createElement('span', { className: 'cb-badge cb-badge-warn' }, t('accounts.missing')),
                  isActive
                    ? React.createElement('span', { className: 'cb-badge cb-badge-ok', style: { marginLeft: '6px' } }, t('accounts.active_badge'))
                    : null,
                ),
                React.createElement(
                  'td',
                  { style: { textAlign: 'right' } },
                  React.createElement(
                    'div',
                    { className: 'cb-row', style: { justifyContent: 'flex-end' } },
                    !isActive && acc.present
                      ? React.createElement('button', {
                          type: 'button',
                          className: 'cb-btn',
                          disabled: !!busy,
                          onClick: () => handlePinAccount(acc.apiKeyEnv),
                        }, t('accounts.pin_btn'))
                      : null,
                    isPrimary
                      ? null
                      : React.createElement('button', {
                          type: 'button',
                          className: 'cb-btn',
                          disabled: !!busy,
                          onClick: () => {
                            setConfirmEnv(acc.apiKeyEnv)
                            setDeleteSecret(false)
                          },
                        }, t('accounts.remove')),
                  ),
                ),
              )
            }),
          ),
        )
      : null,
    confirmEnv
      ? React.createElement(
          'div',
          { className: 'cb-editor' },
          React.createElement('div', { className: 'cb-section-desc cb-editor-note' }, t('accounts.confirm_prompt', { name: confirmEnv })),
          React.createElement('label', { className: 'cb-field cb-editor-note' },
            React.createElement('span', { className: 'cb-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: deleteSecret,
                onChange: (event) => setDeleteSecret(event.target.checked),
              }),
              t('accounts.delete_secret'),
            ),
          ),
          React.createElement('div', { className: 'cb-editor-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'cb-btn cb-btn-danger',
              disabled: !!busy,
              onClick: submitDelete,
            }, busy === 'delete-account' ? t('accounts.removing') : t('accounts.confirm_remove')),
            React.createElement('button', {
              type: 'button',
              className: 'cb-btn',
              disabled: !!busy,
              onClick: () => { setConfirmEnv(''); setDeleteSecret(false) },
            }, t('accounts.cancel')),
          ),
        )
      : null,
    showForm
      ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'cb-section-title' }, t('accounts.add_title')),
          React.createElement('label', { className: 'cb-field' },
            React.createElement('span', { className: 'cb-field-label' }, t('accounts.form_label')),
            React.createElement('input', {
              className: 'cb-input',
              value: label,
              placeholder: t('accounts.label_placeholder'),
              autoFocus: true,
              onChange: (event) => setLabel(event.target.value),
            }),
          ),
          React.createElement('label', { className: 'cb-field' },
            React.createElement('span', { className: 'cb-field-label' }, t('accounts.form_env')),
            React.createElement('input', {
              className: 'cb-input',
              value: envName,
              placeholder: t('accounts.env_placeholder'),
              spellCheck: false,
              onChange: (event) => setEnvName(event.target.value),
            }),
          ),
          React.createElement('label', { className: 'cb-field' },
            React.createElement('span', { className: 'cb-field-label' }, t('accounts.form_secret')),
            React.createElement('div', { className: 'cb-input-group' },
              React.createElement('input', {
                className: 'cb-input',
                type: showSecret ? 'text' : 'password',
                value: secret,
                onChange: (event) => setSecret(event.target.value),
              }),
              React.createElement('button', {
                type: 'button',
                className: 'cb-btn',
                onClick: () => setShowSecret((value) => !value),
              }, showSecret ? t('key.hide') : t('key.show')),
              React.createElement('button', {
                type: 'button',
                className: 'cb-btn cb-btn-primary',
                disabled: !!busy || !String(secret || '').trim(),
                onClick: submitAccount,
              }, busy === 'add-account' ? t('accounts.saving') : t('accounts.save')),
            ),
          ),
          React.createElement('div', { className: 'cb-editor-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'cb-btn',
              disabled: !!busy,
              onClick: closeForm,
            }, t('accounts.cancel')),
          ),
        )
      : React.createElement('div', { className: 'cb-account-add' },
          React.createElement('button', {
            type: 'button',
            className: 'cb-btn',
            'aria-expanded': false,
            disabled: !!busy,
            onClick: () => setShowForm(true),
          }, t('accounts.add_btn')),
        ),
    notice
      ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message)
      : null,
  )
}
