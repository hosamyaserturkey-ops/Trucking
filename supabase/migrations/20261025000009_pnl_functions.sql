-- Aggregated P&L for the app. The API caps responses at 1000 rows, so totals
-- are summed in the database instead of in the browser. Both functions run
-- with the caller's rights (RLS applies through truck_pnl_facts_v).

-- Per truck and kind over [p_from, p_to). Optional truck filter.
create function public.truck_pnl_summary(p_from date, p_to date, p_truck_id uuid default null)
returns table (truck_id uuid, kind text, amount_base_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.truck_id, f.kind, sum(f.amount_base_minor)::bigint
  from public.truck_pnl_facts_v f
  where f.fact_date >= p_from and f.fact_date < p_to
    and (p_truck_id is null or f.truck_id = p_truck_id)
  group by f.truck_id, f.kind
$$;

-- One truck, by month, kind and category over [p_from, p_to).
create function public.truck_pnl_monthly(p_truck_id uuid, p_from date, p_to date)
returns table (month date, kind text, category_name text, amount_base_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', f.fact_date)::date, f.kind, f.category_name, sum(f.amount_base_minor)::bigint
  from public.truck_pnl_facts_v f
  where f.truck_id = p_truck_id and f.fact_date >= p_from and f.fact_date < p_to
  group by 1, 2, 3
  order by 1, 2, 3
$$;

revoke execute on function public.truck_pnl_summary(date, date, uuid) from public, anon;
revoke execute on function public.truck_pnl_monthly(uuid, date, date) from public, anon;
grant execute on function public.truck_pnl_summary(date, date, uuid) to authenticated;
grant execute on function public.truck_pnl_monthly(uuid, date, date) to authenticated;
