// @ts-check
// locale.js — lightweight i18n for the home page.
//
// Stores language preference in localStorage ('zh' | 'en').
// Provides t(zh, en) to pick the right string at render time.
// Cross-tab sync via the storage event.

const STORAGE_KEY = 'peerd.home.locale';

/** @returns {'zh'|'en'} */
export const getLocale = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' ? 'en' : 'zh';
  } catch { return 'zh'; }
};

/** @param {'zh'|'en'} loc */
export const setLocale = (loc) => {
  try { localStorage.setItem(STORAGE_KEY, loc); } catch { /* private mode */ }
};

/**
 * Pick the correct string for the current locale.
 * Usage: t('中文', 'English')
 * @param {string} zh
 * @param {string} en
 * @returns {string}
 */
export const t = (zh, en) => getLocale() === 'zh' ? zh : en;
