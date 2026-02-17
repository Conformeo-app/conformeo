-- data-governance hotfix
-- Restrict org deletion RPC to service_role only.

revoke all on function public.super_admin_delete_org(uuid, uuid, text) from public;
revoke all on function public.super_admin_delete_org(uuid, uuid, text) from anon;
revoke all on function public.super_admin_delete_org(uuid, uuid, text) from authenticated;

grant execute on function public.super_admin_delete_org(uuid, uuid, text) to service_role;
