-- Migration: Org-scoped integrations
-- Makes integrations belong to organizations and updates defaults/RLS

-- Ensure org_id is populated for all integrations
do $$
declare
  u record;
  v_org_id uuid;
  v_name text;
begin
  for u in select id, email from auth.users loop
    select id into v_org_id
    from organizations
    where owner_id = u.id and is_personal = true
    limit 1;

    if v_org_id is null then
      v_name := case
        when u.email is null or split_part(u.email, '@', 1) = '' then 'Personal Org'
        else split_part(u.email, '@', 1) || ' Org'
      end;

      insert into organizations (name, slug, is_personal, owner_id)
      values (v_name, 'personal-' || u.id, true, u.id)
      returning id into v_org_id;

      insert into org_members (org_id, user_id, role, status)
      values (v_org_id, u.id, 'owner', 'active')
      on conflict do nothing;
    end if;

    update user_integrations
    set org_id = v_org_id
    where user_id = u.id and org_id is null;
  end loop;
end $$;

alter table user_integrations
  alter column org_id set not null;

-- Replace unique constraint to be org-scoped
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'user_integrations_user_id_type_name_key'
  ) then
    alter table user_integrations
      drop constraint user_integrations_user_id_type_name_key;
  end if;
end $$;

alter table user_integrations
  add constraint user_integrations_org_type_name_key unique (org_id, type, name);

-- Update default integration trigger to be org-scoped
create or replace function ensure_single_default_integration()
returns trigger as $$
begin
  if new.is_default = true then
    update user_integrations
    set is_default = false
    where org_id = new.org_id
      and type = new.type
      and id != new.id;
  end if;
  return new;
end;
$$ language plpgsql;

-- Update RLS policies for org membership
alter table user_integrations enable row level security;

drop policy if exists "Users can view own integrations" on user_integrations;
drop policy if exists "Users can insert own integrations" on user_integrations;
drop policy if exists "Users can update own integrations" on user_integrations;
drop policy if exists "Users can delete own integrations" on user_integrations;

create policy "Org members can view integrations"
  on user_integrations for select
  using (
    exists (
      select 1
      from org_members m
      where m.org_id = user_integrations.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org admins can insert integrations"
  on user_integrations for insert
  with check (
    exists (
      select 1
      from org_members m
      where m.org_id = user_integrations.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can update integrations"
  on user_integrations for update
  using (
    exists (
      select 1
      from org_members m
      where m.org_id = user_integrations.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can delete integrations"
  on user_integrations for delete
  using (
    exists (
      select 1
      from org_members m
      where m.org_id = user_integrations.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );
