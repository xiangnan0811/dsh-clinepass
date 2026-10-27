    function ensureCss() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById('dsh-clinebot-full-css')
      const style = existing || document.createElement('style')
      style.id = 'dsh-clinebot-full-css'
      style.dataset.dshPlugin = NS
      const css = `
.cb-heatmap-scroll{overflow-x:auto}
.cb-heatmap{display:grid;grid-template-columns:24px repeat(24,minmax(12px,1fr));gap:3px;min-width:420px;align-items:center}
.cb-heatmap-hour,.cb-heatmap-day{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cb-heatmap-cell{display:block;border:0;padding:0;height:16px;border-radius:3px;cursor:pointer;background:color-mix(in srgb,var(--cb-accent) var(--cb-heat),var(--cb-fill))}
.cb-heatmap-cell:hover{box-shadow:inset 0 0 0 1px var(--dsw-alias-label-secondary)}
.cb-heatmap-cell[aria-pressed="true"],.cb-heatmap-cell:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}
.cb-heat-legend{display:flex;align-items:center;justify-content:flex-end;gap:3px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.cb-heat-legend .cb-heatmap-cell{width:11px;height:11px;cursor:default;box-shadow:none}
.cb-page,.cb-detail-shell{--cb-mono:ui-monospace,"SF Mono",Menlo,"JetBrains Mono","Cascadia Mono","Fira Code","DejaVu Sans Mono","Liberation Mono",Consolas,monospace;--cb-accent:var(--dsw-alias-state-business-primary);--cb-muted:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));--cb-fill-soft:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);--cb-fill:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);--cb-fill-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.cb-page{display:flex;flex-direction:column;gap:16px;padding:0 0 24px;max-width:none;min-width:0;font-size:14px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.cb-page *{box-sizing:border-box}.cb-page p{margin:0}.cb-page a{color:var(--cb-accent);text-underline-offset:3px;overflow-wrap:anywhere}.cb-page code,.cb-mono{font-family:var(--cb-mono);font-size:12px}
.cb-page input[type=checkbox]{accent-color:var(--cb-accent)}
.cb-page details{min-width:0;border-top:1px solid var(--dsw-alias-border-l2);padding-top:4px}.cb-page summary{cursor:pointer;padding:10px 0 6px;font-size:13px;font-weight:600;line-height:1.6;color:var(--dsw-alias-label-primary)}
.cb-page summary::marker{color:var(--cb-muted)}.cb-page summary:focus-visible{outline:2px solid var(--cb-accent);outline-offset:3px;border-radius:4px}.cb-page details> :not(summary){margin-top:12px}.cb-page details> :last-child:not(summary){margin-bottom:4px}

.cb-plugin-info{display:flex;flex-direction:column;gap:10px;padding:0 2px;min-width:0}
.cb-plugin-title{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;min-width:0}.cb-plugin-title strong{font-size:18px;font-weight:700;letter-spacing:-.2px}
.cb-plugin-links{margin-left:auto;display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px}.cb-plugin-links a{font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:none}.cb-plugin-links a:hover{color:var(--cb-accent);text-decoration:underline}
.cb-status{display:flex;flex-wrap:wrap;gap:6px}
.cb-section-nav{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cb-detail-body .cb-section-nav{position:sticky;top:-16px;z-index:5;margin:-6px 0;padding:10px 2px;background:var(--dsw-alias-bg-layer-2)}
.cb-input.cb-input-narrow{width:120px;flex:none}
.cb-chip{appearance:none;font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease}
.cb-chip:hover{color:var(--dsw-alias-label-primary);background:var(--cb-fill)}.cb-chip:focus-visible{outline:2px solid var(--cb-accent);outline-offset:2px}
.cb-anchor{display:flex;flex-direction:column;gap:16px;min-width:0;scroll-margin-top:12px}

.cb-details-modal.cb-details-modal{width:min(920px,calc(100vw - 32px));max-width:calc(100vw - 32px)}.cb-session-modal.cb-session-modal{width:min(560px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.cb-detail-shell{display:flex;flex-direction:column;min-width:0;max-width:100%;max-height:75dvh}
.cb-detail-head{flex:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding:0 2px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cb-detail-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px 2px 2px;scrollbar-gutter:stable}
.cb-detail-body .cb-page,.cb-detail-body .cb-anchor{gap:12px}.cb-detail-body .cb-page{padding-bottom:8px}.cb-detail-body .cb-section-card{padding:16px 18px}
.cb-detail-body .cb-quota-others{min-width:520px}.cb-detail-body .cb-quota-others th,.cb-detail-body .cb-quota-others td{white-space:nowrap;overflow-wrap:normal}
.cb-tabs{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;border-radius:10px;background:var(--cb-fill);max-width:100%}
.cb-tab{appearance:none;font:inherit;font-size:13px;font-weight:500;line-height:20px;padding:5px 14px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease}
.cb-tab:hover{color:var(--dsw-alias-label-primary)}.cb-tab:focus-visible{outline:2px solid var(--cb-accent);outline-offset:1px}
.cb-tab[aria-selected=true],.cb-tab[aria-pressed=true]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / 10%),0 0 0 1px var(--dsw-alias-border-l2)}
.cb-tabs-sm .cb-tab{font-size:12px;line-height:18px;padding:4px 12px}

.cb-pin-editor{display:flex;flex-direction:column;gap:12px;min-width:0}
.cb-discovery{display:flex;flex-direction:column;gap:12px;min-width:0;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--cb-fill-soft)}
.cb-routing-history{display:flex;flex-direction:column;gap:10px;min-width:0}
.cb-routing-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;container-type:inline-size;min-width:0}
.cb-page .cb-routing-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:0;min-width:0}.cb-page .cb-routing-row:first-child{border-top:0}
.cb-page .cb-routing-row>summary{list-style:none;display:grid;grid-template-columns:8px 108px minmax(0,1.8fr) minmax(0,.9fr) minmax(0,1.3fr);grid-template-areas:"dot time model account result";align-items:center;gap:4px 12px;padding:10px 14px;font-size:13px;font-weight:400;line-height:1.5}
.cb-page .cb-routing-row>summary::-webkit-details-marker{display:none}
.cb-page .cb-routing-row>summary:hover,.cb-page .cb-routing-row[open]>summary{background:var(--cb-fill-soft)}
.cb-routing-dot{grid-area:dot;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}.cb-routing-dot-bad{background:var(--dsw-alias-state-error-primary)}
.cb-routing-meta{display:contents}.cb-routing-time{grid-area:time;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.cb-routing-model{grid-area:model;font-family:var(--cb-mono);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-routing-account{grid-area:account;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-routing-result{grid-area:result;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0}.cb-routing-result .cb-badge{flex:none}
.cb-routing-upstream{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-page .cb-routing-row>.cb-routing-body{margin:0;padding:4px 14px 14px 34px;display:flex;flex-direction:column;gap:10px;background:var(--cb-fill-soft);min-width:0}
@container (max-width:620px){
  .cb-page .cb-routing-row>summary{grid-template-columns:8px minmax(0,1fr) auto;grid-template-areas:"dot model model" ". meta result"}
  .cb-routing-meta{display:flex;grid-area:meta;gap:8px;min-width:0}.cb-routing-upstream{display:none}
  .cb-page .cb-routing-row>.cb-routing-body{padding-left:14px}
}
.cb-routing-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px 16px;margin:0}.cb-routing-facts>div{display:flex;flex-direction:column;gap:2px;min-width:0}.cb-routing-facts span{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.cb-routing-facts b{font-size:12px;line-height:1.6;font-weight:600;overflow-wrap:anywhere}
.cb-routing-attempt{display:flex;flex-direction:column;gap:8px;padding:8px 0 0 12px;border-left:2px solid var(--dsw-alias-border-l2)}
.cb-update-panel{min-width:0}.cb-update-panel p{font-size:13px;line-height:1.5}.cb-update-panel code{overflow-wrap:anywhere;font-size:12px}.cb-update-target{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.cb-update-panel .cb-row{flex-wrap:wrap}
.cb-sidebar-quota{appearance:none;display:flex;align-items:center;justify-content:center;gap:9px;background:transparent;color:var(--dsw-alias-label-secondary);border:1px solid transparent;border-radius:8px;padding:7px;cursor:pointer;min-width:0;max-width:100%}
.cb-sidebar-quota:hover,.cb-composer-button:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.cb-sidebar-quota:focus-visible,.cb-composer-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.cb-sidebar-quota svg{flex:none}.cb-sidebar-quota-wide{width:100%;justify-content:flex-start;padding:9px 10px}
.cb-sidebar-copy{min-width:0;display:flex;flex-direction:column;gap:3px;text-align:left}.cb-sidebar-copy b{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary)}.cb-sidebar-copy>span{font-size:10px;line-height:1.4;overflow-wrap:anywhere}
.cb-composer-usage{display:inline-flex;min-width:0;max-width:100%}.cb-composer-button{appearance:none;font:inherit;font-size:11px;line-height:1.4;white-space:normal;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 8px;max-width:100%;text-align:left}
.cb-session-detail{max-height:70dvh;overflow:auto;font-size:13px}.cb-usage-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 12px}.cb-cost-estimate{display:flex;justify-content:space-between;gap:16px;align-items:baseline;padding:14px 0;border-block:1px solid var(--dsw-alias-border-l2)}.cb-cost-estimate strong{font-size:18px;font-variant-numeric:tabular-nums}
.cb-chevron{display:inline-flex;align-items:center;justify-content:center;transition:transform .16s ease;color:var(--dsw-alias-label-tertiary)}
.cb-chevron-open{transform:rotate(180deg)}

.cb-section-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-section-card .cb-field{margin:0}
.cb-section-title{font-size:15px;line-height:1.5;font-weight:650;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;min-width:0}
.cb-section-title+.cb-section-desc{margin-top:-10px}
.cb-section-desc{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0;line-height:1.65}
.cb-footnote{font-size:12px;line-height:1.6;font-weight:400;color:var(--cb-muted)}
.cb-subhead{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;min-width:0}
.cb-subtitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.cb-block{display:flex;flex-direction:column;gap:10px;min-width:0}
.cb-callout{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--cb-fill-soft);font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.cb-confirm{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent);font-size:13px;line-height:1.65}

.cb-row,.cb-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.cb-toolbar>.cb-grow{flex:1 1 200px;width:auto;min-width:0}.cb-push{margin-left:auto}
.cb-field{display:flex;flex-direction:column;gap:6px;margin:0;min-width:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.cb-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cb-check{display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);cursor:pointer}.cb-check input[type=checkbox]{flex:none;width:16px;height:16px;margin:3px 0;accent-color:var(--cb-accent)}
.cb-check-text{display:flex;flex-direction:column;gap:2px;min-width:0}.cb-check-text b{font-weight:600}.cb-check-text small{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.cb-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px 16px}
.cb-form-action{align-items:flex-end}.cb-form-action>.cb-field{flex:1 1 240px}
.cb-route-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px 12px;align-items:end}

.cb-badge{font-size:11px;line-height:16px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;gap:5px;font-weight:500;max-width:100%;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);background:var(--cb-fill-soft)}
.cb-badge-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.cb-badge-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.cb-badge-bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}

.cb-input{height:36px;min-height:36px;min-width:0;max-width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 11px;font:inherit;font-size:13px;line-height:normal;width:100%;box-sizing:border-box;transition:border-color .15s ease}
.cb-input:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}
.cb-input:focus{outline:none;border-color:var(--cb-accent)}
.cb-input:focus-visible,.cb-btn:focus-visible,.cb-link-btn:focus-visible{outline:2px solid var(--cb-accent);outline-offset:2px}
.cb-input-sm{height:30px;min-height:30px;width:auto;padding:0 8px;font-size:12px}
.cb-input-group{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cb-input-group .cb-input{flex:1 1 160px;width:auto;min-width:0}

.cb-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;min-height:36px;padding:7px 14px;font-size:13px;line-height:20px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:normal;max-width:100%;flex:0 1 auto;transition:background .15s ease,border-color .15s ease,color .15s ease}
.cb-btn:hover:not(:disabled){background:var(--cb-fill);border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}
.cb-btn-primary{background:color-mix(in srgb,var(--cb-accent) 88%,var(--dsw-alias-label-primary));color:var(--dsw-alias-bg-layer-3);border-color:transparent}
.cb-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--cb-accent) 78%,var(--dsw-alias-label-primary)) !important;color:var(--dsw-alias-bg-layer-3) !important;border-color:transparent;visibility:visible !important}
.cb-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.cb-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent) !important;border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.cb-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}.cb-btn-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:transparent}
.cb-btn-sm{min-height:28px;padding:3px 10px;font-size:12px;line-height:18px;border-radius:7px}
.cb-btn.cb-btn:disabled{cursor:not-allowed;color:var(--cb-muted);background:var(--cb-fill-soft);border-color:var(--dsw-alias-border-l2)}
.cb-input:disabled{opacity:.65}
.cb-link-btn{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:12px;line-height:inherit;color:var(--cb-accent);cursor:pointer}.cb-link-btn:hover{text-decoration:underline}

.cb-bar-container{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--cb-fill-soft)}
.cb-bar-track{width:100%;height:6px;border-radius:999px;background:var(--cb-fill-strong);overflow:hidden}
.cb-bar-fill{height:100%;border-radius:999px;transition:width .3s;min-width:0}
.cb-bar-fill-ok{background:var(--cb-accent)}
.cb-bar-fill-warn{background:var(--dsw-alias-state-warn-primary)}
.cb-bar-fill-bad{background:var(--dsw-alias-state-error-primary)}
.cb-quota-summary{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:13px;color:var(--dsw-alias-label-secondary);min-width:0}
.cb-quota-summary>b{font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.cb-dot-sep::before{content:'·';color:var(--cb-muted)}
.cb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cb-quota-windows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px}
.cb-quota-window{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--cb-fill-soft)}
.cb-quota-window-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.cb-quota-window-reset{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cb-reset-countdown{display:inline}
.cb-quota-pct{font-variant-numeric:tabular-nums;font-size:22px;line-height:1.2;font-weight:700;color:var(--dsw-alias-label-primary)}
.cb-quota-pct-warn{color:var(--dsw-alias-state-warn-primary)}
.cb-quota-pct-bad{color:var(--dsw-alias-state-error-primary)}
.cb-quota-scroll{overflow-x:auto;display:flex;flex-direction:column;gap:8px}
.cb-quota-others th,.cb-quota-others td{white-space:nowrap}
.cb-quota-others td:first-child,.cb-quota-others th:first-child{white-space:normal;overflow-wrap:anywhere}

.cb-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px}
.cb-kpi{display:flex;flex-direction:column;gap:2px;min-width:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--cb-fill-soft)}
.cb-kpi>span{font-size:12px;color:var(--dsw-alias-label-secondary)}.cb-kpi>b{font-size:20px;line-height:1.3;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.cb-kpi>small{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}

.cb-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.cb-model-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}
.cb-model{display:grid;grid-template-columns:20px minmax(0,1fr);gap:8px 12px;align-items:start;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cb-model-list>div:last-child>.cb-model{border-bottom:0}
.cb-model>input[type=checkbox]{width:16px;height:16px;margin:4px 0 0}
.cb-model-main{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.cb-model-head{align-self:stretch;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.cb-model-id{display:block;font-family:var(--cb-mono);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-all}
.cb-metrics{align-self:stretch;display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:2px}
.cb-metric{display:flex;flex-direction:column;gap:2px;min-width:64px}
.cb-metric b{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.cb-metric span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.cb-editor{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px 16px;padding:12px 0 8px;min-width:0}
.cb-editor .cb-field{margin:0}
.cb-editor-note{grid-column:1/-1;display:flex;flex-direction:column;gap:12px}
.cb-editor-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
.cb-editor .cb-alert-ok,.cb-editor .cb-alert-bad{grid-column:1/-1;margin:0}

.cb-title-group{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px}
.cb-badge-accent{border-color:color-mix(in srgb,var(--cb-accent) 40%,transparent);color:var(--cb-accent);background:color-mix(in srgb,var(--cb-accent) 8%,transparent)}
.cb-filterbar{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--cb-fill-soft);min-width:0}
.cb-filterbar-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}
.cb-filterbar-selects{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto;min-width:0}
.cb-filterbar-selects .cb-input-sm{max-width:190px;background:var(--dsw-alias-bg-layer-3)}
.cb-filterbar-custom{align-items:flex-end;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l2)}
.cb-filterbar-custom .cb-field{flex:0 1 210px}.cb-filterbar-custom .cb-input-sm{width:100%;background:var(--dsw-alias-bg-layer-3)}
.cb-filterbar .cb-tabs{background:var(--cb-fill-strong)}
.cb-filterbar-scope{display:flex;flex-wrap:wrap;gap:4px 12px;font-variant-numeric:tabular-nums}
.cb-field-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.cb-chip-toggle[aria-pressed=true]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.cb-chip:disabled,.cb-tab:disabled{cursor:not-allowed;opacity:.6}
.cb-results{display:flex;flex-direction:column;gap:16px;min-width:0;container-type:inline-size;transition:opacity .15s ease}
@container (max-width:780px){.cb-results .cb-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.cb-results .cb-legend{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:460px){.cb-results .cb-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cb-results-loading{opacity:.55;pointer-events:none}
.cb-empty{padding:24px 0;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
.cb-panel{display:flex;flex-direction:column;gap:12px;min-width:0;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cb-insight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}
.cb-metric-inline{display:inline-flex;align-items:baseline;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:help}
.cb-metric-inline b{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.cb-stack{display:flex;gap:2px;height:12px;border-radius:999px;overflow:hidden;background:var(--cb-fill)}
.cb-stack-seg{flex-basis:0;min-width:3px}
.cb-seg-cacheReadTokens{background:color-mix(in srgb,var(--cb-accent) 35%,var(--dsw-alias-bg-layer-3))}
.cb-seg-inputTokens{background:var(--cb-accent)}
.cb-seg-cacheWriteTokens{background:var(--dsw-alias-state-warn-primary)}
.cb-seg-outputTokens{background:var(--dsw-alias-state-success-primary)}
.cb-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px 16px}
.cb-legend-item{display:flex;flex-direction:column;gap:2px;min-width:0}
.cb-legend-label{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.cb-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.cb-legend-item>b{display:flex;align-items:baseline;gap:6px;font-size:16px;line-height:1.4;font-weight:650;font-variant-numeric:tabular-nums}
.cb-legend-pct{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.cb-legend-item small{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.cb-page .cb-partial{color:var(--dsw-alias-state-warn-primary);cursor:help}
.cb-page .cb-kpi-note-warn{color:var(--dsw-alias-state-warn-primary)}
.cb-latency-grid{display:flex;flex-direction:column;font-variant-numeric:tabular-nums}
.cb-latency-row{display:grid;grid-template-columns:minmax(56px,1fr) repeat(3,minmax(0,1fr));gap:8px;align-items:baseline;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2);font-size:13px}
.cb-latency-row>:not(:first-child){text-align:right;white-space:nowrap}
.cb-latency-head{border-top:0;padding-top:0;font-size:11px;color:var(--dsw-alias-label-secondary)}
.cb-latency-row b{font-weight:650}
.cb-cost-total{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.cb-cost-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;max-height:240px;overflow-y:auto}
.cb-cost-list li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l2);font-size:13px}
.cb-cost-list li:first-child{border-top:0;padding-top:0}
.cb-cost-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-cost-amount{min-width:64px;text-align:right;font-variant-numeric:tabular-nums}
.cb-cost-foot{flex-wrap:nowrap}
.cb-share{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.cb-share-track{flex:1 1 60px;max-width:96px;height:6px;border-radius:999px;background:var(--cb-fill-strong);overflow:hidden}
.cb-share-fill{display:block;height:100%;border-radius:999px;background:var(--cb-accent)}
.cb-share-pct{min-width:44px;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cb-table .cb-share-col{width:170px}
.cb-table sup.cb-partial{margin-left:2px}
.cb-card-foot{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
.cb-page .cb-btn-danger-text{flex:none;color:var(--dsw-alias-state-error-primary)}
.cb-page details.cb-menu{position:relative;border-top:0;padding-top:0}
.cb-page .cb-menu>summary{list-style:none;padding:3px 10px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.cb-page .cb-menu>summary::-webkit-details-marker{display:none}
.cb-page .cb-menu>summary svg{margin-right:-4px}.cb-page .cb-menu[open]>summary svg{transform:rotate(180deg)}
.cb-hint{cursor:help;text-decoration:underline dotted var(--cb-muted);text-underline-offset:4px}
.cb-page .cb-menu>.cb-menu-list{margin:0}
.cb-menu-list{position:absolute;right:0;top:calc(100% + 4px);z-index:10;display:flex;flex-direction:column;min-width:120px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 6px 20px rgb(0 0 0 / 14%)}
.cb-menu-list button{appearance:none;border:0;background:none;font:inherit;font-size:13px;text-align:left;padding:6px 10px;border-radius:6px;color:var(--dsw-alias-label-primary);cursor:pointer}
.cb-menu-list button:hover:not(:disabled){background:var(--cb-fill)}.cb-menu-list button:disabled{color:var(--cb-muted);cursor:not-allowed}

.cb-table{width:100%;border-collapse:collapse}
.cb-table th{text-align:left;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}
.cb-table td{padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:13px;color:var(--dsw-alias-label-primary);vertical-align:middle}
.cb-table tbody th{font-size:13px;font-weight:400;color:var(--dsw-alias-label-primary)}
.cb-table tbody tr:last-child>*{border-bottom:0}
.cb-table tbody tr:hover>*{background:var(--cb-fill-soft)}
.cb-table td.cb-quota-pct-warn{color:var(--dsw-alias-state-warn-primary)}.cb-table td.cb-quota-pct-bad{color:var(--dsw-alias-state-error-primary)}
.cb-table .cb-num{text-align:right}.cb-nowrap{white-space:nowrap}.cb-table .cb-actions{text-align:right;white-space:nowrap}.cb-table .cb-actions .cb-row{justify-content:flex-end;flex-wrap:nowrap}
.cb-table-box{min-width:0;max-width:100%;overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cb-table-box .cb-table thead th{background:var(--cb-fill-soft)}
.cb-table.cb-facts th{width:140px;font-size:13px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.cb-facts th:first-child{padding-left:0}.cb-facts td:last-child{padding-right:0}.cb-facts tbody tr:hover>*{background:none}
.cb-facts a{color:var(--cb-accent)}
.cb-inline-facts{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}

.cb-alert-ok{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary);font-size:13px}
.cb-alert-bad{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);font-size:13px}
.cb-alert-err{padding:10px 14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);font-size:13px}
.cb-banner-warning{padding:12px 16px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:500}
.cb-banner-exhausted{padding:12px 16px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:600}
@media(max-width:600px){
  .cb-page{overflow-wrap:anywhere}
  .cb-page .cb-btn{white-space:normal;max-width:100%;min-width:0;flex-shrink:1}
  .cb-page .cb-input{min-width:0;max-width:100%}
  .cb-page .cb-model-head{flex-wrap:wrap}
  .cb-page .cb-metric{min-width:0}
  .cb-page .cb-table th,.cb-page .cb-table td{white-space:normal;padding:6px 8px}
  .cb-page .cb-table .cb-num,.cb-page .cb-table .cb-nowrap,.cb-page .cb-table code{white-space:nowrap;overflow-wrap:normal}
  .cb-page .cb-filterbar-selects{margin-left:0}.cb-page .cb-filterbar-selects .cb-input-sm{max-width:none;flex:1 1 140px}
  .cb-page .cb-table .cb-share-col{width:auto}.cb-page .cb-share-track{display:none}
  .cb-page .cb-facts th{width:auto}
  .cb-page .cb-route-form{grid-template-columns:minmax(0,1fr)}
  .cb-page .cb-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cb-page .cb-kpi{padding:10px 12px}.cb-page .cb-kpi>b{font-size:17px}
  .cb-page .cb-section-card{padding:16px}
}
`
      if (style.textContent !== css) style.textContent = css
      if (!existing) document.head.appendChild(style)
    }

