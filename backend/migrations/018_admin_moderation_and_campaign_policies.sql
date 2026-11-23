create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'platform_admin')
$$;

grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists "owners read own campaigns" on campaigns;
create policy "owners read own campaigns" on campaigns
  for select to authenticated
  using (organizer_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admin moderates events" on events;
create policy "platform admin moderates events" on events
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "platform admin moderates profiles" on profiles;
create policy "platform admin moderates profiles" on profiles
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
