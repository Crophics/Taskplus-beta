/* views/onboarding-html.js — first-run flow: invite code, Google sign-in, Moodle, a short tour. Also the
   replayable tour (Settings -> Show the intro again). Pure markup; the steps and their logic live in app.js. */
(function (global) {
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
      body = ''; // the tour is drawn by js/tour.js over the whole screen
    } else {
      body = '<h1 class="tp-ob-title">Welcome to Taskplus</h1>';
    }
    const progress = index >= 0 && ob.step !== 'tour' ? `<div class="tp-ob-kicker">Step ${index + 1} of ${steps.length}</div>` : '';
    return `<div class="tp-ob">${progress}${body}</div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.onboardingHtml = onboardingHtml;
})(typeof window !== 'undefined' ? window : globalThis);
