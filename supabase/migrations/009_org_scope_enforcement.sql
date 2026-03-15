-- Migration: Enforce org scope for core entities
-- Ensures projects/reports/rule_sets/rules are org-isolated

-- Backfill org_id for existing rows using personal orgs
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

    update projects set org_id = v_org_id where user_id = u.id and org_id is null;
    update reports set org_id = v_org_id where user_id = u.id and org_id is null;
    update rule_sets set org_id = v_org_id where user_id = u.id and org_id is null and is_global = false;
  end loop;
end $$;

-- Backfill reports using project org_id when user_id is missing
update reports r
set org_id = p.org_id
from projects p
where r.project_id = p.id
  and r.org_id is null;

-- Ensure global rule sets have no org_id
update rule_sets set org_id = null where is_global = true;

-- Enforce org_id on projects/reports
alter table projects alter column org_id set not null;
alter table reports alter column org_id set not null;

-- Enforce org scope on rule sets
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'rule_sets_org_scope_check'
  ) then
    alter table rule_sets drop constraint rule_sets_org_scope_check;
  end if;
end $$;

alter table rule_sets
  add constraint rule_sets_org_scope_check
  check (
    (is_global = true and org_id is null) or
    (is_global = false and org_id is not null)
  );

-- Update report auto-populate function to include org_id
create or replace function auto_populate_report_user_id()
returns trigger as $$
begin
  if new.user_id is null then
    select user_id into new.user_id
    from projects
    where id = new.project_id;
  end if;

  if new.org_id is null then
    select org_id into new.org_id
    from projects
    where id = new.project_id;
  end if;

  return new;
end;
$$ language plpgsql;

-- RLS: projects
alter table projects enable row level security;

drop policy if exists "Users can view own projects" on projects;
drop policy if exists "Users can insert own projects" on projects;
drop policy if exists "Users can update own projects" on projects;
drop policy if exists "Users can delete own projects" on projects;

create policy "Org members can view projects"
  on projects for select
  using (
    exists (
      select 1 from org_members m
      where m.org_id = projects.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org admins can insert projects"
  on projects for insert
  with check (
    exists (
      select 1 from org_members m
      where m.org_id = projects.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can update projects"
  on projects for update
  using (
    exists (
      select 1 from org_members m
      where m.org_id = projects.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can delete projects"
  on projects for delete
  using (
    exists (
      select 1 from org_members m
      where m.org_id = projects.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

-- RLS: reports
alter table reports enable row level security;

drop policy if exists "Users can view own reports" on reports;
drop policy if exists "Users can insert own reports" on reports;
drop policy if exists "Users can update own reports" on reports;
drop policy if exists "Users can delete own reports" on reports;

create policy "Org members can view reports"
  on reports for select
  using (
    exists (
      select 1 from org_members m
      where m.org_id = reports.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert reports"
  on reports for insert
  with check (
    exists (
      select 1 from org_members m
      where m.org_id = reports.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can update reports"
  on reports for update
  using (
    exists (
      select 1 from org_members m
      where m.org_id = reports.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can delete reports"
  on reports for delete
  using (
    exists (
      select 1 from org_members m
      where m.org_id = reports.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- RLS: rule_sets
alter table rule_sets enable row level security;

drop policy if exists "Users can view global and own rule sets" on rule_sets;
drop policy if exists "Users can insert own rule sets" on rule_sets;
drop policy if exists "Users can update own rule sets" on rule_sets;
drop policy if exists "Users can delete own rule sets" on rule_sets;

create policy "Org members can view rule sets"
  on rule_sets for select
  using (
    is_global = true or exists (
      select 1 from org_members m
      where m.org_id = rule_sets.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org admins can insert rule sets"
  on rule_sets for insert
  with check (
    is_global = false and exists (
      select 1 from org_members m
      where m.org_id = rule_sets.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can update rule sets"
  on rule_sets for update
  using (
    is_global = false and exists (
      select 1 from org_members m
      where m.org_id = rule_sets.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can delete rule sets"
  on rule_sets for delete
  using (
    is_global = false and exists (
      select 1 from org_members m
      where m.org_id = rule_sets.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

-- RLS: rules
alter table rules enable row level security;

drop policy if exists "Org members can view rules" on rules;
drop policy if exists "Org admins can insert rules" on rules;
drop policy if exists "Org admins can update rules" on rules;
drop policy if exists "Org admins can delete rules" on rules;

create policy "Org members can view rules"
  on rules for select
  using (
    exists (
      select 1
      from rule_sets rs
      where rs.id = rules.ruleset_id
        and (
          rs.is_global = true or exists (
            select 1 from org_members m
            where m.org_id = rs.org_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        )
    )
  );

create policy "Org admins can insert rules"
  on rules for insert
  with check (
    exists (
      select 1
      from rule_sets rs
      join org_members m on m.org_id = rs.org_id
      where rs.id = rules.ruleset_id
        and rs.is_global = false
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can update rules"
  on rules for update
  using (
    exists (
      select 1
      from rule_sets rs
      join org_members m on m.org_id = rs.org_id
      where rs.id = rules.ruleset_id
        and rs.is_global = false
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

create policy "Org admins can delete rules"
  on rules for delete
  using (
    exists (
      select 1
      from rule_sets rs
      join org_members m on m.org_id = rs.org_id
      where rs.id = rules.ruleset_id
        and rs.is_global = false
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );
