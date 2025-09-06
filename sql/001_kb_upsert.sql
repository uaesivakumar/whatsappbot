create extension if not exists pgcrypto;

create or replace function kb_norm(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(t, '\s+', ' ', 'g'))
$$;

create or replace function kb_upsert(p_content text, p_meta jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_norm text := kb_norm(p_content);
  v_hash text := md5(v_norm);
  v_id   uuid;
begin
  insert into kb_chunks (content, meta, content_hash)
  values (v_norm, p_meta, v_hash)
  on conflict (content_hash) do update
     set updated_at = now(),
         meta = coalesce(EXCLUDED.meta, kb_chunks.meta)
  returning id into v_id;
  return v_id;
end;
$$;

create unique index if not exists kb_chunks_content_hash_key on kb_chunks(content_hash);
