    function ensureCss() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById('dsh-clinebot-full-css')
      const style = existing || document.createElement('style')
      style.id = 'dsh-clinebot-full-css'
      style.dataset.dshPlugin = NS
      const css = `
.cb-page{display:flex;flex-direction:column;gap:16px;padding:0 0 24px;max-width:none;min-width:0;font-size:14px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.cb-page *{box-sizing:border-box}.cb-page p{margin:0}.cb-page a{color:var(--dsw-alias-state-business-primary);text-underline-offset:3px;overflow-wrap:anywhere}.cb-page code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.cb-page details{min-width:0;border-top:1px solid var(--dsw-alias-border-l2);padding-top:4px}.cb-page summary{cursor:pointer;padding:9px 0;font-size:13px;font-weight:600;line-height:1.6;color:var(--dsw-alias-label-primary)}
.cb-page summary::marker{color:var(--dsw-alias-label-tertiary)}.cb-page summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px;border-radius:4px}.cb-page details> :not(summary){margin-top:12px}.cb-page details> :last-child:not(summary){margin-bottom:4px}
.cb-plugin-info{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:4px 2px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.cb-plugin-info strong{font-size:18px;letter-spacing:-.3px}.cb-plugin-info a{font-size:12px;margin-left:auto}
.cb-rate-row{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.cb-pin-editor{display:flex;flex-direction:column;gap:12px;min-width:0}
.cb-routing-history{margin-top:16px;min-width:0}.cb-routing-list{max-height:420px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.cb-routing-row{padding:12px;min-width:0}.cb-routing-row+.cb-routing-row{border-top:1px solid var(--dsw-alias-border-l2)}.cb-routing-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;margin:8px 0}.cb-routing-facts>div{display:flex;flex-direction:column;gap:4px;min-width:0}.cb-routing-facts span{font-size:11px;color:var(--dsw-alias-label-secondary)}.cb-routing-facts b{font-size:12px;font-weight:600;overflow-wrap:anywhere}.cb-routing-attempt{padding:8px 0 0 10px;border-left:2px solid var(--dsw-alias-border-l2);margin-top:8px}
.cb-update-panel{min-width:0}.cb-update-panel p{font-size:13px;line-height:1.5}.cb-update-panel code{overflow-wrap:anywhere;font-size:12px}.cb-update-target{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.cb-update-panel .cb-row{flex-wrap:wrap}
.cb-sidebar-quota{appearance:none;display:flex;align-items:center;justify-content:center;gap:9px;background:transparent;color:var(--dsw-alias-label-secondary);border:1px solid transparent;border-radius:8px;padding:7px;cursor:pointer;min-width:0;max-width:100%}
.cb-sidebar-quota:hover,.cb-composer-button:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.cb-sidebar-quota:focus-visible,.cb-composer-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.cb-sidebar-quota svg{flex:none}.cb-sidebar-quota-wide{width:100%;justify-content:flex-start;padding:9px 10px}
.cb-sidebar-copy{min-width:0;display:flex;flex-direction:column;gap:3px;text-align:left}.cb-sidebar-copy b{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary)}.cb-sidebar-copy>span{font-size:10px;line-height:1.4;overflow-wrap:anywhere}
.cb-detail-window{min-width:0;max-width:100%;max-height:75dvh;overflow-y:auto;overscroll-behavior:contain;padding:2px}
.cb-details-modal.cb-details-modal{width:min(920px,calc(100vw - 32px));max-width:calc(100vw - 32px)}.cb-session-modal.cb-session-modal{width:min(560px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.cb-detail-tabs{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:16px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-3)}
.cb-detail-window .cb-page{gap:12px}.cb-detail-window .cb-section-card{padding:12px}.cb-detail-window .cb-quota-meta th{width:auto}
.cb-composer-usage{display:inline-flex;min-width:0;max-width:100%}.cb-composer-button{appearance:none;font:inherit;font-size:11px;line-height:1.4;white-space:normal;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 8px;max-width:100%;text-align:left}
.cb-session-detail{max-height:70dvh;overflow:auto;font-size:13px}.cb-usage-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 12px}.cb-cost-estimate{display:flex;justify-content:space-between;gap:16px;align-items:baseline;padding:14px 0;border-block:1px solid var(--dsw-alias-border-l2)}.cb-cost-estimate strong{font-size:18px;font-variant-numeric:tabular-nums}
.cb-reset-countdown{display:block;font-size:11px;margin-top:3px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.cb-quota-windows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}
.cb-quota-window{display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.cb-quota-window-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px}.cb-quota-window-title .cb-quota-pct{font-size:18px}
.cb-quota-window-reset{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:normal}
.cb-detail-window .cb-quota-meta th{white-space:nowrap;overflow-wrap:normal}.cb-detail-window .cb-quota-others{min-width:520px}.cb-detail-window .cb-quota-others th,.cb-detail-window .cb-quota-others td{white-space:nowrap;overflow-wrap:normal}
.cb-status{display:flex;flex-wrap:wrap;gap:8px}
.cb-chevron{display:inline-flex;align-items:center;justify-content:center;transition:transform .16s ease;color:var(--dsw-alias-label-tertiary)}
.cb-chevron-open{transform:rotate(180deg)}
.cb-header{display:flex;flex-direction:column;gap:8px;padding-bottom:16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cb-page-title{font-size:22px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.cb-page-sub{font-size:14px;color:var(--dsw-alias-label-secondary);line-height:1.5}

.cb-section-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-section-card .cb-field{margin:0}
.cb-section-title{font-size:15px;line-height:1.6;font-weight:650;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;gap:8px}
.cb-section-title-stack{flex-direction:column;align-items:flex-start;gap:10px}
.cb-section-desc{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0;line-height:1.65}
.cb-routing-history{display:flex;flex-direction:column;gap:12px}.cb-routing-row{display:flex;flex-direction:column;gap:10px}.cb-routing-row .cb-model-id{margin:0}.cb-routing-facts{margin:0}.cb-routing-list{max-height:520px;scrollbar-gutter:stable}.cb-routing-facts span,.cb-routing-facts b{line-height:1.6}

.cb-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.cb-field{display:flex;flex-direction:column;gap:7px;margin:0;min-width:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.cb-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cb-check{display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary)}.cb-check input[type=checkbox]{flex:none;width:16px;height:16px;margin:3px 0;accent-color:var(--dsw-alias-state-business-primary)}
.cb-grid-2{display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%,240px), 1fr));gap:16px}
.cb-form-action{align-items:flex-end}.cb-form-action>.cb-field{flex:1 1 240px}

.cb-badge{font-size:11px;line-height:1.5;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;gap:5px;font-weight:500;max-width:100%;overflow-wrap:anywhere}
.cb-badge-ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent)}
.cb-badge-warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)}
.cb-badge-bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}

.cb-input{height:38px;min-height:38px;min-width:0;max-width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:7px;padding:0 11px;font:inherit;font-size:13px;line-height:normal;width:100%;box-sizing:border-box}
.cb-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.cb-input:focus-visible,.cb-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.cb-input-group{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cb-input-group .cb-input{flex:1 1 160px;width:auto;min-width:0}

.cb-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;min-height:38px;padding:8px 12px;font-size:13px;line-height:20px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:normal;max-width:100%;flex:0 1 auto;transition:background .15s ease,border-color .15s ease}
.cb-btn:disabled{opacity:.5;cursor:not-allowed}.cb-input:disabled{opacity:.65}
.cb-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-4, var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-label-dimmed, var(--dsw-alias-border-l2))}
.cb-btn-active{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}
.cb-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}
.cb-btn-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary) !important;color:var(--dsw-alias-bg-layer-3) !important;opacity:0.88;visibility:visible !important}
.cb-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent)}
.cb-btn-danger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent) !important;border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, transparent)}
.cb-btn-disabled{opacity:0.5;cursor:not-allowed}

.cb-bar-container{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.cb-bar-head{display:flex;justify-content:space-between;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.cb-bar-track{width:100%;height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;border:1px solid var(--dsw-alias-border-l2)}
.cb-bar-fill{height:100%;border-radius:999px;transition:width .3s;min-width:0}
.cb-bar-fill-ok{background:var(--dsw-alias-state-success-primary)}
.cb-bar-fill-warn{background:var(--dsw-alias-state-warn-primary)}
.cb-bar-fill-bad{background:var(--dsw-alias-state-error-primary)}
.cb-quota-meta{margin-top:0}
.cb-quota-meta th{width:88px;white-space:nowrap}
.cb-quota-meta td{white-space:normal;overflow-wrap:anywhere}
.cb-quota{margin-top:4px}
.cb-quota th,.cb-quota td{white-space:nowrap}
.cb-quota th:nth-child(2),.cb-quota td:nth-child(2){text-align:right;width:76px}
.cb-quota td:nth-child(3){width:42%}
.cb-quota-pct{font-variant-numeric:tabular-nums;font-size:18px;font-weight:700}
.cb-quota-pct-ok{color:var(--dsw-alias-state-success-primary)}
.cb-quota-pct-warn{color:var(--dsw-alias-state-warn-primary)}
.cb-quota-pct-bad{color:var(--dsw-alias-state-error-primary)}
.cb-quota-reset{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.cb-email-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.cb-email-toggle{padding:2px 8px;font-size:12px}
.cb-quota-scroll{margin-top:10px;overflow-x:auto}
.cb-quota-others{margin-top:0}
.cb-quota-others th,.cb-quota-others td{white-space:nowrap}
.cb-quota-others td:first-child,.cb-quota-others th:first-child{white-space:normal;overflow-wrap:anywhere}
.cb-bar-meta{display:flex;justify-content:space-between;font-size:12px;color:var(--dsw-alias-label-secondary)}

.cb-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.cb-model{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px 10px;align-items:start;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cb-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cb-model-id{display:block;margin-top:2px;font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.cb-metrics{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px}
.cb-metric{display:flex;flex-direction:column;gap:2px;min-width:64px}
.cb-metric b{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.cb-metric span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.cb-table th,.cb-table td{white-space:nowrap}
.cb-table-scroll{min-width:0;max-width:100%;overflow-x:auto}
.cb-editor{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;padding:12px 0 8px;min-width:0}.cb-editor-note{display:flex;flex-direction:column;gap:12px}.cb-model-head{flex-wrap:wrap}.cb-model-main{min-width:0}
.cb-editor .cb-field{margin:0}
.cb-editor-note{grid-column:1/-1}
.cb-editor-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
.cb-account-add{margin-top:12px}
.cb-editor .cb-alert-ok,.cb-editor .cb-alert-bad{grid-column:1/-1;margin:0}
.cb-facts th{width:140px}
.cb-facts a{color:var(--dsw-alias-state-business-primary)}
.cb-table{width:100%;border-collapse:collapse;margin-top:8px}
.cb-table th{text-align:left;font-size:12px;color:var(--dsw-alias-label-secondary);padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:600}
.cb-table td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:13px;color:var(--dsw-alias-label-primary)}
.cb-table tr:hover{background:var(--dsw-alias-bg-layer-2)}

.cb-alert-ok{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary);font-size:13px}
.cb-alert-bad{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);font-size:13px}
.cb-alert-err{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);font-size:13px}
.cb-banner-warning{padding:12px 16px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:500}
.cb-banner-exhausted{padding:12px 16px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:600}
.cb-stat-box{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.cb-stat-val{font-size:18px;font-weight:700;color:var(--dsw-alias-label-primary)}
.cb-stat-lbl{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cb-preview{padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;border:1px solid var(--dsw-alias-border-l2)}
@media(max-width:600px){
  .cb-page{overflow-wrap:anywhere}
  .cb-page .cb-btn{white-space:normal;max-width:100%;min-width:0;flex-shrink:1}
  .cb-page .cb-input{min-width:0;max-width:100%}
  .cb-page .cb-model-head{flex-wrap:wrap}
  .cb-page .cb-check{flex-wrap:wrap}
  .cb-page .cb-metric{min-width:0}
  .cb-page .cb-table th,.cb-page .cb-table td{white-space:normal;padding:6px 2px}
  .cb-page .cb-facts th{width:auto}
}
`
      if (style.textContent !== css) style.textContent = css
      if (!existing) document.head.appendChild(style)
    }

