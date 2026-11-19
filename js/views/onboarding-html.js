/* views/onboarding-html.js — first-run flow: invite code, Google sign-in, Moodle, a short tour. Also the
   replayable tour (Settings -> Show the intro again). Pure markup; the steps and their logic live in app.js. */
(function (global) {
  const TOUR = [
    { title: 'Your day, sorted', text: 'Today shows only what needs doing today. Tap + to log a bit of progress, or the check to finish something. Work you could do early waits under Get ahead, and it is optional.' },
    { title: 'How long will it take?', text: 'Each assignment from Moodle gets a time estimate, split into parts, one part per day, so big work never piles up. Tap an assignment to see or change its plan. When you finish one, say how long it really took and later estimates get better.' },
    { title: 'See the week ahead', text: 'Week shows how much work lands on each day, so you can spot a heavy day early. Tap a day to see what is in it.' },
    { title: 'Everything in one place', text: 'All lists every assignment. Group by due date or by course, search, or show just one course. Overdue work you no longer need can be ignored.' },
    { title: 'Moving around', text: 'Swipe left or right to switch between Today, Week and All. Pull down on a screen to sync with Moodle. Swipe from the left edge to go back.' },
    { title: 'Alerts', text: 'Turn on notifications in Settings to hear about new assignments, moved due dates and things due soon, even with the app closed. On iPhone, add Taskplus to your Home Screen first (Share, then Add to Home Screen).' },
  ];

  function dotsHtml(count, active) {
    let d = '';
    for (let i = 0; i < count; i++) d += `<span class="tp-ob-dot${i === active ? ' tp-ob-dot-on' : ''}"></span>`;
    return `<div class="tp-ob-dots" aria-hidden="true">${d}</div>`;
  }

  function onboardingHtml(ctx) {
    const { ob, escapeHtml, busy } = ctx;
    const steps = ob.required ? ['invite', 'signin', 'moodle', 'tour'] : ['signin', 'moodle', 'tour'];
    const index = ob.replay ? -1 : steps.indexOf(ob.step);
    const dis = busy ? ' disabled' : '';
    const err = `<div class="tp-ob-error" role="alert">${ob.error ? escapeHtml(ob.error) : ''}</div>`;
    let body;
    if (ob.step === 'invite') {
      body = `<h1 class="tp-ob-title">Welcome to Taskplus</h1>
        <p class="tp-ob-text">Taskplus is invite-only for now. Enter the code you were given.</p>
        <input class="tp-ob-input" id="tp-ob-invite" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="Invite code" value="${escapeHtml(ob.invite || '')}"${dis}>
        ${err}
        <button type="button" class="tp-ob-primary" data-ob="next"${dis}>${busy ? 'Checking…' : 'Continue'}</button>`;
    } else if (ob.step === 'signin') {
      body = `<h1 class="tp-ob-title">${ob.required ? 'Code accepted. ' : ''}Sign in</h1>
        <p class="tp-ob-text">Sign in with Google so your assignments, notes and settings follow you to every device, and so Taskplus can check Moodle for you.</p>
        ${err}
        <button type="button" class="tp-ob-primary" data-ob="google"${dis}>Continue with Google</button>
        <button type="button" class="tp-ob-link" data-ob="skip"${dis}>Skip for now</button>`;
    } else if (ob.step === 'moodle') {
      body = `<h1 class="tp-ob-title">Connect Moodle</h1>
        <p class="tp-ob-text">Taskplus imports your assignments and quizzes from Moodle and keeps them up to date. Your password is used once to get an access token and is never stored.</p>
        ${err}
        <button type="button" class="tp-ob-primary" data-ob="connect"${dis}>Connect Moodle</button>
        <button type="button" class="tp-ob-link" data-ob="skip"${dis}>I will add things by hand</button>`;
    } else if (ob.step === 'tour') {
      const page = Math.min(Math.max(ob.page || 0, 0), TOUR.length - 1);
      const last = page === TOUR.length - 1;
      body = `<div class="tp-ob-kicker">${ob.replay ? 'Intro' : 'How it works'} · ${page + 1} of ${TOUR.length}</div>
        <h1 class="tp-ob-title">${escapeHtml(TOUR[page].title)}</h1>
        <p class="tp-ob-text">${escapeHtml(TOUR[page].text)}</p>
        ${dotsHtml(TOUR.length, page)}
        <button type="button" class="tp-ob-primary" data-ob="${last ? 'finish' : 'next'}">${last ? (ob.replay ? 'Done' : 'Start using Taskplus') : 'Next'}</button>
        ${page > 0 ? '<button type="button" class="tp-ob-link" data-ob="back">Back</button>' : (ob.replay ? '<button type="button" class="tp-ob-link" data-ob="finish">Close</button>' : '<button type="button" class="tp-ob-link" data-ob="finish">Skip the tour</button>')}`;
    } else {
      body = '<h1 class="tp-ob-title">Welcome to Taskplus</h1>';
    }
    const progress = index >= 0 && ob.step !== 'tour' ? `<div class="tp-ob-kicker">Step ${index + 1} of ${steps.length}</div>` : '';
    return `<div class="tp-ob">${progress}${body}</div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.onboardingHtml = onboardingHtml;
  global.TPViews.TOUR_PAGES = TOUR.length;
})(typeof window !== 'undefined' ? window : globalThis);
