-- ============================================================
-- HEALEN OS · 06 · Semilla (datos demo que ejercitan el motor)
-- Idempotente: limpia y vuelve a sembrar.
-- ============================================================

-- Limpieza (respeta FKs vía cascade)
truncate table
  inventory_movements, treatment_dispensations, sale_items, payments,
  finance_entries, inventory_lots, treatment_items, treatments, sales,
  clients, products, suppliers
restart identity cascade;
alter sequence seq_sale restart with 1;
alter sequence seq_client restart with 5;  -- HLN-001..004 sembrados a mano

do $$
declare
  sup_bio uuid; sup_pep uuid;
  p_nad uuid; p_bpc uuid; p_epi uuid; p_sema uuid; p_thy uuid; p_suero uuid;
  c_val uuid; c_mar uuid; c_cam uuid; c_dan uuid;
  t_val uuid; t_mar uuid; t_cam uuid; t_dan uuid;
  ti_val_nad uuid; ti_val_bpc uuid; ti_dan_epi uuid;
  s_id uuid;
begin
  -- Proveedores
  insert into suppliers(name, contact_name, phone) values ('Bioregen Labs','Laura Méndez','+57 310 1112233') returning id into sup_bio;
  insert into suppliers(name, contact_name, phone) values ('Peptide Source','Andrés Gómez','+57 311 4445566') returning id into sup_pep;

  -- Productos (catálogo)
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('PEP-NAD','NAD+','peptido','viales',12,420000,sup_bio) returning id into p_nad;
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('PEP-BPC','BPC-157','peptido','viales',8,360000,sup_pep) returning id into p_bpc;
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('PEP-EPI','Epitalon','peptido','viales',6,520000,sup_pep) returning id into p_epi;
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('PEP-SEMA','Semaglutida','peptido','viales',6,250000,sup_bio) returning id into p_sema;
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('PEP-THY','Thymosin Alpha','peptido','viales',6,300000,sup_pep) returning id into p_thy;
  insert into products(sku,name,category,unit,min_stock,sale_price,reorder_supplier_id) values
    ('SUE-REV','Suero revitalizante','suero','kits',10,150000,sup_bio) returning id into p_suero;

  -- Entradas de stock (lotes con vencimiento). Thymosin se queda en 0 a propósito.
  perform receive_stock(p_nad,  'NAD-2606',  9,  180000, '2026-08-18', sup_bio);
  perform receive_stock(p_bpc,  'BPC-1906',  4,  145000, '2026-07-14', sup_pep);
  perform receive_stock(p_epi,  'EPI-2206', 14,  210000, '2026-10-09', sup_pep);
  perform receive_stock(p_sema, 'SEMA-2106',10,   95000, '2026-12-01', sup_bio);
  perform receive_stock(p_suero,'SRV-2306', 26,   92000, '2026-11-02', sup_bio);

  -- Clientes
  insert into clients(code,full_name,phone,email) values ('HLN-001','Valentina Restrepo','+57 300 1000001','valentina@example.com') returning id into c_val;
  insert into clients(code,full_name,phone,email) values ('HLN-002','Mariana Gil','+57 300 1000002','mariana@example.com') returning id into c_mar;
  insert into clients(code,full_name,phone,email) values ('HLN-003','Camilo Arango','+57 300 1000003','camilo@example.com') returning id into c_cam;
  insert into clients(code,full_name,phone,email) values ('HLN-004','Daniela Ocampo','+57 300 1000004','daniela@example.com') returning id into c_dan;

  -- Tratamientos
  insert into treatments(client_id,name,start_date,end_date,status,sale_price,weekly_serum,serum_day)
    values (c_val,'Regeneracion celular','2026-06-10','2026-07-22','activo',7200000,true,'Miercoles') returning id into t_val;
  insert into treatments(client_id,name,start_date,end_date,status,sale_price,weekly_serum,serum_day)
    values (c_mar,'Anti-inflamatorio','2026-06-03','2026-07-01','por_finalizar',3800000,false,null) returning id into t_mar;
  insert into treatments(client_id,name,start_date,end_date,status,sale_price,weekly_serum,serum_day)
    values (c_cam,'Energia y metabolismo','2026-06-15','2026-08-03','activo',1900000,true,'Viernes') returning id into t_cam;
  insert into treatments(client_id,name,start_date,end_date,status,sale_price,weekly_serum,serum_day)
    values (c_dan,'Longevidad premium','2026-06-18','2026-08-12','activo',9400000,true,'Lunes') returning id into t_dan;

  -- Ítems de tratamiento (ends_on define los días restantes / semáforo)
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_val,p_nad,'NAD+','250 mg semanal','semanal',6,'2026-07-12','activo') returning id into ti_val_nad;
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_val,p_bpc,'BPC-157','500 mcg diario','diario',30,'2026-06-28','por_finalizar') returning id into ti_val_bpc;
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_mar,p_thy,'Thymosin Alpha','1 vial semanal','semanal',4,'2026-06-30','por_finalizar');
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_cam,p_sema,'Semaglutida','0.25 mg semanal','semanal',8,'2026-08-04','activo');
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_dan,p_epi,'Epitalon','10 mg ciclo','ciclo',6,'2026-07-05','activo') returning id into ti_dan_epi;
  insert into treatment_items(treatment_id,product_id,name,dose,schedule,planned_quantity,ends_on,status)
    values (t_dan,p_suero,'Suero revitalizante','1 kit semanal','semanal',8,'2026-07-03','activo');

  -- Ventas de los planes (servicio): total = sale_price. COGS llega por dispensación.
  -- Valentina y Daniela pagan completo; Mariana y Camilo quedan con saldo (cartera).
  insert into sales(code,client_id,treatment_id,sale_date,subtotal,total,cogs_total,status)
    values ('VTA-'||lpad(nextval('seq_sale')::text,4,'0'),c_val,t_val,'2026-06-10',7200000,7200000,0,'pendiente') returning id into s_id;
  insert into payments(client_id,sale_id,amount,method,paid_at) values (c_val,s_id,7200000,'transferencia','2026-06-10');

  insert into sales(code,client_id,treatment_id,sale_date,subtotal,total,cogs_total,status)
    values ('VTA-'||lpad(nextval('seq_sale')::text,4,'0'),c_dan,t_dan,'2026-06-18',9400000,9400000,0,'pendiente') returning id into s_id;
  insert into payments(client_id,sale_id,amount,method,paid_at) values (c_dan,s_id,9400000,'transferencia','2026-06-18');

  insert into sales(code,client_id,treatment_id,sale_date,subtotal,total,cogs_total,due_date,status)
    values ('VTA-'||lpad(nextval('seq_sale')::text,4,'0'),c_mar,t_mar,'2026-06-03',3800000,3800000,0,'2026-06-16','pendiente') returning id into s_id;
  insert into payments(client_id,sale_id,amount,method,paid_at) values (c_mar,s_id,2700000,'transferencia','2026-06-03');

  insert into sales(code,client_id,treatment_id,sale_date,subtotal,total,cogs_total,due_date,status)
    values ('VTA-'||lpad(nextval('seq_sale')::text,4,'0'),c_cam,t_cam,'2026-06-15',1900000,1900000,0,'2026-06-28','pendiente') returning id into s_id;
  insert into payments(client_id,sale_id,amount,method,paid_at) values (c_cam,s_id,900000,'transferencia','2026-06-15');

  -- Venta retail de producto suelto (ejercita el motor FEFO + margen automático)
  perform register_sale(
    c_dan,
    jsonb_build_array(jsonb_build_object('product_id', p_suero, 'quantity', 2)),
    '2026-06-21', null, 300000, 'efectivo', null, 'Kits extra de suero'
  );

  -- Dispensaciones (descuentan inventario por dosis)
  perform dispense_treatment(ti_val_nad, 1, 'Aplicación semanal');
  perform dispense_treatment(ti_val_bpc, 1, 'Dosis diaria');
  perform dispense_treatment(ti_dan_epi, 1, 'Inicio de ciclo');

  -- Caja: compra a proveedor (gasto empresa) y retiro de socio (no afecta utilidad)
  insert into finance_entries(kind,scope,category,concept,amount,entry_date,cost_center,payment_method,person,supplier_id,reference_type)
    values ('gasto','empresa','Inventario','Compra de insumos',820000,'2026-06-21','Inventario','tarjeta_credito','Bioregen Labs',sup_bio,'purchase');
  insert into finance_entries(kind,scope,category,concept,amount,entry_date,cost_center,payment_method,person)
    values ('gasto','retiro_socio','Personal','Retiro personal del socio',450000,'2026-06-22','Personal','efectivo','Socio');
end $$;
