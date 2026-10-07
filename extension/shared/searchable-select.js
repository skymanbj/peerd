// @ts-check
// SearchableSelect — a <select>-replacement with an inline search box.
//
// Props:
//   id        {string}              — forwarded to the trigger button
//   value     {string}              — current selected value
//   options   {{ value: string, label: string }[]}
//   onchange  {(value: string) => void}
//   placeholder {string}            — search placeholder text
//   searchMin {number}              — min query length to show filtered results (default 1)
//   class     {string}              — extra CSS class on the wrapper

import m from '/vendor/mithril/mithril.js';

/** @typedef {{ id?: string, value: string, options: { value: string, label: string }[], onchange: (v: string) => void, placeholder?: string, searchMin?: number, class?: string }} SearchableSelectAttrs */
/** @typedef {{ open: boolean, query: string, userTyped: boolean }} SearchableSelectState */
/** @typedef {{ attrs: SearchableSelectAttrs, state: SearchableSelectState }} SearchableSelectVnode */

export const SearchableSelect = {
  /** @param {SearchableSelectVnode} vnode */
  oninit(vnode) {
    vnode.state.open = false;
    vnode.state.query = '';
    vnode.state.userTyped = false;
  },
  /** @param {SearchableSelectVnode} vnode */
  view(vnode) {
    const { id, value, options, onchange, placeholder = '搜索…', searchMin = 1 } = vnode.attrs;
    const ui = vnode.state;
    const q = ui.query.toLowerCase();
    const showSearch = ui.userTyped && q.length >= searchMin;
    const filtered = showSearch
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options;
    const current = options.find((o) => o.value === value);

    const close = () => {
      ui.open = false;
      ui.query = '';
      ui.userTyped = false;
    };

    const displayValue = ui.open && ui.userTyped
      ? ui.query
      : (current ? current.label : value || '');

    return m('.searchable-select', { class: vnode.attrs.class ?? '' }, [
      m('input.searchable-select-trigger', {
        id,
        type: 'text',
        autocomplete: 'off',
        spellcheck: false,
        placeholder,
        value: displayValue,
        onfocus: (/** @type {FocusEvent} */ e) => {
          ui.open = true;
          ui.query = '';
          ui.userTyped = false;
          /** @type {HTMLInputElement} */ (e.target).select();
        },
        oninput: (/** @type {{ target: HTMLInputElement }} */ e) => {
          ui.open = true;
          ui.userTyped = true;
          ui.query = e.target.value;
        },
        onkeydown: (/** @type {KeyboardEvent} */ e) => {
          if (e.key === 'Escape') {
            close();
            /** @type {HTMLInputElement} */ (e.target).blur();
          } else if (e.key === 'Enter' && ui.open) {
            e.preventDefault();
            e.stopPropagation();
            if (filtered.length > 0) {
              onchange(filtered[0].value);
            }
            close();
            /** @type {HTMLInputElement} */ (e.target).blur();
          }
        },
      }),
      ui.open ? m('.searchable-select-backdrop', {
        onclick: (/** @type {Event} */ e) => {
          close();
          const trigger = /** @type {HTMLElement} */ (e.target).closest('.searchable-select')?.querySelector('.searchable-select-trigger');
          if (trigger) /** @type {HTMLInputElement} */ (trigger).blur();
        },
      }) : null,
      ui.open ? m('.searchable-select-dropdown', [
        m('.searchable-select-list', filtered.map((o) =>
          m('button.searchable-select-option', {
            type: 'button',
            class: o.value === value ? 'is-selected' : '',
            onclick: () => { onchange(o.value); close(); },
          }, o.label))),
        filtered.length === 0
          ? m('.searchable-select-empty', '无匹配结果')
          : null,
      ]) : null,
    ]);
  },
};
