-- =============================================================================
-- JAVORA DESK — 0500 Member sign-in tracking and invitation rate limit
-- =============================================================================

-- Supabase creates the auth user as soon as an invitation email is sent, so a
-- profile exists before the person ever signs in. Track the first/last sign-in
-- so the team page can show "invited — not signed in yet".
alter table public.profiles add column if not exists last_sign_in_at timestamptz;

create or replace function private.sync_last_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.profiles set last_sign_in_at = new.last_sign_in_at where id = new.id;
  end if;
  return new;
end;
$$;

do $$
begin
  -- auth.users.last_sign_in_at exists in Supabase; guard for other environments.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at'
  ) then
    execute 'drop trigger if exists on_auth_user_signed_in on auth.users';
    execute 'create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
             for each row execute function private.sync_last_sign_in()';
  end if;
end
$$;

revoke all on function private.sync_last_sign_in() from public, anon, authenticated;

-- Invitation rate limit: at most 30 invitations per owner per hour.
create or replace function public.create_invitation(p_email text, p_role public.app_role, p_full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  perform private.require_role(array['owner']::public.app_role[]);
  if (select count(*) from public.invitations where invited_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many invitations in the last hour. Please wait and try again.' using errcode = '55000';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where email = v_email) then
    raise exception 'This person is already a member of the workspace.' using errcode = '22023';
  end if;
  update public.invitations set status = 'revoked', revoked_at = now() where email = v_email and status = 'pending';
  insert into public.invitations (email, role, full_name, invited_by)
  values (v_email, p_role, nullif(btrim(coalesce(p_full_name, '')), ''), auth.uid())
  returning id into v_id;
  perform private.log(null, 'member.invited', jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end;
$$;

revoke all on function public.create_invitation(text, public.app_role, text) from public, anon;
grant execute on function public.create_invitation(text, public.app_role, text) to authenticated;
