
begin;

create table if not exists public.july_patient_finance_summary (
  patient_name text primary key,
  source_ids text,
  item_rows integer not null default 0,
  first_date date,
  last_date date,
  plan_value numeric not null default 0,
  paid_value numeric not null default 0,
  balance_value numeric not null default 0,
  payment_status text,
  payment_method text,
  items_summary text,
  source_file text not null default 'Libro1.xlsx',
  source_sha256 text,
  updated_at timestamptz not null default now()
);

truncate table public.july_patient_finance_summary;

insert into public.july_patient_finance_summary (
  patient_name, source_ids, item_rows, first_date, last_date,
  plan_value, paid_value, balance_value, payment_status, payment_method, items_summary,
  source_file, source_sha256, updated_at
)
select v.patient_name, v.source_ids, v.item_rows, v.first_date::date, v.last_date::date,
       v.plan_value, v.paid_value, v.balance_value, v.payment_status, v.payment_method, v.items_summary,
       'Libro1.xlsx', 'cecd3ff717a0846b579cd9389aa786f7c128d6f55f72722828da3d0e11d34dca', now()
from (values
('ADRIANA CAMPIÑO', '110', 4, null, null, 5680000.0, 0.0, 5680000.0, 'Pendiente', null, 'TESA/IPAMORELINA | VIAL DE NAD | PAQUETE DE SUEROTERAPIAS DE PRESICION | NUTRICION FUNGICA DE SOPORTE'),
('ALEJANDRA SALDARRIAGA', '108, 109', 5, null, null, 9800000.0, 6500000.0, 3300000.0, 'PARCIAL, Pagado, Pendiente', 'Efectivo', 'RETRATUTIDE + CARA | KLOW | TESA/IPAMORELINA | KISSPEPTIN 10 PARA INYECTAR | 4 GERINGAS PRELLENADAS DE NAD'),
('ANDRES DURANGO', '94', 1, null, null, 0.0, 0.0, 0.0, 'CORTESIA', null, '2 SUEROS INTRAVENOSOS'),
('ANDRES ESPOSO NUEVO', '87', 1, '2026-07-01', '2026-07-01', 580000.0, 580000.0, 0.0, 'Pagado', 'Trasferencia', 'CONSULTA MAS AUTOSANGUIS'),
('CAMILA BOTERO', '115', 1, null, null, 320000.0, 320000.0, 0.0, 'Pagado', 'Trasferencia', 'BIOPUNTUROA DE COLON'),
('CARLOS VELEZ', '116', 5, null, null, 10150000.0, 10150000.0, 0.0, 'Pagado', 'Trasferencia', 'RETRATUTIDE + CARGA | KLOW | DSIP | SS 31 | PLAN SUEROTERAPIA HEPATORRENALES'),
('CAROLINA HUERTAS', '85', 1, '2026-07-04', '2026-07-04', 580000.0, 580000.0, 0.0, 'Pagado', 'Trasferencia', 'TERAPIA VENOSA HORMONAL NAD + BIOPUNTURA'),
('CAROLINA JARAMILLO HUERTAS', '65', 1, null, null, 780000.0, 780000.0, 0.0, 'Pagado', 'BOLD', 'EXOXOMAS EN E PECHO Y PLAN ESTETICO 1 SUERO HORMONAL'),
('DANIELA GALLEGO', '54', 1, '2026-06-10', '2026-06-10', 1000000.0, 500000.0, 500000.0, 'Parcial', 'Trasferencia', '4 JERINGAS PRE LLENADAS TRIZEPATIDA'),
('DIANA CAUCASIA', '104', 1, null, null, 700000.0, 700000.0, 0.0, 'Pagado', null, '2 NEBULIZACIONES'),
('ESTEFANIA PANESSO', '64', 1, '2026-07-04', '2026-07-04', 430000.0, 430000.0, 0.0, 'Pagado', 'Trasferencia', '1 NEBULIZACION Y 1 DROTOX'),
('FERGIE , JAIBER KATY', '30', 1, '2026-06-10', '2026-06-10', 1050000.0, 1050000.0, 0.0, 'Pagado', 'Trasferencia', 'SUEROTERAPIAS'),
('GLORIA PATRICIA GARCIA NUEVA', '100', 1, null, null, 400000.0, 400000.0, 0.0, 'Pagado', 'Trasferencia', 'EXAMEN MEDICOS'),
('JENNY LUNA', '31', 2, '2026-04-15', '2026-04-15', 6500000.0, 4800000.0, 1700000.0, 'Pagado, Pendiente', 'Efectivo', 'PLAN TERAPIA DE REGENERACION INCLUYE SECCIONES RODILLA Y CICATRIZ | SELANK INTRAVENOSO'),
('JHOA', '105', 1, null, null, 3000000.0, 1500000.0, 1500000.0, 'PARCIAL', null, 'SUERO TERAPIA PLAN'),
('JULIA MUÑOZ', '83', 1, '2026-07-04', '2026-07-04', 480000.0, 480000.0, 0.0, 'Pagado', 'Trasferencia', 'SECCION NAD'),
('JULIAN MESA', '97', 2, null, null, 760000.0, 760000.0, 0.0, 'Pagado', 'Trasferencia', 'SUEROTERAPIA GUYABO | NAD INTRAVENOSO'),
('LAURA CASAS BOGOTÁ', '98', 3, null, null, 549000.0, 549000.0, 0.0, 'Pagado', 'Trasferencia', 'DOSIS DE TRIZEPATIDA | NAD SUB CUTANEO | AUTOSANGUIS SISTEMA NERVIOSO'),
('LIPIO HUERTAS', '82', 1, '2026-07-04', '2026-07-04', 580000.0, 580000.0, 0.0, 'Pagado', 'Trasferencia', 'TERAPIA INTRAVENOSA NAD + BIOPUNTURA DE CABEZA'),
('LUIS FERNANDO LOPEERA / USA', '106', 5, null, null, 10000000.0, 2000000.0, 8000000.0, 'PARCIAL, Pagado, Pendiente', null, 'GLUTATION | RETRATUTIDE | TESA/IPAMORELINA | KLOW | SELANK'),
('LUIS MANOTAS', '81', 1, '2026-07-01', '2026-07-01', 580000.0, 580000.0, 0.0, 'Pagado', 'Trasferencia', 'BIOPUNTURA COLON MÁS TERAPIA INTRAVENOSA NAD'),
('MAMA JENNY LUNA', '31', 1, '2026-07-21', '2026-07-21', 2000000.0, 2000000.0, 0.0, 'Pagado', 'Trasferencia', '8 JERINGAS PRE LLENADAS INMULGICAS'),
('MANUELA LONDOÑO', '96', 4, null, null, 9050000.0, 6500000.0, 2550000.0, 'PARCIAL, Pagado', null, 'RETRATUTIDE + CARGA | KLOW | NAD | SS-31'),
('MARIA LUISA BULAS', '95', 3, null, null, 6400000.0, 6400000.0, 0.0, 'CORTESIA, Pagado', 'Trasferencia', 'RETRATUTIDE +CARGA | TESA/IPAMORELINA | GLUTATION'),
('MARIANA SIERRA', '75', 1, '2026-07-01', '2026-07-01', 1520000.0, 380000.0, 1140000.0, 'Pendiente', null, 'SECCION DE GRASA LOCALIZADA'),
('MIGUEL ANGEL GONZALEZ', '103', 3, null, null, 6900000.0, 6900000.0, 0.0, 'Pagado', 'BOLD', 'RETRATUTIDE + CARGA | KLOW | TESA/IPAMORELINA'),
('SAMUEL SIERRA', '107', 1, null, null, 1500000.0, 0.0, 1500000.0, 'Pendiente', null, 'TESA/IPAMORELINA'),
('SEBASTIAN MEJIA', '111', 6, null, null, 11400000.0, 11400000.0, 0.0, 'Pagado', 'Efectivo', 'SS-31 | RETRATUTIDE | TESAMORELINA | SUEROTERAPIA | BIOPUNTURA INTEGRATIVA | EPITALON'),
('STIVEN /MIKY LA SENSA', '114', 1, null, null, 3500000.0, 0.0, 3500000.0, 'Pendiente', null, 'TRIZEPATIDA 60 MG'),
('YENNY ORJUELA PACIENTE NUEVA BOGOTA', '99', 1, null, null, 480000.0, 480000.0, 0.0, 'Pagado', 'Trasferencia', 'CONSULTA MAS NAD')
) as v(patient_name, source_ids, item_rows, first_date, last_date, plan_value, paid_value, balance_value, payment_status, payment_method, items_summary);

grant select on public.july_patient_finance_summary to authenticated;

comment on table public.july_patient_finance_summary is 'Resumen operativo de pacientes de julio desde Libro1.xlsx organizado por Laura/Eva. No sustituye sales/payments; alimenta bloque visual Caja -> Pacientes julio.';

commit;
