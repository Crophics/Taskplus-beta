/* views/tabbar-html.js - Fixed bottom tab bar: Today / Week / All / Courses.
   The app is built around Moodle, so there is no Add button here: adding by hand is a quiet fallback
   (a link at the bottom of All, and a row in Settings). What's new and Settings sit in every main
   screen's header (TPViews.headerActionsHtml). */
(function (global) {
  function tabBarHtml({ tab }) {
    // A course detail keeps Courses lit. Settings and the course manager are not tabs, so
    // nothing is highlighted while they are open.
    const effectiveTab = tab === 'course' ? 'courses' : (tab === 'manage' || tab === 'settings') ? null : tab;
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
        ${item('all', 'format_list_bulleted', 'All')}
        ${item('courses', 'book_open', 'Courses')}
      </div>
    </nav>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.tabBarHtml = tabBarHtml;
})(typeof window !== 'undefined' ? window : globalThis);
