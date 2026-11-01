-- E-Mail-Änderung im Profil: Supabase ändert nach der Bestätigung nur
-- auth.users.email. public.users.email (Mitgliederlisten, Einladungen) würde
-- sonst auf der alten Adresse stehen bleiben.

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_user_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email();
