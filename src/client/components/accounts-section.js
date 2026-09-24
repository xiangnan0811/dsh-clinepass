function AccountsSection({ status, busy, handlePinAccount, t }) {
  if (!status.accounts || !status.accounts.length) return null
  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('accounts.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('accounts.desc')),
    React.createElement(
      'table',
      { className: 'cb-table' },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          React.createElement('th', null, t('accounts.col_name')),
          React.createElement('th', null, t('accounts.col_ref')),
          React.createElement('th', null, t('accounts.col_status')),
          React.createElement('th', null, t('accounts.col_action'))
        )
      ),
      React.createElement(
        'tbody',
        null,
        status.accounts.map((acc) => {
          const isActive = status.activeAccount === acc.apiKeyEnv || (!status.activeAccount && acc.id === 'default')
          return React.createElement(
            'tr',
            { key: acc.id },
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
                : null
            ),
            React.createElement(
              'td',
              { style: { textAlign: 'right' } },
              !isActive && acc.present
                ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'cb-btn',
                      style: { padding: '4px 8px', fontSize: '11px' },
                      disabled: !!busy,
                      onClick: () => handlePinAccount(acc.apiKeyEnv),
                    },
                    t('accounts.pin_btn')
                  )
                : null
            )
          )
        })
      )
    )
  )
}
