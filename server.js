'use strict';

/**
 * Minimal, production-safe Google OAuth service for Railway.
 * - Absolute callback URL to prevent redirect_uri_mismatch
 * - trust proxy + HTTPS redirect for correct protocol behind Railway
 * - Session-based login with domain gating to qla.qfschools.qa
 *
 * Dependencies (install if needed):
 *   npm i express express-session passport passport-google-oauth20 cookie-parser
 */

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

////////////////////////////////////////////////////////////////////////////////
// Configuration (env-first, with sane defaults for your deployment)
////////////////////////////////////////////////////////////////////////////////

const APP_URL = process.env.APP_URL || 'https://qla.up.railway.app'; // <-- your Railway domain
const PORT = process.env.PORT || 8080;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '467065313104-kl7djsf94og0lhll04fnt958jcq79v0q.apps.googleusercontent.com';

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ||
  // NOTE: for safety, prefer setting GOOGLE_CLIENT_SECRET in Railway variables.
  // If you leave a literal secret here while testing, ROTATE it afterwards.
  'REPLACE_WITH_GOOGLE_CLIENT_SECRET';

const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ||
  `${APP_URL}/auth/google/callback`; // <-- absolute and must match Google Console exactly

const ALLOWED_HOSTED_DOMAIN = process.env.ALLOWED_HOSTED_DOMAIN || 'qla.qfschools.qa';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'replace-me-with-a-long-random-secret-and-do-not-commit';

////////////////////////////////////////////////////////////////////////////////
// App & Middleware
////////////////////////////////////////////////////////////////////////////////

const app = express();

// Railway is behind a proxy; this ensures req.protocol === 'https' when appropriate
app.set('trust proxy', 1);

// Optionally force HTTPS (prevents accidental http callback regeneration)
app.use((req, res, next) => {
  // Respect Railway's X-Forwarded-Proto
  const xfProto = (req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (xfProto && xfProto !== 'https') {
    const url = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, url);
  }
  return next();
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session (cookie-based). For production over HTTPS only:
app.use(
  session({
    name: 'qla.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true, // requires HTTPS (we enforced it above)
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

////////////////////////////////////////////////////////////////////////////////
// Passport: Google OAuth 2.0
////////////////////////////////////////////////////////////////////////////////

passport.serializeUser((user, done) => {
  // Keep the session small; store only minimal fields
  done(null, { id: user.id, email: user.email, name: user.name, picture: user.picture });
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Hosted domain claim appears only for Workspace accounts
        const hd = profile._json && profile._json.hd ? profile._json.hd.toLowerCase() : '';
        if (ALLOWED_HOSTED_DOMAIN && hd !== ALLOWED_HOSTED_DOMAIN.toLowerCase()) {
          return done(null, false, { message: `Unauthorized domain: ${hd}` });
        }

        // Build a minimal user object
        const user = {
          id: profile.id,
          email: profile.emails && profile.emails[0] ? profile.emails[0].value : '',
          name: profile.displayName || '',
          picture:
            (profile.photos && profile.photos[0] && profile.photos[0].value) || undefined,
          hd,
        };

        // TODO: Optionally look up / create user in DB here.

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

////////////////////////////////////////////////////////////////////////////////
// Auth routes
////////////////////////////////////////////////////////////////////////////////

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'Not authenticated' });
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Kick off OAuth. `hd` narrows the chooser; we still enforce domain in verify above.
app.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
    hd: ALLOWED_HOSTED_DOMAIN, // hint only
  })
);

// Callback must match GOOGLE_CALLBACK_URL exactly
app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/failure',
    keepSessionInfo: true,
  }),
  (req, res) => {
    // Success → redirect to your app’s landing/dashboard
    res.redirect('/');
  }
);

app.get('/auth/failure', (req, res) => {
  res
    .status(401)
    .send(
      `<h1>Sign-in failed</h1><p>There was a problem signing you in with Google.</p>`
    );
});

app.get('/logout', (req, res, next) => {
  // Passport 0.6: logout is async with callback
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('qla.sid');
      res.redirect('/');
    });
  });
});

app.get('/me', ensureAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

////////////////////////////////////////////////////////////////////////////////
// Start server
////////////////////////////////////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log(`[qla] Service listening on ${PORT}`);
  console.log(`[qla] App URL: ${APP_URL}`);
  console.log(`[qla] Google Callback URL: ${GOOGLE_CALLBACK_URL}`);
});
