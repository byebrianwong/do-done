-- OAuth 2.1 authorization server backing the hosted MCP endpoint (/api/mcp).
--
-- Claude's custom-connector UI speaks OAuth only: it discovers an authorization
-- server, registers itself dynamically, and drives an authorization-code +
-- PKCE flow. A static shared secret has nowhere to go in that UI, so these
-- tables hold the state that flow needs.
--
-- Secrets rule: authorization codes, access tokens, and refresh tokens are
-- stored ONLY as SHA-256 hashes. A dump of these tables must not let anyone
-- replay a credential.
--
-- RLS is enabled with NO policies on every table: the service role (which
-- bypasses RLS) is the only thing that touches them. End users never read
-- these rows directly, so there is nothing to grant.

-- Clients registered via Dynamic Client Registration (RFC 7591). All clients
-- are public (no secret): Claude is a browser/native app and proves itself
-- with PKCE instead. ip_hash is a salted hash used only for rate limiting —
-- registration is necessarily an unauthenticated endpoint.
create table oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null check (array_length(redirect_uris, 1) > 0),
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  token_endpoint_auth_method text not null default 'none',
  ip_hash text,
  created_at timestamptz not null default now()
);

create index oauth_clients_ip_hash_idx on oauth_clients (ip_hash, created_at desc);

alter table oauth_clients enable row level security;

-- One row per authorization attempt, covering both phases of the flow:
--   1. /oauth/authorize creates it pending (id doubles as the unguessable
--      CSRF token for the consent form — it is bound to user_id, so a
--      cross-site POST cannot approve someone else's request).
--   2. On approval the row gains code_hash; /api/oauth/token consumes it.
-- code_challenge_method is constrained to S256: OAuth 2.1 drops "plain".
create table oauth_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  scope text,
  resource text,
  state text,
  code_hash text unique,
  approved_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index oauth_authorization_requests_expires_idx
  on oauth_authorization_requests (expires_at);

alter table oauth_authorization_requests enable row level security;

-- Issued token pairs. refresh_token_hash is nullable so a token pair can be
-- issued without refresh, and rotation revokes the old row rather than
-- updating it in place, keeping an audit trail of what was issued.
create table oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text not null references oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text,
  resource text,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_tokens_user_idx on oauth_tokens (user_id, created_at desc);
create index oauth_tokens_access_expires_idx on oauth_tokens (access_expires_at);

alter table oauth_tokens enable row level security;

-- Housekeeping: consumed/expired authorization requests are worthless, and
-- fully-dead token rows (access AND refresh expired, or revoked long ago)
-- only add bulk. Kept as a function so it can be scheduled or run by hand.
create or replace function oauth_cleanup_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from oauth_authorization_requests
    where expires_at < now() - interval '1 day';
  delete from oauth_tokens
    where coalesce(refresh_expires_at, access_expires_at) < now() - interval '30 days'
       or revoked_at < now() - interval '30 days';
$$;

revoke execute on function oauth_cleanup_expired() from public, anon, authenticated;
grant execute on function oauth_cleanup_expired() to service_role;

-- Schedule daily cleanup when pg_cron is available (it is, for calendar sync),
-- but do not fail the migration on installs without it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'oauth-cleanup-expired',
      '17 4 * * *',
      $cron$select oauth_cleanup_expired();$cron$
    );
  end if;
exception
  when others then
    raise notice 'oauth cleanup not scheduled: %', sqlerrm;
end;
$$;
