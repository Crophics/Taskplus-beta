/* views/tabbar-html.js — Fixed bottom tab bar (Today/All/[Add]/Week/Settings) */
(function (global) {
  function tabBarHtml({ tab }) {
    // The Courses screen is reached from Settings, so Settings stays
    // highlighted while it's open rather than showing no active tab.
    const effectiveTab = tab === 'courses' ? 'settings' : tab;
    function item(id, icon, label) {
      const active = effectiveTab === id;
      return `<button type="button" class="tp-tab${active ? ' tp-tab-active' : ''}" data-tab="${id}" aria-current="${active ? 'page' : 'false'}">
        ${window.TPIcons.svg(icon)}
        <span class="tp-tab-label">${label}</span>
      </button>`;
    }
    return `<nav class="tp-tabbar" id="tp-tabbar">
      ${item('today', 'calendar_today', 'Today')}
      ${item('all', 'format_list_bulleted', 'All')}
      <button type="button" class="tp-tab-add" id="tp-add-toggle" aria-label="Add assignment">${window.TPIcons.svg('plus')}</button>
      ${item('week', 'chart_bar', 'Week')}
      ${item('settings', 'cog_outline', 'Settings')}
    </nav>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.tabBarHtml = tabBarHtml;
})(typeof window !== 'undefined' ? window : globalThis);
