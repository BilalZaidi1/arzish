-- Arzish 002: Vault secrets and the helpers that let pg_cron call edge functions.
-- The secret values are created once per project and never stored in this repository:
--   cron_secret     random hex, generated in the database (shared with the jobs function)
--   project_url     https://<project-ref>.supabase.co
--   resend_api_key  a Resend sending key
--
-- select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret');
-- select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- select vault.create_secret('<resend key>', 'resend_api_key');

create or replace function public.get_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;
revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- 003 replaces this with a 150-second timeout.
create or replace function public.invoke_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := body,
    timeout_milliseconds := 120000
  );
$$;
revoke execute on function public.invoke_function(text, jsonb) from public, anon, authenticated;
