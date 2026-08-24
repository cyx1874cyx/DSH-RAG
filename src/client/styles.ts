export const DSH_RAG_STYLES = String.raw`
.dsh-rag {
  --rag-bg: var(--dsw-alias-bg-base, #fff);
  --rag-layer-1: var(--dsw-alias-bg-layer-1, #f7f7f8);
  --rag-layer-2: var(--dsw-alias-bg-layer-2, #f0f1f3);
  --rag-text: var(--dsw-alias-label-primary, #171717);
  --rag-text-2: var(--dsw-alias-label-secondary, #53565c);
  --rag-text-3: var(--dsw-alias-label-tertiary, #7c8088);
  --rag-border: var(--dsw-alias-border-l2, #dedfe3);
  --rag-border-soft: var(--dsw-alias-border-l1, #ececef);
  --rag-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --rag-success: var(--dsw-alias-state-success-primary, #27ae60);
  --rag-warning: var(--dsw-alias-state-warn-primary, #d98c00);
  --rag-danger: var(--dsw-alias-state-error-primary, #d64045);
  --rag-hover: var(--dsw-alias-interactive-bg-hover-solid, #eceef2);
  color: var(--rag-text);
  font: var(--dsw-font-s-14, 14px/1.5 system-ui, sans-serif);
  box-sizing: border-box;
  width: 100%;
}
.dsh-rag *, .dsh-rag *::before, .dsh-rag *::after { box-sizing: border-box; }
.dsh-rag-page { max-width: 920px; margin: 0 auto; padding: 28px 28px 44px; }
.dsh-rag-conversation { max-width: 760px; }
.dsh-rag-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.dsh-rag-eyebrow { display: inline-flex; align-items: center; gap: 8px; color: var(--rag-text-3); font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif); margin-bottom: 5px; }
.dsh-rag-title { margin: 0; color: var(--rag-text); font: var(--dsw-font-xl-24, 600 24px/32px system-ui, sans-serif); letter-spacing: -.02em; }
.dsh-rag-subtitle { max-width: 680px; margin: 7px 0 0; color: var(--rag-text-2); line-height: 1.65; }
.dsh-rag-icon { width: 18px; height: 18px; flex: none; }
.dsh-rag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--rag-text-3); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rag-text-3) 12%, transparent); flex: none; }
.dsh-rag-dot[data-tone="success"] { background: var(--rag-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rag-success) 13%, transparent); }
.dsh-rag-dot[data-tone="warning"] { background: var(--rag-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rag-warning) 13%, transparent); }
.dsh-rag-dot[data-tone="danger"] { background: var(--rag-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rag-danger) 13%, transparent); }
.dsh-rag-boundary { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: flex-start; border: 1px solid var(--rag-border-soft); border-radius: 12px; background: var(--rag-layer-1); padding: 12px 13px; margin-bottom: 16px; }
.dsh-rag-boundary .dsh-rag-icon { color: var(--rag-accent); margin-top: 1px; }
.dsh-rag-boundary strong { display: block; margin-bottom: 3px; font-weight: 600; }
.dsh-rag-boundary p { margin: 0; color: var(--rag-text-2); font-size: 13px; line-height: 1.6; }
.dsh-rag-card { border: 1px solid var(--rag-border-soft); border-radius: 16px; background: var(--rag-bg); box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,.04)); overflow: hidden; margin-top: 14px; }
.dsh-rag-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; }
.dsh-rag-card-title { margin: 0; font: var(--dsw-font-base-strong-16, 600 16px/24px system-ui, sans-serif); }
.dsh-rag-card-description { margin: 4px 0 0; color: var(--rag-text-3); font-size: 13px; line-height: 1.5; }
.dsh-rag-state-badge { flex: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--rag-border-soft); border-radius: 999px; background: var(--rag-layer-1); color: var(--rag-text-2); padding: 4px 9px; font-size: 12px; }
.dsh-rag-state-badge[data-tone="success"] { color: var(--rag-success); }
.dsh-rag-state-badge[data-tone="warning"] { color: var(--rag-warning); }
.dsh-rag-state-badge[data-tone="danger"] { color: var(--rag-danger); }
.dsh-rag-card-body { padding: 2px 20px 20px; }
.dsh-rag-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dsh-rag-field { display: grid; gap: 6px; min-width: 0; color: var(--rag-text-2); font-size: 13px; }
.dsh-rag-field[data-span="full"] { grid-column: 1 / -1; }
.dsh-rag-input { appearance: none; width: 100%; min-width: 0; height: 38px; border: 1px solid var(--rag-border); border-radius: 10px; outline: none; background: var(--rag-layer-1); color: var(--rag-text); padding: 0 11px; font: inherit; transition: border-color .15s, box-shadow .15s, background .15s; }
.dsh-rag-input:hover { border-color: color-mix(in srgb, var(--rag-text-3) 55%, var(--rag-border)); }
.dsh-rag-input:focus { border-color: var(--rag-accent); background: var(--rag-bg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rag-accent) 14%, transparent); }
.dsh-rag-input::placeholder { color: var(--rag-text-3); }
.dsh-rag-hint { margin: 10px 0 0; color: var(--rag-text-3); font-size: 12px; line-height: 1.55; }
.dsh-rag-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
.dsh-rag-button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; border: 1px solid var(--rag-border); border-radius: 999px; background: var(--rag-bg); color: var(--rag-text); padding: 6px 13px; font: inherit; font-weight: 520; cursor: pointer; transition: background .15s, border-color .15s, transform .1s; }
.dsh-rag-button:hover:not(:disabled) { background: var(--rag-hover); border-color: color-mix(in srgb, var(--rag-text-3) 45%, var(--rag-border)); }
.dsh-rag-button:active:not(:disabled) { transform: translateY(1px); }
.dsh-rag-button:focus-visible, .dsh-rag-check-row:focus-within { outline: 2px solid var(--rag-accent); outline-offset: 2px; }
.dsh-rag-button[data-variant="primary"] { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--rag-text)); color: var(--dsw-alias-label-primary-inverted, var(--rag-bg)); }
.dsh-rag-button[data-variant="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, color-mix(in srgb, var(--rag-text) 86%, transparent)); }
.dsh-rag-button[data-variant="danger"] { color: var(--rag-danger); }
.dsh-rag-button:disabled { opacity: .42; cursor: not-allowed; }
.dsh-rag-divider { height: 1px; background: var(--rag-border-soft); margin: 18px -20px; }
.dsh-rag-message { display: flex; align-items: flex-start; gap: 9px; border: 1px solid var(--rag-border-soft); border-radius: 12px; background: var(--rag-layer-1); color: var(--rag-text-2); padding: 10px 12px; margin: 14px 0 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.dsh-rag-message[data-kind="error"] { border-color: color-mix(in srgb, var(--rag-danger) 28%, var(--rag-border)); background: color-mix(in srgb, var(--rag-danger) 6%, var(--rag-bg)); color: var(--rag-danger); }
.dsh-rag-library-list { display: grid; gap: 10px; }
.dsh-rag-library { border: 1px solid var(--rag-border-soft); border-radius: 14px; background: var(--rag-layer-1); padding: 14px; }
.dsh-rag-library-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.dsh-rag-library-name { display: flex; align-items: center; gap: 9px; min-width: 0; font-weight: 600; }
.dsh-rag-library-name > span:last-child { overflow-wrap: anywhere; }
.dsh-rag-meta { display: flex; flex-wrap: wrap; gap: 7px 14px; margin-top: 8px; color: var(--rag-text-3); font-size: 12px; }
.dsh-rag-roots { display: grid; gap: 5px; margin-top: 10px; }
.dsh-rag-root { display: block; min-width: 0; border: 1px solid var(--rag-border-soft); border-radius: 8px; background: var(--rag-bg); color: var(--rag-text-2); padding: 6px 8px; font: var(--dsw-font-markdown-code-block-small, 12px/18px ui-monospace, monospace); overflow-wrap: anywhere; }
.dsh-rag-delete-confirm { border: 1px solid color-mix(in srgb, var(--rag-danger) 28%, var(--rag-border)); border-radius: 10px; background: color-mix(in srgb, var(--rag-danger) 6%, var(--rag-bg)); margin-top: 10px; padding: 10px 12px; }
.dsh-rag-delete-confirm p { margin: 0; color: var(--rag-text-2); font-size: 12px; line-height: 1.55; }
.dsh-rag-delete-confirm .dsh-rag-actions { margin-top: 9px; }
.dsh-rag-empty { border: 1px dashed var(--rag-border); border-radius: 14px; color: var(--rag-text-3); text-align: center; padding: 24px 18px; }
.dsh-rag-counter { flex: none; border: 1px solid var(--rag-border-soft); border-radius: 999px; background: var(--rag-layer-1); color: var(--rag-text-2); padding: 5px 10px; font-size: 12px; }
.dsh-rag-check-list { display: grid; gap: 10px; }
.dsh-rag-check-row { position: relative; display: flex; align-items: center; gap: 12px; min-height: 60px; border: 1px solid var(--rag-border-soft); border-radius: 14px; background: var(--rag-layer-1); padding: 12px 14px; cursor: pointer; transition: border-color .15s, background .15s; }
.dsh-rag-check-row:hover { background: var(--rag-hover); }
.dsh-rag-check-row[data-selected="true"] { border-color: color-mix(in srgb, var(--rag-accent) 42%, var(--rag-border)); background: color-mix(in srgb, var(--rag-accent) 7%, var(--rag-bg)); }
.dsh-rag-checkbox { appearance: none; width: 18px; height: 18px; flex: none; border: 1.5px solid var(--rag-border); border-radius: 5px; background: var(--rag-bg); display: grid; place-items: center; }
.dsh-rag-checkbox::after { content: ''; width: 8px; height: 5px; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg) translate(1px,-1px); opacity: 0; }
.dsh-rag-checkbox:checked { border-color: var(--rag-accent); background: var(--rag-accent); color: white; }
.dsh-rag-checkbox:checked::after { opacity: 1; }
.dsh-rag-check-copy { min-width: 0; }
.dsh-rag-check-name { display: block; color: var(--rag-text); font-weight: 550; overflow-wrap: anywhere; }
.dsh-rag-check-meta { display: block; color: var(--rag-text-3); margin-top: 2px; font-size: 12px; }
.dsh-rag-command { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; border: 1px solid var(--rag-border-soft); border-radius: 14px; background: var(--rag-layer-1); padding: 14px; margin-top: 14px; }
.dsh-rag-command strong { display: block; margin-bottom: 4px; }
.dsh-rag-command p { margin: 0; color: var(--rag-text-3); font-size: 12px; }
.dsh-rag-code { display: inline-block; border: 1px solid var(--rag-border); border-radius: 9px; background: var(--dsw-alias-markdown-code-block, var(--rag-bg)); color: var(--rag-text); padding: 6px 9px; font: var(--dsw-font-markdown-code-block-small, 12px/18px ui-monospace, monospace); white-space: nowrap; }
.dsh-rag-tool { border: 1px solid var(--rag-border-soft); border-radius: 14px; background: var(--rag-bg); padding: 14px; margin: 4px; }
.dsh-rag-tool-head { display: flex; align-items: center; gap: 8px; }
.dsh-rag-tool-mode { color: var(--rag-text-3); margin: 6px 0 0; font-size: 12px; }
.dsh-rag-source { border-top: 1px solid var(--rag-border-soft); padding: 14px 0 2px; margin-top: 12px; }
.dsh-rag-source-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dsh-rag-source-title { overflow-wrap: anywhere; }
.dsh-rag-source-meta { color: var(--rag-text-3); margin-top: 4px; font-size: 12px; }
.dsh-rag-context { color: var(--rag-text-2); margin: 10px 0 0; font-size: 13px; }
.dsh-rag-snippet { border-left: 2px solid var(--rag-border); color: var(--rag-text-2); margin: 10px 0; padding-left: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.dsh-rag-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 720px) {
  .dsh-rag-page { padding: 22px 18px 36px; }
  .dsh-rag-form-grid { grid-template-columns: 1fr; }
  .dsh-rag-field[data-span="full"] { grid-column: auto; }
  .dsh-rag-command { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-rag * { transition: none !important; }
}
`
