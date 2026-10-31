-- REVIEW CANDIDATE. Locally validated. Depends on 001; writes remain closed until 003.
begin;
create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete on public.profiles for delete to authenticated using ((select auth.uid()) = id);
create policy anniversaries_select on public.anniversaries for select to authenticated using ((select auth.uid()) = user_id);
create policy anniversaries_insert on public.anniversaries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy anniversaries_update on public.anniversaries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy anniversaries_delete on public.anniversaries for delete to authenticated using ((select auth.uid()) = user_id);
create policy documents_select on public.tool_documents for select to authenticated using ((select auth.uid()) = user_id and deleted_at is null);
create policy documents_insert on public.tool_documents for insert to authenticated with check ((select auth.uid()) = user_id);
create policy documents_update on public.tool_documents for update to authenticated using ((select auth.uid()) = user_id and deleted_at is null) with check ((select auth.uid()) = user_id);
create policy documents_delete on public.tool_documents for delete to authenticated using ((select auth.uid()) = user_id);
commit;
