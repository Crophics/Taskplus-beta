/* theme.js — Theme application + theme-color meta */
(function (global) {
  const THEME_COLORS = { dark: '#161826', light: '#f4f2ec', blue: '#14161f' };

  function updateThemeColorMeta(eff) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', THEME_COLORS[eff] || THEME_COLORS.dark);
  }

  function applyTheme(theme) {
    let eff = theme;
    if (theme === 'auto') {
      eff =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    document.documentElement.setAttribute('data-theme', eff);
    updateThemeColorMeta(eff);
    return eff;
  }

  function watchSystemTheme(getTheme, onChange) {
    if (!window.matchMedia) return;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getTheme() === 'auto') {
        applyTheme('auto');
        if (onChange) onChange();
      }
    });
  }

  global.TPTheme = { THEME_COLORS, updateThemeColorMeta, applyTheme, watchSystemTheme };
})(typeof window !== 'undefined' ? window : globalThis);
