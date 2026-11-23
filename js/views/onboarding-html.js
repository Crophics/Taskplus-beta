/* views/onboarding-html.js — first-run flow: invite code, Google sign-in, Moodle, a short tour. Also the
   replayable tour (Settings -> Show the intro again). Pure markup; the steps and their logic live in app.js. */
(function (global) {
  function onboardingHtml(ctx) {
    const { ob, escapeHtml, busy } = ctx;
    const steps = (ob.install ? ['install'] : []).concat(ob.required ? ['invite'] : [], ['signin', 'moodle', 'tour']);
    const index = ob.replay ? -1 : steps.indexOf(ob.step);
    const dis = busy ? ' disabled' : '';
    const err = `<div class="tp-ob-error" role="alert">${ob.error ? escapeHtml(ob.error) : ''}</div>`;
    let body;
    if (ob.step === 'install') {
      body = `<h1 class="tp-ob-title">Add Taskplus to your Home Screen</h1>
        <p class="tp-ob-text">On iPhone, alerts only work from the Home Screen app, and it keeps you signed in. Do this first, then continue there:</p>
        <ol class="tp-ob-steps">
          <li>Tap the <strong>Share</strong> button <svg class="tp-ob-share" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/></svg> at the bottom of Safari.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>Taskplus</strong> from your Home Screen and set up there.</li>
        </ol>
        <button type="button" class="tp-ob-link" data-ob="later">I will do it later, continue here</button>`;
    } else if (ob.step === 'welcome') {
      // Invite-only: a new person redeems a code; someone who already activated an account just signs in (new device).
      body = `<h1 class="tp-ob-title">Welcome to Taskplus</h1>
        <p class="tp-ob-text">Taskplus is invite-only for now. New here? Redeem your invite code. Already have an account, for example on another device? Sign in.</p>
        ${err}
        <button type="button" class="tp-ob-primary" data-ob="havecode"${dis}>I have an invite code</button>
        <button type="button" class="tp-ob-secondary" data-ob="existing"${dis}>${busy ? 'Signing in…' : 'Sign in to my account'}</button>`;
    } else if (ob.step === 'invite') {
      body = `<h1 class="tp-ob-title">Redeem your invite code</h1>
        <p class="tp-ob-text">Enter the code you were given. You will sign in next.</p>
        <input class="tp-ob-input" id="tp-ob-invite" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="Invite code" value="${escapeHtml(ob.invite || '')}"${dis}>
        ${err}
        <button type="button" class="tp-ob-primary" data-ob="next"${dis}>${busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" class="tp-ob-link" data-ob="back"${dis}>Back</button>`;
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
