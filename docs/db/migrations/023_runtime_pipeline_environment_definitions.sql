alter table org_runtime_settings
  alter column pipeline_environments
  set default
    '[{"key":"development","label":"Development","order":1},{"key":"preview","label":"Preview","order":2},{"key":"production","label":"Production","order":3}]'::jsonb;

update org_runtime_settings s
set pipeline_environments = converted.pipeline_environments
from (
  with flattened as (
    select
      ors.org_id,
      e.ord,
      regexp_replace(
        regexp_replace(lower(trim(e.item #>> '{}')), '[^a-z0-9-]+', '-', 'g'),
        '(^-+|-+$)',
        '',
        'g'
      ) as key
    from org_runtime_settings ors
    cross join lateral jsonb_array_elements(ors.pipeline_environments) with ordinality as e(item, ord)
    where jsonb_typeof(ors.pipeline_environments) = 'array'
      and jsonb_array_length(ors.pipeline_environments) > 0
      and jsonb_typeof(ors.pipeline_environments->0) = 'string'
  ),
  deduped as (
    select
      org_id,
      key,
      min(ord) as first_ord
    from flattened
    where key ~ '^[a-z][a-z0-9-]{0,31}$'
    group by org_id, key
  ),
  ranked as (
    select
      org_id,
      key,
      row_number() over (partition by org_id order by first_ord asc, key asc) as env_order
    from deduped
  )
  select
    org_id,
    jsonb_agg(
      jsonb_build_object(
        'key', key,
        'label', initcap(replace(key, '-', ' ')),
        'order', env_order
      )
      order by env_order
    ) as pipeline_environments
  from ranked
  group by org_id
) converted
where s.org_id = converted.org_id;

update org_runtime_settings
set pipeline_environments =
  '[{"key":"development","label":"Development","order":1},{"key":"preview","label":"Preview","order":2},{"key":"production","label":"Production","order":3}]'::jsonb
where jsonb_typeof(pipeline_environments) <> 'array'
   or jsonb_array_length(pipeline_environments) = 0;

alter table org_runtime_settings
  drop constraint if exists org_runtime_settings_pipeline_environments_check;

alter table org_runtime_settings
  add constraint org_runtime_settings_pipeline_environments_check
  check (
    jsonb_typeof(pipeline_environments) = 'array'
    and jsonb_array_length(pipeline_environments) > 0
    and jsonb_array_length(
      jsonb_path_query_array(
        pipeline_environments,
        '$[*] ? (@.type() == "object" && @.key.type() == "string" && @.label.type() == "string" && @.order.type() == "number")'
      )
    ) = jsonb_array_length(pipeline_environments)
  );
