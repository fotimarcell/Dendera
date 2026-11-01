create table if not exists saved_setups (
  id         serial primary key,
  user_id    text not null,
  name       text not null,
  data       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists saved_setups_user_id_idx on saved_setups (user_id);
