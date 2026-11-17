/* views/tabbar-html.js — Fixed bottom tab bar (Today / Week / Courses).
   Settings is reached from the gear on Today; the All list from the Week
   screen; adding an assignment by hand from the + on Week (imported Moodle
   work is the main source now, so manual adds are deliberately tucked away). */
(function (global) {
  function tabBarHtml({ tab }) {
    // Drill-down screens keep their parent's tab lit: All hangs off Week.
    // Settings is not a tab, so nothing is highlighted while it is open.
    const effectiveTab = tab === 'all' ? 'week' : tab;
    function item(id, icon, label) {
      const active = effectiveTab === id;
      return `<button type="button" class="tp-tab${active ? ' tp-tab-active' : ''}" data-tab="${id}" aria-current="${active ? 'page' : 'false'}">
        ${window.TPIcons.svg(icon)}
        <span class="tp-tab-label">${label}</span>
      </button>`;
    }
    return `<nav class="tp-tabbar" id="tp-tabbar">
      <div class="tp-tabbar-inner">
        ${item('today', 'calendar_today', 'Today')}
        ${item('week', 'chart_bar', 'Week')}
        ${item('courses', 'format_list_bulleted', 'Courses')}
      </div>
    </nav>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.tabBarHtml = tabBarHtml;
})(typeof window !== 'undefined' ? window : globalThis);
