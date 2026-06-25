-- ============================================================
-- HEALEN OS · 13 · Storage de soportes
-- Bucket privado 'soportes' para adjuntar foto/PDF/archivo a los movimientos de
-- caja. Solo staff sube/lee/borra; la descarga se hace con signed URL desde el
-- front. DEBE correr DESPUÉS de 01–12.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('soportes', 'soportes', false, 15728640)  -- 15 MB
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- RLS en storage.objects: solo staff (require profile activo) sobre el bucket soportes.
drop policy if exists "soportes_staff_read" on storage.objects;
create policy "soportes_staff_read" on storage.objects
  for select to authenticated using (bucket_id = 'soportes' and is_staff());

drop policy if exists "soportes_staff_insert" on storage.objects;
create policy "soportes_staff_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'soportes' and is_staff());

drop policy if exists "soportes_staff_delete" on storage.objects;
create policy "soportes_staff_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'soportes' and is_staff());
