create or replace function lookup_promo_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_used int;
begin
  select p.id, p.code, p.max_uses, c.discount_percent, c.starts_at, c.ends_at
    into r
    from promo_codes p join campaigns c on c.id = p.campaign_id
   where upper(p.code) = upper(trim(p_code))
   order by c.created_at desc limit 1;
  if not found then return null; end if;

  select (select count(*) from orders o
           where o.status in ('paid', 'completed')
             and (o.promo_code_id = r.id or upper(o.promo_code) = r.code))
       + (select count(*) from ticket_holds h
           where h.promo_code_id = r.id and h.status = 'active' and h.expires_at > now())
    into v_used;

  return jsonb_build_object('id', r.id, 'code', r.code, 'discount_percent', r.discount_percent,
                            'max_uses', r.max_uses, 'used', v_used,
                            'active', now() between r.starts_at and r.ends_at);
end $$;
grant execute on function lookup_promo_code(text) to anon, authenticated;