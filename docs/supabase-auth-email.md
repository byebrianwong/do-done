# Signup confirmation email

Everything a new account sees between "Sign up" and being signed in. Half of it
is code (`apps/web/src/components/auth-card.tsx` → `/auth/callback`), half of it
is Supabase project config that lives only in the dashboard — which is why it is
written down here rather than being reviewable in a diff.

## Where the link goes

`signUp` passes an explicit `emailRedirectTo` of
`<origin>/auth/callback?next=/inbox`. That route is the **only** thing that
exchanges the code for a session; land anywhere else and the new account gets a
page with an unspent `?code=` in the address bar and no session.

Supabase silently ignores an `emailRedirectTo` that isn't allow-listed and falls
back to the Site URL, so both of these have to be set under
**Authentication → URL Configuration**:

| Field | Value |
| --- | --- |
| Site URL | `https://dodone.byebrianwong.com` |
| Redirect URLs | `https://dodone.byebrianwong.com/**`<br>`http://localhost:3000/**`<br>`https://do-done-*.vercel.app/**` (preview deploys)<br>`http://localhost:5173/**` (pantry app, Vite dev server)<br>`http://localhost:5179/**` (pantry app, preview server) |

Both are set. The Site URL was `http://localhost:3000`, which is what sent a
real signup confirmation to a dev server that wasn't running.

The two `localhost:517x` entries belong to the pantry app, not to DoDone. This
Supabase project is shared with it (see *What the email says*). They were added
on 2026-11-21. Leave them in place.

`localhost:3000` specifically — not whatever port `preview_start` picked. A
worktree session on 3001 can't complete a signup unless that port is
allow-listed too.

**Check the spelling against the allow-list entry.** A Site URL typo is
invisible in the dashboard and mostly invisible in use, because an explicit
`emailRedirectTo` that *is* allow-listed wins — it only surfaces on whatever
flow forgets to set one. `byebrainwong` sat there for a while.

## What the email says

The default was Supabase's, and it said so: subject "Confirm Your Signup", body
"Follow this link to confirm your user" / "Confirm your mail", sender
`Supabase Auth <noreply@mail.app.supabase.io>`. Nothing in it named DoDone.

Set under **Authentication → Emails → Confirm signup**, and this is what's
there now (since 2026-11-21).

Subject:

```
{{ if eq (printf "%v" .Data.app) "pantry" }}Confirm your email for Pantry{{ else }}Confirm your email for DoDone{{ end }}
```

Body:

```html
{{ if eq (printf "%v" .Data.app) "pantry" }}<h2>Confirm your email</h2>

<p>Welcome to Pantry. Confirm this address to finish setting up your account.</p>

<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>

<p>If you didn't sign up for Pantry, you can ignore this message — no account
will be created without this confirmation.</p>
{{ else }}<h2>Confirm your email</h2>

<p>Welcome to DoDone. Confirm this address to finish setting up your account.</p>

<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>

<p>If you didn't sign up for DoDone, you can ignore this message — no account
will be created without this confirmation.</p>
{{ end }}
```

`{{ .ConfirmationURL }}` is the only variable that matters for the link; it
already carries the token and the redirect.

### One template, two apps

The template picks its wording by app because this Supabase project is shared
with the pantry app. A project has one set of email templates, so both apps'
sign-ups send this one.

- **The pantry app's sign-up sends `app: 'pantry'` in the user metadata.**
  `{{ .Data }}` is the user metadata, so those sign-ups get the Pantry wording.
- **DoDone sends no `app` value**, on web or mobile. It falls through to the
  `else` branch and gets its original email, word for word.
- **The comparison is `eq (printf "%v" .Data.app) "pantry"` on purpose.**
  Sign-up metadata is whatever the client sends. A plain
  `eq .Data.app "pantry"` errors when `app` is a number, and a template that
  errors fails that sign-up with HTTP 500. `printf "%v"` turns any value into a
  string first, so the comparison cannot error.
- **It was tested before it went live**, on a local Auth server pinned to the
  hosted version (GoTrue v2.189.0). Six sign-ups: pantry, DoDone web, DoDone
  mobile, and `app` set to a number, to null and to an object. All six sent the
  right email.
- **It was applied with `supabase config push`**, from a scratch config file
  that declared only this template, so no other project setting changed.

The pantry side of the shared project is written down in the pantry repo's
`supabase/README.md`.

**Reset password** and **Magic link** are still Supabase's defaults, and they
name neither app. The same wording problem applies to them if either is ever
switched on. A custom version of either would need the same `.Data.app` switch.

## The sender

Until a custom SMTP provider is configured (**Project Settings → Auth → SMTP
Settings**), mail goes out as `noreply@mail.app.supabase.io` on Supabase's
shared service, which is rate-limited to a couple of messages an hour and is
documented as being for development only. That is fine for test accounts and
is not fine for anyone else signing up — a real launch needs Resend/Postmark/SES
wired in there, which also gets the `From:` name saying DoDone.

## Mobile

`apps/mobile` sends no `emailRedirectTo`, so a signup from the phone confirms
against the Site URL and ends up signed in **on the web**, not in the app. A
proper mobile confirmation is a `dodone://` deep link plus a handler that
exchanges the code against the app's own PKCE verifier — unbuilt, and worth
doing before anyone signs up from the phone first.
