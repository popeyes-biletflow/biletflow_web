create or replace function campaign_stats(p_event_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_campaigns jsonb;
  v_totals    jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
    into v_campaigns
    from (
      select c.id as campaign_id, c.event_id, c.name, p.code, c.discount_percent,
             p.max_uses, c.created_at,
             (select count(*) from campaign_scans s where s.campaign_id = c.id) as qr_scans,
             count(o.id)                                       as orders,
             coalesce(sum(o.quantity), 0)                      as tickets_sold,
             coalesce(sum(o.subtotal_kzt), 0)                  as gross_sales_kzt,
             coalesce(sum(o.discount_kzt), 0)                  as discount_total_kzt,
             coalesce(sum(o.subtotal_kzt - o.discount_kzt), 0) as net_revenue_kzt
        from campaigns c
        join events e      on e.id = c.event_id
        join promo_codes p on p.campaign_id = c.id
        left join orders o on o.promo_code_id = p.id and o.status = 'paid'
       where e.organizer_id = v_user
         and (p_event_id is null or c.event_id = p_event_id)
       group by c.id, p.id
    ) x;

  select to_jsonb(t) into v_totals
    from (
      select count(o.id)                                         as orders,
             coalesce(sum(o.quantity), 0)                        as tickets_sold,
             coalesce(sum(o.subtotal_kzt), 0)                    as gross_event_revenue_kzt,
             coalesce(sum(o.discount_kzt), 0)                    as discount_total_kzt,
             coalesce(sum(o.fee_kzt), 0)                         as fees_kzt,
             count(o.id) filter (where o.promo_code_id is not null) as promo_orders
        from orders o
        join events e on e.id = o.event_id
       where o.status = 'paid'
         and e.organizer_id = v_user
         and (p_event_id is null or o.event_id = p_event_id)
    ) t;

  return jsonb_build_object('campaigns', v_campaigns, 'totals', v_totals);
end $$;

grant execute on function campaign_stats(uuid) to authenticated;