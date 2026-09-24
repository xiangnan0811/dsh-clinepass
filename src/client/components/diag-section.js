function DiagSection({ keyPresent, isRegistered, busy, smokeModels, smokeModel, onSmokeModel, smokeResult, handleSmoke, handleUnregister, handleRegister, t }) {
  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('diag.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('diag.desc')),
    React.createElement(
      'label',
      { className: 'cb-field' },
      React.createElement('span', { className: 'cb-field-label' }, t('diag.model')),
      React.createElement(
        'select',
        {
          className: 'cb-input',
          value: smokeModel || '',
          disabled: !!busy || !(smokeModels || []).length,
          onChange: (event) => onSmokeModel(event.target.value),
        },
        (smokeModels || []).map((model) => React.createElement(
          'option',
          { key: model.id, value: model.id },
          `${model.name || model.id} · ${model.id}`,
        )),
      ),
    ),
    React.createElement(
      'div',
      { className: 'cb-row' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'cb-btn',
          disabled: !!busy || !keyPresent,
          onClick: handleSmoke,
        },
        busy === 'smoke' ? t('diag.smoke_testing') : t('diag.smoke_btn')
      ),
      isRegistered
        ? React.createElement(
            'button',
            {
              type: 'button',
              className: 'cb-btn cb-btn-danger',
              disabled: !!busy,
              onClick: handleUnregister,
            },
            busy === 'unregister' ? t('diag.unregistering') : t('diag.unregister_btn')
          )
        : null,
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'cb-btn cb-btn-primary',
          disabled: !!busy,
          onClick: handleRegister,
        },
        busy === 'register' ? t('diag.resyncing') : t('diag.resync_btn')
      )
    ),
    smokeResult
      ? React.createElement(
          'table',
          { className: 'cb-table cb-facts' },
          React.createElement('tbody', null, [
            [t('diag.col_latency'), smokeResult.latencyMs != null ? `${smokeResult.latencyMs} ms` : '—'],
            [t('diag.col_model'), smokeResult.model || '—'],
            [t('diag.col_reply'), smokeResult.preview || '—'],
          ].map(([label, value]) => React.createElement('tr', { key: label },
            React.createElement('th', { scope: 'row' }, label),
            React.createElement('td', null, value),
          ))),
        )
      : null
  )
}
