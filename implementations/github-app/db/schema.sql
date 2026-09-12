-- Watchman — state.
--
-- M0 does not run this. The spine's only durable fact (which comment is ours)
-- is rediscoverable by scanning the thread, so M0 caches it in memory and pays
-- one extra list call after a cold start. M1 lands the Neon-backed store, at
-- which point findings need to survive and this file starts being applied.

create table if not exists installations (
  id              bigint primary key,          -- GitHub installation id
  account         text        not null,
  gate_mode       text        not null default 'advisory'
                  check (gate_mode in ('advisory', 'required')),
  budget_usd      numeric(8,2),
  created_at      timestamptz not null default now()
);

create table if not exists reviews (
  id              bigserial primary key,
  installation_id bigint      not null references installations(id) on delete cascade,
  repo            text        not null,        -- owner/name
  pr_number       integer     not null,
  head_sha        text        not null,
  base_ref        text        not null,
  trigger         text        not null,
  verdict         text,                        -- null while in flight
  tier            text,                        -- triage | full | incremental
  rubric_sha      text,
  tokens_in       integer,
  tokens_out      integer,
  cost_cents      integer,
  duration_ms     integer,
  comment_id      bigint,
  check_run_id    bigint,
  created_at      timestamptz not null default now()
);

create index if not exists reviews_pr_idx on reviews (repo, pr_number, created_at desc);

-- The sticky slot. One row per pull request, for the fast path in the upsert.
create table if not exists sticky_comments (
  pr_key          text primary key,            -- owner/repo#123
  comment_id      bigint      not null,
  updated_at      timestamptz not null default now()
);

-- Findings outlive the review that raised them: that is what makes an unresolved
-- finding ageable, and what lets a third of them become decision files instead
-- of code changes.
create table if not exists findings (
  id               bigserial primary key,
  review_id        bigint      not null references reviews(id) on delete cascade,
  fingerprint      text        not null,       -- sha256(title + source + module)
  severity         text        not null check (severity in ('info', 'warn', 'block')),
  title            text        not null,
  body             text        not null,
  suggested_action text        not null,
  source           text        not null,
  state            text        not null default 'open'
                   check (state in ('open', 'resolved', 'accepted')),
  first_seen_sha   text        not null,
  created_at       timestamptz not null default now()
);

create unique index if not exists findings_identity_idx on findings (review_id, fingerprint);

-- Webhook deliveries are at-least-once. Remember what we have already seen.
create table if not exists deliveries (
  delivery_id     text primary key,
  received_at     timestamptz not null default now()
);
