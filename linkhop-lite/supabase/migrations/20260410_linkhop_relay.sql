-- LinkHop relay schema: durable devices + evictable events

create schema if not exists linkhop;

create table if not exists linkhop.linkhop_events (
  id bigint generated always as identity primary key,
  network_id text not null,
  topic text not null,
  event_id text not null,
  from_device_id text not null,
  event_type text not null,
  event_ts timestamptz not null,
  envelope jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists linkhop_events_network_event_uq
  on linkhop.linkhop_events (network_id, event_id);

create index if not exists linkhop_events_topic_id_idx
  on linkhop.linkhop_events (topic, id);

create index if not exists linkhop_events_type_created_idx
  on linkhop.linkhop_events (event_type, created_at desc);

create table if not exists linkhop.linkhop_devices (
  network_id text not null,
  device_id text not null,
  device_topic text not null,
  device_name text not null,
  device_kind text,
  capabilities jsonb not null default '[]'::jsonb,
  last_event_id text,
  last_event_type text not null,
  last_event_at timestamptz not null,
  is_removed boolean not null default false,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (network_id, device_id)
);

create index if not exists linkhop_devices_network_active_idx
  on linkhop.linkhop_devices (network_id, is_removed, last_event_at desc);


create table if not exists linkhop.linkhop_webpush_subscriptions (
  topic text not null,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic, endpoint)
);

create index if not exists linkhop_webpush_topic_idx
  on linkhop.linkhop_webpush_subscriptions (topic, updated_at desc);


create table if not exists linkhop.linkhop_webpush_delivery_queue (
  id bigint generated always as identity primary key,
  topic text not null,
  endpoint text not null,
  payload jsonb not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create index if not exists linkhop_webpush_delivery_status_idx
  on linkhop.linkhop_webpush_delivery_queue (status, created_at asc);

create or replace function linkhop.upsert_linkhop_device_from_event(e jsonb)
returns void
language plpgsql
as $$
declare
  v_type text := e->>'type';
  v_network_id text := e->>'network_id';
  v_device_id text := e->>'from_device_id';
  v_event_id text := e->>'event_id';
  v_event_ts timestamptz := (e->>'timestamp')::timestamptz;
  v_payload jsonb := coalesce(e->'payload', '{}'::jsonb);
begin
  if v_type not in ('device.announce', 'device.rename', 'device.heartbeat', 'device.remove') then
    return;
  end if;

  if v_network_id is null or v_device_id is null or v_event_ts is null then
    return;
  end if;

  insert into linkhop.linkhop_devices (
    network_id,
    device_id,
    device_topic,
    device_name,
    device_kind,
    capabilities,
    last_event_id,
    last_event_type,
    last_event_at,
    is_removed,
    removed_at,
    updated_at
  ) values (
    v_network_id,
    v_device_id,
    coalesce(v_payload->>'device_topic', ''),
    coalesce(v_payload->>'device_name', v_device_id),
    v_payload->>'device_kind',
    coalesce(v_payload->'capabilities', '[]'::jsonb),
    v_event_id,
    v_type,
    v_event_ts,
    (v_type = 'device.remove'),
    case when v_type = 'device.remove' then v_event_ts else null end,
    now()
  )
  on conflict (network_id, device_id)
  do update set
    device_topic = case
      when v_type = 'device.heartbeat' then linkhop.linkhop_devices.device_topic
      else coalesce(v_payload->>'device_topic', linkhop.linkhop_devices.device_topic)
    end,
    device_name = case
      when v_type = 'device.heartbeat' then linkhop.linkhop_devices.device_name
      else coalesce(v_payload->>'device_name', linkhop.linkhop_devices.device_name)
    end,
    device_kind = coalesce(v_payload->>'device_kind', linkhop.linkhop_devices.device_kind),
    capabilities = case
      when v_type = 'device.heartbeat' then linkhop.linkhop_devices.capabilities
      else coalesce(v_payload->'capabilities', linkhop.linkhop_devices.capabilities)
    end,
    last_event_id = coalesce(v_event_id, linkhop.linkhop_devices.last_event_id),
    last_event_type = v_type,
    last_event_at = greatest(linkhop.linkhop_devices.last_event_at, v_event_ts),
    is_removed = case
      when v_type = 'device.remove' then true
      when v_type = 'device.announce' then false
      else linkhop.linkhop_devices.is_removed
    end,
    removed_at = case
      when v_type = 'device.remove' then v_event_ts
      else linkhop.linkhop_devices.removed_at
    end,
    updated_at = now();
end;
$$;

create or replace function linkhop.evict_linkhop_message_events(retention interval default interval '72 hours')
returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from linkhop.linkhop_events
  where event_type like 'msg.%'
    and created_at < (now() - retention);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Optional pg_cron scheduling (safe no-op if extension unavailable)
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable; schedule eviction externally';
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1
      from cron.job
      where jobname = 'linkhop-evict-message-events-72h'
    ) then
      perform cron.schedule(
        'linkhop-evict-message-events-72h',
        '15 * * * *',
        $$select linkhop.evict_linkhop_message_events(interval '72 hours');$$
      );
    end if;
  end if;
end;
$$;
