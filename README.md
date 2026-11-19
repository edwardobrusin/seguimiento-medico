# Sistema de Seguimiento Clinico, Gobernanza Farmacologica y Planificacion Quincenal

Plataforma web y terminal bilateral en Telegram disenada como **fuente operativa unica** para el control medico integral del paciente: adherencia farmacologica por bloques horarios, inventario con soporte para datos diferibles, gobernanza CRUD completa sobre toda entidad, planificador financiero quincenal con suavizado de picos, expediente clinico, directorio medico, auditoria de cambios y alertas transaccionales en cascada.

---

## Tabla de Contenidos

1. [Vision General y Principios de Diseno](#1-vision-general-y-principios-de-diseno)
2. [Arquitectura y Stack Tecnologico](#2-arquitectura-y-stack-tecnologico)
3. [Mapa Exacto del Repositorio](#3-mapa-exacto-del-repositorio)
4. [Modelo de Datos y Base de Datos PostgreSQL](#4-modelo-de-datos-y-base-de-datos-postgresql)
5. [Gobernanza de la Informacion y Normas de Captura](#5-gobernanza-de-la-informacion-y-normas-de-captura)
6. [Motor de Agrupacion Horaria (DoseClusteringService)](#6-motor-de-agrupacion-horaria-doseclusteringservice)
7. [Sistema Financiero y Optimizador Quincenal (FinancialPlannerService)](#7-sistema-financiero-y-optimizador-quincenal-financialplannerservice)
8. [Expediente Clinico, Adherencia 30 Dias y Directorio Medico](#8-expediente-clinico-adherencia-30-dias-y-directorio-medico)
9. [Terminal Bilateral de Telegram Bot](#9-terminal-bilateral-de-telegram-bot)
10. [Referencia Completa de API HTTP](#10-referencia-completa-de-api-http)
11. [Base Clinica Inicial Cargada (Esquema Real del Paciente)](#11-base-clinica-inicial-cargada-esquema-real-del-paciente)
12. [Guia de Operacion, Despliegue y Solucion de Problemas](#12-guia-de-operacion-despliegue-y-solucion-de-problemas)

---

## 1. Vision General y Principios de Diseno

El sistema esta construido alrededor de cuatro principios operativos:

1. **Cero fallos en adherencia y trazabilidad**: Las tomas se agrupan en bloques horarios compatibles (`intake_clusters`) y se confirman desde Web o Telegram con descuento atomico en PostgreSQL y reembolso automatico si una toma se revierte o elimina.
2. **Gobernanza total sobre la informacion**: Cada modulo permite crear, editar, archivar/restaurar (cuando aplica), ajustar, reabrir, cancelar y eliminar (con confirmacion explicita en dos pasos) dejando rastro en `governance_audit_logs`.
3. **Captura realista y progresiva (datos obligatorios vs diferibles)**: Un medicamento nuevo (por ejemplo `Rolet Sup 80/12.5`) puede registrarse de inmediato con su posologia clinica obligatoria dejando `current_stock`, `units_per_package` y `package_price` en `NULL` (`[PENDIENTE]`) sin corromper metricas ni disparar falsas alertas de agotamiento.
4. **Suavizado financiero quincenal**: Las compras de medicamentos y los costos de citas/estudios se proyectan sobre fechas reales de pago quincenal (`15` y `30 / ultimo dia de mes` por defecto) y se redistribuyen con un algoritmo Min-Max para evitar picos mensuales.
5. **Estetica clinica sobria con cero emojis**: Tipografia `Atkinson Hyperlegible` + `JetBrains Mono` (`tabular-nums`), paleta neutra (`#F8FAFC`, `#FFFFFF`, `#0F172A`, `#0E7490`) y etiquetas ASCII estructuradas (`[PENDIENTE]`, `[CRITICO]`, `[CONFIRMADO]`). La suite `npm run verify` falla si detecta cualquier emoji en `src/`.

---

## 2. Arquitectura y Stack Tecnologico

| Capa | Tecnologia / Paquete | Proposito |
| :--- | :--- | :--- |
| Framework Web | Next.js `15.5.x` (`package.json`: `^15.3.3`) | App Router, Server Components, Route Handlers `force-dynamic` |
| Interfaz UI | React `^19.1.0`, Tailwind CSS `^4.1.6`, `lucide-react ^0.511.0` | Consola de 7 pestanas, targets tactiles >= 44px, `prefers-reduced-motion` |
| Lenguaje y Validacion | TypeScript `^5.8.3` (`strict: true`), Zod `^3.24.4` | Contratos tipados y validacion estricta en API |
| Base de Datos Produccion | Neon Serverless PostgreSQL (`@neondatabase/serverless ^1.0.0`) | Pool serverless en region `iad1` (`Pool`, `max: 10`) |
| Base de Datos Fallback Local | PGlite (`@electric-sql/pglite ^0.3.14`) | PostgreSQL embebido en `.pgdata/clinical-care-db` si no hay `DATABASE_URL` |
| Mensajeria Bilateral | Telegram Bot API (HTTPS nativo con `fetch`) | Despacho de cola y webhook interactivo bidireccional |
| Hosting y Cron | Vercel Plan Hobby (`regions: ["iad1"]`) + Cron externo 60s | Sin bloque `crons` en `vercel.json`; disparado via `CRON_SECRET` |

### Topologia de Flujo

```text
+-----------------------------------------------------------------------+
|                       Consola Web (Next.js App Router)                |
|  7 Vistas: Command Center | Inventario | Finanzas | Agenda |          |
|            Seguimiento | Expediente | Telegram Bot                    |
+-------------------+-----------------------------------+---------------+
                    |                                   |
        GET /api/command-center                 POST /api/* (Zod + Tx)
        (Single-trip CTE SQL)                           |
                    |                                   v
                    +---------------------->+---------------------------+
                                            |  PostgreSQL (Neon / PGlite)|
                                            |  14 Tablas + 2 PL/pgSQL    |
                                            |  Triggers + Audit Logs     |
                                            +-------------+-------------+
                                                          ^
     +---------------------------+                        |
     | Cron Externo cada 60s     |                        |
     | (cron-job.org / CF Worker)|---> GET/POST /api/cron/dispatch
     +---------------------------+     (FOR UPDATE SKIP LOCKED)
                                                          |
                                                          v
     +---------------------------+              +-----------------------+
     | Telegram Bot API          |<------------>| /api/telegram/webhook |
     | (Paciente y Cuidadores)   |              | (Secret Token Header) |
     +---------------------------+              +-----------------------+
```

---

## 3. Mapa Exacto del Repositorio

```text
.
|-- .env.example                                  Plantilla de variables de entorno
|-- .env.local                                    Credenciales locales (no versionado)
|-- next.config.ts                                serverExternalPackages: pglite y neon
|-- package.json                                  Scripts y dependencias
|-- tsconfig.json                                 Configuracion TypeScript estricta (alias @/*)
|-- vercel.json                                   Region iad1, cabeceras no-store/seguridad, sin crons
|-- README.md                                     Fuente de verdad absoluta del sistema
|-- scripts/
|   |-- init-neon.ts                              Inicializa esquema idempotente y prueba Bot
|   |-- reset-and-seed.ts                         Limpia DB, aplica DDL/triggers y carga base real
|   `-- verify-system.ts                          Suite integral de 12 pruebas + auditoria 0 emojis
`-- src/
    |-- app/
    |   |-- globals.css                           Variables CSS clinicas, .clinical-btn, .clinical-card
    |   |-- layout.tsx                            Carga Atkinson Hyperlegible + JetBrains Mono
    |   |-- loading.tsx                           Skeleton Zero-CLS de 7 pestanas y 5 KPIs
    |   |-- manifest.ts                           Manifiesto Web App ("Cuidado Clinico")
    |   |-- page.tsx                              Server Component principal (force-dynamic, iad1)
    |   `-- api/
    |       |-- command-center/route.ts           GET snapshot unificado (?date=YYYY-MM-DD)
    |       |-- cron/dispatch/route.ts            GET/POST despachador ligero con CRON_SECRET
    |       |-- dossier/route.ts                  POST perfil clinico y directorio de proveedores
    |       |-- events/route.ts                   POST CRUD eventos clinicos + completar/reabrir
    |       |-- finances/route.ts                 POST configuracion quincenal, gastos y compras
    |       |-- intakes/confirm/route.ts          POST confirmacion bloque/toma, borrar log, restock
    |       |-- medications/route.ts              POST CRUD medicamentos, ajustes, archivo y clusters
    |       |-- telegram/
    |       |   |-- dispatch/route.ts             POST despacho manual/intervalo desde consola web
    |       |   |-- recipients/route.ts           POST CRUD destinatarios + gobernanza de cola + setWebhook
    |       |   `-- webhook/route.ts              POST receptor de Telegram Bot API (+ ?simulate=1)
    |       `-- topics/route.ts                   POST CRUD temas, anotaciones y conversion a cita
    |-- components/clinical/
    |   |-- CascadeTimeline.tsx                   Linea de etapas -7d / -3d / -1d / 0d
    |   |-- ClinicalEventsView.tsx                Agenda clinica con costos, edicion, cierre y borrado
    |   |-- ClinicalShell.tsx                     Contenedor principal con navegacion de 7 pestanas
    |   |-- CommandCenterView.tsx                 Tablero operativo diario con selector de fecha y tomas
    |   |-- FinancialPlannerView.tsx              Optimizador quincenal, alertas de reserva y gastos
    |   |-- FollowUpTopicsView.tsx                Casos abiertos, bitacora CRUD y conversion a evento
    |   |-- MedicationsInventoryView.tsx          Inventario, captura diferible, stock, archivo y clusters
    |   |-- PatientDossierView.tsx                Ficha clinica, adherencia 30d, proveedores y auditoria
    |   |-- StatusBadge.tsx                       Etiqueta semantica clinica sin emojis
    |   `-- TelegramConfigView.tsx                Destinatarios CRUD, webhook Vercel y cola de mensajes
    `-- lib/
        |-- clinical-labels.ts                    Diccionarios de etiquetas ASCII y textos en espanol
        |-- utils.ts                              Formato de fecha, hora, moneda MXN y cn()
        |-- vercel-cache.ts                       NO_STORE_HEADERS y safeRevalidateHome()
        |-- db/
        |   |-- client.ts                         Cliente dual Neon Pool / PGlite + withTransaction()
        |   |-- schema.sql                        DDL idempotente de 9 ENUMs, 14 tablas y 8 indices
        |   |-- triggers.sql                      Triggers y funciones PL/pgSQL de stock y cascadas
        |   `-- seed.ts                           Semilla real del paciente (7 meds, 6 eventos, 4 temas)
        |-- services/
        |   |-- clinical-events.service.ts        Logica transaccional y cascadas de eventos clinicos
        |   |-- command-center.service.ts         Consulta CTE de un solo viaje + plan financiero
        |   |-- dose-clustering.service.ts        Motor de agrupacion horaria, stock y clusters CRUD
        |   |-- financial-planner.service.ts      Generador quincenal, suavizado Min-Max y gastos
        |   |-- follow-up-topics.service.ts       Logica de temas, anotaciones y conversion a evento
        |   |-- governance-audit.service.ts       Registro centralizado en governance_audit_logs
        |   |-- patient-dossier.service.ts        Perfil clinico y directorio de proveedores CRUD
        |   `-- telegram-notification.service.ts  Despachador, teclado paciente, sync Web <-> TG y cola
        `-- types/
            `-- clinical.ts                       Interfaces y tipos compartidos cliente/servidor
```

---

## 4. Modelo de Datos y Base de Datos PostgreSQL

El archivo `src/lib/db/schema.sql` define **9 tipos ENUM**, **14 tablas** y **8 indices parciales**, con bloques `DO $$` y `ALTER TABLE` completamente idempotentes para migrar instancias existentes (como Neon) sin perdida de datos.

### 4.1 Tipos ENUM

- `med_frequency_type`: `'FIXED_HOURS' | 'DAILY_SLOTS' | 'INTERVAL_DAYS' | 'INTERVAL_WEEKS'`
- `intake_constraint`: `'NONE' | 'FASTING' | 'WITH_FOOD' | 'SEPARATE_FROM_OTHERS'`
- `intake_status`: `'PENDING' | 'TAKEN' | 'DELAYED' | 'SKIPPED'`
- `event_category`: `'APPOINTMENT' | 'INJECTION' | 'LAB_TEST' | 'PROCEDURE' | 'OTHER'`
- `task_status`: `'PENDING' | 'IN_PROGRESS' | 'WAITING_RESPONSE' | 'COMPLETED'`
- `alert_stage`: `'7_DAYS_BEFORE' | '3_DAYS_BEFORE' | '1_DAY_BEFORE' | 'DAY_OF' | 'EXACT_TIME' | 'LOW_STOCK_7D'`
- `alert_status`: `'QUEUED' | 'SENT' | 'ACKNOWLEDGED' | 'SNOOZED'`
- `expense_category`: `'MEDICATION' | 'APPOINTMENT' | 'LAB_TEST' | 'IMAGING' | 'PROCEDURE' | 'THERAPY' | 'INSURANCE' | 'OTHER'`
- `expense_status`: `'PAID' | 'PLANNED' | 'CANCELLED'`

### 4.2 Tablas del Esquema (14 Tablas)

1. **`medications`**: Catalogo, posologia, inventario y datos comerciales.
   - Campos obligatorios: `id`, `name`, `presentation`, `dose_amount`, `frequency_type`, `frequency_value`, `tolerance_window_mins`, `intake_rule`, `daily_consumption_rate`, `purchase_priority`, `safety_buffer_days`, `is_active`.
   - Campos opcionales/diferibles (`NULL` permitido): `active_ingredient`, `units_per_package`, `package_price`, `current_stock`, `preferred_pharmacy`, `clinical_notes`, `archived_at`, `discontinuation_reason`.
   - Columna generada `STORED`:
     ```sql
     days_of_supply_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (
       CASE
         WHEN current_stock IS NULL THEN NULL
         WHEN daily_consumption_rate > 0 THEN ROUND(current_stock / daily_consumption_rate, 2)
         ELSE 999
       END
     ) STORED
     ```
2. **`intake_clusters`**: Bloques horarios compartidos (`label`, `anchor_time TIME`, `intake_rule`, `is_active`).
3. **`medication_schedules`**: Tomas calculadas por medicamento vinculadas opcionalmente a `cluster_id` (`ideal_time`, `effective_clustered_time`, `day_of_week`, `is_active`).
4. **`intake_logs`**: Registro operativo de cada toma (`medication_id`, `schedule_id`, `cluster_id`, `scheduled_for TIMESTAMPTZ`, `taken_at TIMESTAMPTZ`, `status`, `quantity_deducted`, `recorded_by`, `observations`).
5. **`clinical_events`**: Citas, estudios, procedimientos e inyecciones (`title`, `category`, `specialist_or_center`, `location_address`, `event_datetime`, `is_recurring`, `recurrence_interval_days`, `medication_id`, `parent_event_id`, `preparation_instructions`, `estimated_cost`, `actual_cost`, `periodicity_label`, `date_is_estimated`, `notes`, `is_completed`, `completed_at`).
6. **`follow_up_topics`**: Casos abiertos y valoraciones (`title`, `description`, `status`, `priority`, `progress_percentage`, `estimated_budget`, `deadline_at`, `resolved_at`).
7. **`topic_annotations`**: Bitacora cronologica por tema (`topic_id`, `author`, `note_type`, `contact_name`, `contact_phone`, `estimated_cost`, `content`).
8. **`telegram_recipients`**: Destinatarios autorizados (`full_name`, `role`, `telegram_chat_id UNIQUE`, flags `receive_med_reminders`, `receive_restock_alerts`, `receive_event_reminders`, `receive_topic_reminders`, `is_active`).
9. **`notification_queue`**: Cola transaccional unificada (`source_type`, `source_id`, `stage`, `trigger_at`, `status`, `title`, `message`, `callback_action_payload`, `telegram_message_ids JSONB`, `retry_count`, `last_error`, `idempotency_key UNIQUE`, `sent_at`, `acknowledged_at`, `acknowledged_by_chat_id`).
10. **`financial_settings`**: Configuracion singleton (`id = 1`) del calendario de pago (`currency`, `pay_schedule_type`, `payday_1`, `payday_2`, `biweekly_anchor_date`, `quincenal_budget_cap`, `monthly_budget_cap`, `safety_buffer_days`, `planning_horizon_quincenas`, `include_events_in_plan`).
11. **`medical_expenses`**: Bitacora real de compras y gastos medicos (`title`, `category`, `status`, `amount`, `expense_date`, `quincena_label`, `medication_id`, `clinical_event_id`, `packages_purchased`, `units_added`, `provider_or_pharmacy`, `payment_method`, `receipt_reference`, `notes`).
12. **`patient_profile`**: Ficha clinica singleton (`id = 1`) del paciente (`full_name`, `birth_date`, `blood_type`, `weight_kg`, `height_cm`, `allergies`, `chronic_conditions`, `insurance_provider`, `insurance_policy`, `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relation`, `general_notes`).
13. **`care_providers`**: Directorio de medicos, centros, laboratorios y farmacias (`name`, `specialty`, `clinic_or_center`, `city`, `phone`, `consultation_fee`, `address`, `notes`, `is_active`).
14. **`governance_audit_logs`**: Trazabilidad de gobernanza (`entity_type`, `entity_id`, `entity_label`, `action`, `actor`, `summary`, `metadata JSONB`, `created_at`).

### 4.3 Indices Parciales (8 Indices)

- `idx_meds_low_stock`: `medications (days_of_supply_remaining) WHERE is_active = TRUE AND days_of_supply_remaining IS NOT NULL AND days_of_supply_remaining <= 7`
- `idx_intake_pending_today`: `intake_logs (scheduled_for, cluster_id) WHERE status = 'PENDING'`
- `idx_events_upcoming`: `clinical_events (event_datetime) WHERE is_completed = FALSE`
- `idx_topics_open`: `follow_up_topics (deadline_at, status) WHERE status != 'COMPLETED'`
- `idx_notifications_dispatch`: `notification_queue (trigger_at, retry_count) WHERE status = 'QUEUED' AND retry_count < 5`
- `idx_telegram_active_recipients`: `telegram_recipients (telegram_chat_id) WHERE is_active = TRUE`
- `idx_expenses_active_date`: `medical_expenses (expense_date DESC) WHERE status != 'CANCELLED'`
- `idx_audit_recent`: `governance_audit_logs (created_at DESC)`

### 4.4 Triggers y Funciones PL/pgSQL (`src/lib/db/triggers.sql`)

1. **`fn_process_medication_intake()` + `trg_after_intake_taken` (`AFTER INSERT OR UPDATE OR DELETE ON intake_logs`)**:
   - Al pasar una toma a `'TAKEN'` (insertada en `'TAKEN'` o actualizada desde otro estado): descuenta `quantity_deducted` en `medications` solo cuando `current_stock IS NOT NULL` (clamp `GREATEST(0, ...)`). Si `days_of_supply_remaining <= 7`, inserta una alerta `'RESTOCK_ALERT'` (`stage = 'LOW_STOCK_7D'`) con clave idempotente `'RESTOCK_' || medication_id || '_' || CURRENT_DATE`.
   - Si `current_stock IS NULL` (medicamento con stock pendiente), no muta a `0` ni dispara falsas alertas.
   - **Reembolso automatico**: al revertir una toma de `'TAKEN'` a `'PENDING'`, `'DELAYED'` o `'SKIPPED'`, o al eliminar (`DELETE`) una toma `'TAKEN'`, suma automaticamente `OLD.quantity_deducted` de vuelta a `current_stock` (si `current_stock IS NOT NULL`).
2. **`fn_schedule_cascading_alerts(p_source_type, p_source_id, p_title, p_details, p_target_datetime)`**:
   - Programa en `notification_queue` hasta 4 etapas: `7_DAYS_BEFORE` (-7d si > `NOW()`), `3_DAYS_BEFORE` (-3d si > `NOW()`), `1_DAY_BEFORE` (-1d si > `NOW()`) y `DAY_OF` (0d), usando claves `idempotency_key` unicas por origen, etapa y fecha.

---

## 5. Gobernanza de la Informacion y Normas de Captura

### 5.1 Normas para Alta y Edicion de Medicamentos

El formulario de inventario separa formalmente dos niveles de captura:

- **Seccion 1 — Nucleo Clinico Obligatorio (sin excepcion)**:
  - `name` (nombre comercial / concentracion)
  - `presentation` (Tableta, Capsula, Inyeccion, etc.)
  - `dose_amount` (cantidad por toma > 0)
  - `frequency_type` + `frequency_value`
  - `intake_rule` (`NONE`, `FASTING`, `WITH_FOOD`, `SEPARATE_FROM_OTHERS`)
  - Horarios ideales iniciales (para calcular bloques desde el dia 1)
- **Seccion 2 — Inventario, Envase y Costo (Opcional / Diferible)**:
  - `current_stock`, `units_per_package`, `package_price` pueden marcarse explicitamente como **"Pendiente"** (`NULL` en PostgreSQL).
  - Diferencia critica: `NULL` significa **`[PENDIENTE DE CAPTURA]`** (el farmaco opera en bloques de toma diarios, aparece en la banda `[DATOS PENDIENTES]` y se excluye temporalmente de proyecciones de compra), mientras que `0` significa **`[AGOTADO]`** (dispara alerta critica `<= 7 dias`).
  - `preferred_pharmacy`, `purchase_priority` (`1` Esencial, `2` Media, `3` Suplemento) y `safety_buffer_days` permiten afinar el optimizador financiero.

### 5.2 Matriz Completa de Gobernanza CRUD

| Modulo | Crear | Editar | Acciones Operativas / Estado | Borrar / Archivar |
| :--- | :--- | :--- | :--- | :--- |
| **Tomas del Dia (`Command Center`)** | Regenerar tomas para fecha activa | Editar `observations` por toma; selector de fecha (Hoy, Ayer, calendario) | Confirmar bloque completo, confirmar individual (`TAKEN`), `DELAYED`, `SKIPPED`, **Revertir a `PENDING`** (reembolsa stock) | Eliminar registro individual de `intake_logs` (confirmacion en 2 pasos; reembolsa stock si era `TAKEN`) |
| **Medicamentos** | Alta con nucleo obligatorio + campos diferibles | Edicion completa de posologia, horarios, precios, envase y farmacia (regenera tomas `PENDING` de hoy) | Sumar stock (`Restock` con gasto opcional), **Ajuste exacto fisico** (o volver a `NULL`) | **Archivar / Suspender** con motivo (conserva historial); **Restaurar**; **Borrar definitivo** en 2 pasos |
| **Bloques Horarios (`Clusters`)** | Crear bloque (`label`, `anchor_time`, `intake_rule`) | Editar etiqueta, hora ancla y regla (actualiza schedules y tomas `PENDING` vinculadas) | -- | Eliminar bloque con re-optimizacion automatica de farmacos vinculados |
| **Finanzas y Gastos** | Registrar gasto manual o compra ejecutada | Editar cualquier gasto real (`medical_expenses`) y configuracion quincenal (`financial_settings`) | Ejecutar compra planeada desde tarjeta de quincena en 1 clic | Eliminar gasto en 2 pasos |
| **Agenda Clinica** | Programar cita, inyeccion, estudio o procedimiento (con costo y fecha estimada) | Edicion completa de todos los campos (regenera cascada `QUEUED`) | Reprogramar fecha; **Completar** con costo real, notas y registro automatico de gasto; **Reabrir** evento completado | Eliminar evento (y sus alertas en cola) en 2 pasos |
| **Temas de Seguimiento** | Crear caso con prioridad, presupuesto y deadline | Editar titulo, descripcion, estado, progreso, prioridad, presupuesto y deadline; editar anotaciones | **Convertir tema a evento clinico**; agregar anotaciones | Eliminar tema (y su bitacora) o eliminar anotacion individual en 2 pasos |
| **Expediente y Proveedores** | Agregar especialista, laboratorio o farmacia | Editar ficha clinica singleton (`patient_profile`) y editar proveedores | Copiar resumen clinico limpio; imprimir ficha | Eliminar proveedor en 2 pasos |
| **Telegram Bot** | Alta de destinatarios (`upsert`) | Editar nombre, rol y `chat_id`; alternar permisos por categoria | Despachar cola, probar bot, vincular webhook, **Reencolar / Cancelar** alerta | Eliminar destinatario o notificacion en 2 pasos; purgar confirmadas |

---

## 6. Motor de Agrupacion Horaria (`DoseClusteringService`)

### 6.1 Calculo de Tasa de Consumo Diario (`daily_consumption_rate`)

| `frequency_type` | Formula | Ejemplo Real |
| :--- | :--- | :--- |
| `FIXED_HOURS` | `(24 / frequency_value) * dose_amount` | Valproato 500 mg: `(24 / 8) * 1 = 3.0000/dia` |
| `DAILY_SLOTS` | `frequency_value * dose_amount` | Quetiapina 100 mg: `2 * 3 = 6.0000/dia` |
| `INTERVAL_DAYS` | `dose_amount / frequency_value` | Dosis cada 2 dias: `1 / 2 = 0.5000/dia` |
| `INTERVAL_WEEKS` | `dose_amount / (frequency_value * 7)` | Fluanxol 20 mg cada 3 sem: `1 / 21 = 0.0476/dia` |

### 6.2 Algoritmo de Alineacion y Compatibilidad

- **Desplazamiento simetrico (`FIXED_HOURS`)**: Evalua desplazamientos `delta` en `[-tolerance_window_mins, +tolerance_window_mins]` en pasos de 5 minutos sobre toda la serie diaria (ej. `08:00`, `16:00`, `00:00`) maximizando la coincidencia con `intake_clusters` compatibles (`matches * 10000 - penalty`).
- **Matriz de restricciones (`areConstraintsCompatible`)**:
  - `SEPARATE_FROM_OTHERS`: solo puede asignarse a un cluster vacio de otras reglas.
  - `FASTING`: compatible con clusters `FASTING` o `NONE` sin medicamentos `WITH_FOOD`.
  - `WITH_FOOD`: compatible con clusters `WITH_FOOD` o `NONE` sin medicamentos `FASTING`.
  - `NONE`: compatible salvo con `SEPARATE_FROM_OTHERS`.
- **Tomas sin bloque compartido (`cluster_id IS NULL`)**: Se muestran tanto en `CommandCenterView` (seccion *Tomas en Horario Dedicado*) como en el comando `[ Tomas de Hoy ]` de Telegram con botones individuales `ack_log:<id>`.

---

## 7. Sistema Financiero y Optimizador Quincenal (`FinancialPlannerService`)

El modulo de **Finanzas y Quincenas** transforma los datos del inventario y la agenda en un presupuesto accionable alineado con las fechas de salario.

### 7.1 Calendario de Pago Quincenal

Soporta 4 modos configurables desde la interfaz en `financial_settings`:

1. `QUINCENAL_15_30` *(por defecto)*: Dias **15** y **30 (o ultimo dia del mes)**; en febrero resuelve automaticamente al dia `28` (o `29` en ano bisiesto) mediante `Math.min(payday, daysInMonth)`.
2. `QUINCENAL_1_15`: Dias **1** y **15** de cada mes.
3. `CUSTOM_DAYS`: Dos dias personalizados del mes (`payday_1`, `payday_2`).
4. `CATORCENAL`: Cada **14 dias** exactos a partir de `biweekly_anchor_date`.

### 7.2 Simulacion de Agotamiento y Suavizado de Picos (Algoritmo Min-Max)

1. **Separacion de medicamentos**: Cualquier farmaco activo sin `current_stock`, `units_per_package` o `package_price` se reporta en `incomplete_pricing_medications` sin romper los calculos.
2. **Eventos clinicos fijos**: Si `include_events_in_plan = TRUE`, todas las citas y estudios pendientes con `estimated_cost > 0` dentro del horizonte se anclan a la quincena cuya ventana `[pay_date, period_end]` los contiene.
3. **Simulacion de reposicion**: Para cada medicamento planificable, simula envase por envase dentro del horizonte (`planning_horizon_quincenas`, entre 2 y 12 quincenas) calculando:
   - `projected_depletion_date = refDate + (simStock / daily_consumption_rate)`
   - `recommended_deadline_date = refDate + max(0, depleteDays - safety_buffer_days)`
   - `latest_quincena_idx`: ultima fecha de pago `<= recommended_deadline_date`. Si vence antes de la proxima quincena, marca `urgent_before_payday = TRUE`.
4. **Optimizacion Min-Max de Carga**:
   - Calcula el gasto **Sin Optimizar (Baseline)** colocando cada compra en su ultima quincena posible (`latest_quincena_idx`).
   - Ordena las compras por `(latest_quincena_idx ASC, total_cost DESC, purchase_priority ASC)`.
   - Para cada compra, evalua ubicarla en `q` dentro de `[max(ultimaQuincenaDelMismoFarmaco, latest_quincena_idx - maxLookback) .. latest_quincena_idx]`, donde `maxLookback` es `2` quincenas (o `3` si la quincena limite excede `quincenal_budget_cap`).
   - Elige la quincena que minimiza `nuevoTotalQuincena + penalizacionExcesoTope + (latest_quincena_idx - q) * 1.0`. De este modo solo adelanta compras cuando reduce efectivamente la acumulacion de gasto.
5. **Fondo de Reserva y Ejecucion en 1 Clic**:
   - Detecta quincenas con concentracion alta de consultas/estudios (ej. 15 de enero de 2027) y calcula el monto sugerido a apartar por quincena previa (`reserve_alerts`).
   - El boton **Registrar Compra** ejecuta `executePlannedPurchase()` en una sola transaccion ACID: suma el inventario, actualiza `package_price` si cambio, cierra alertas `RESTOCK_ALERT`, crea el registro `PAID` en `medical_expenses` y registra auditoria `PURCHASE_EXECUTED`.

---

## 8. Expediente Clinico, Adherencia 30 Dias y Directorio Medico

Disponible en la pestana **Expediente**:

- **Ficha Clinica del Paciente (`patient_profile`)**: Datos generales, tipo de sangre, peso, estatura, aseguradora/poliza, contacto de emergencia y bloque resaltado de **Alergias y Precauciones Criticas**.
- **Resumen Clinico para Consulta**: Boton **"Copiar Resumen para Consulta"** (genera texto estructurado limpio sin emojis listo para enviar a medicos) y **"Imprimir Ficha"** (`window.print()`).
- **Adherencia Farmacologica (30 Dias)**: Agregacion SQL por medicamento (`taken_count`, `delayed_count`, `skipped_count`, `pending_count`, `adherence_pct`).
- **Directorio de Especialistas, Laboratorios y Farmacias (`care_providers`)**: CRUD completo con tarifa de referencia, ciudad, telefono, direccion y notas.
- **Bitacora de Auditoria (`governance_audit_logs`)**: Ultimos 50 eventos de gobernanza filtrables por modulo.

---

## 9. Terminal Bilateral de Telegram Bot

### 9.1 Teclado Persistente y Comandos

`PATIENT_PERSISTENT_KEYBOARD` (`resize_keyboard: true`, `is_persistent: true`):
- `[ Tomas de Hoy ]` / `/tomas`: Envia bloques pendientes del dia y tomas dedicadas con botones para confirmar el bloque completo (`ack_cluster`) o medicamento por medicamento (`ack_log`).
- `[ Registrar Restock ]` / `/restock`: Lista medicamentos activos (incluidos aquellos con inventario `PENDIENTE`) ordenados por urgencia, con flujo guiado de 2 toques (`restock_sel` -> `restock_add`: `+1 Envase`, `+2 Envases`, `+10`, `+5`).
- `[ Proximas Citas ]` / `/citas`: Lista los proximos 10 eventos clinicos pendientes con fecha, especialista, ubicacion e indicaciones.
- `[ Estado de Inventario ]` / `/estado`: Genera reporte HTML consolidado con 5 bloques:
  1. `1. BLOQUES PENDIENTES HOY`
  2. `2. INVENTARIO CRITICO (<= 7 DIAS)`
  3. `3. PROXIMOS EVENTOS CLINICOS (TOP 5)`
  4. `4. TEMAS DE SEGUIMIENTO ABIERTOS (TOP 5)`
  5. `5. FARMACOS CON DATOS PENDIENTES` *(cuando existan campos nulos)*
- `/start` o `/menu`: Envia instrucciones y teclado persistente.

### 9.2 Callbacks (`<= 64` bytes UTF-8) y Sincronizacion Bidireccional

| Prefijo `callback_data` | Accion | Efecto |
| :--- | :--- | :--- |
| `ack_cluster:<clusterId>:<YYYY-MM-DD>` | Confirmar bloque completo | Marca tomas `PENDING` como `TAKEN`, descuenta stock y edita mensaje |
| `ack_log:<intakeLogId>` | Confirmar toma individual | Marca `TAKEN`, actualiza mensaje parcial o completo del bloque |
| `restock_sel:<medId>` | Seleccionar farmaco | Muestra stock/cobertura (o `PENDIENTE`) y botones de envase/unidades |
| `restock_add:<medId>:<qty>` | Sumar inventario | Suma `qty` al stock (o inicializa desde `NULL`), cierra alertas `RESTOCK_ALERT` |
| `snooze:<notifId>:<mins>` | Posponer recordatorio | Reprograma `trigger_at = NOW() + mins` y devuelve a `QUEUED` |
| `ack_restock:<medId>` | Reconocer alerta restock | Marca alertas `RESTOCK_ALERT` del farmaco como `ACKNOWLEDGED` |
| `ack_notif:<idOrSource>:<stage>` | Confirmar recepcion | Marca la notificacion como `ACKNOWLEDGED` |

- **Sincronizacion Web -> Telegram**: Confirmar bloques/tomas o ejecutar restock desde la consola web actualiza la cola y llama a `editMessageText` (`syncClusterStateFromWeb`, `syncRestockFromWeb`) para reflejar `[ACTUALIZADO DESDE EL PANEL WEB]` en los chats donde se entrego el mensaje.
- **Despachador Transaccional**: Usa `FOR UPDATE SKIP LOCKED` con limite de 50 mensajes por ejecucion, respeto por permisos granulares de `telegram_recipients`, reintentos (`retry_count < 5`), y controles web de **Reencolar**, **Cancelar**, **Eliminar** y **Limpiar Confirmadas**.

---

## 10. Referencia Completa de API HTTP

Todas las rutas estan fijadas en `region: "iad1"`, `dynamic = "force-dynamic"` y devuelven `Cache-Control: no-store, no-cache, must-revalidate`.

| Endpoint | Metodo | Auth / Headers | Acciones / Descripcion |
| :--- | :--- | :--- | :--- |
| `/api/command-center` | `GET` | -- | Snapshot completo en un viaje SQL + plan quincenal (`?date=YYYY-MM-DD`) |
| `/api/medications` | `POST` | JSON | `create`, `update`, `adjust_stock`, `archive`, `restore`, `delete`, `generate_today`, `create_cluster`, `update_cluster`, `delete_cluster` |
| `/api/intakes/confirm` | `POST` | JSON | `confirm_cluster`, `confirm_single`, `delete_log`, `restock` (con gasto opcional) |
| `/api/events` | `POST` | JSON | `create`, `update`, `reschedule`, `complete` (con costo/notas/gasto), `reopen`, `delete` |
| `/api/topics` | `POST` | JSON | `create_topic`, `update_topic`, `delete_topic`, `add_annotation`, `update_annotation`, `delete_annotation`, `convert_to_event` |
| `/api/finances` | `POST` | JSON | `update_settings`, `create_expense`, `update_expense`, `delete_expense`, `execute_planned_purchase` |
| `/api/dossier` | `POST` | JSON | `update_profile`, `create_provider`, `update_provider`, `delete_provider` |
| `/api/telegram/recipients` | `POST` | JSON | `upsert`, `update`, `delete`, `toggle`, `test_connection`, `register_webhook`, `retry_notification`, `cancel_notification`, `delete_notification`, `purge_acknowledged` |
| `/api/telegram/dispatch` | `POST` | -- | Ejecuta `dispatchQueuedNotifications()` desde consola web |
| `/api/telegram/webhook` | `POST` | `X-Telegram-Bot-Api-Secret-Token` | Procesa `message` y `callback_query` (`?simulate=1` para pruebas locales desde UI) |
| `/api/cron/dispatch` | `GET`, `POST` | `Authorization: Bearer <CRON_SECRET>` | Endpoint ligero para cron externo cada 60s (`dispatched_count`, `failed_count`, `execution_ms`) |

---

## 11. Base Clinica Inicial Cargada (Esquema Real del Paciente)

### 11.1 Bloques Horarios (`intake_clusters`)

- `Bloque Desayuno` (`08:00`, `WITH_FOOD`)
- `Bloque Vespertino` (`16:00`, `NONE`)
- `Bloque Cena / Noche` (`21:00`, `WITH_FOOD`)
- `Bloque Medianoche (Cada 8h)` (`00:00`, `NONE`)

### 11.2 Catalogo de Medicamentos (`medications`)

| Medicamento | Dosis y Horario | Envase / Precio | Inventario Inicial | Tasa Diaria | Estado en Plan Quincenal |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Leflunomida 20 mg** | 1 tableta en desayuno (`08:00`) | 30 / `$250.00` | 90 tabletas (90 d) | 1/dia | Activo |
| **Omega 3** | 2 tabletas en desayuno (`08:00`) | 60 / `$350.00` | 54 tabletas (27 d) | 2/dia | Activo |
| **Rolet Sup 80/12.5** *(Telmisartan/HCTZ)* | 1 tableta en desayuno (`08:00`) | `NULL` / `NULL` | `NULL` | 1/dia | `[DATOS PENDIENTES]` |
| **Valproato semisodico 500 mg** | 1 tableta c/8h (`08:00`, `16:00`, `00:00`) | 30 / `$330.00` | 51 tabletas (17 d) | 3/dia | Activo |
| **Quetiapina 100 mg** | 3 tab desayuno + 3 tab cena (`08:00`, `21:00`) | 60 / `$517.00` | 102 tabletas (17 d) | 6/dia | Activo |
| **Amlodipino 5 mg** | 1 tableta en la noche (`21:00`) | 100 / `$170.00` | 100 tabletas (100 d) | 1/dia | Activo |
| **Fluanxol 20 mg** *(Flupentixol decanoato)* | 1 inyeccion cada 21 dias | 1 / `$1,370.00` | 2 inyecciones (42.02 d) | 0.0476/dia | Activo + Evento 21d |

### 11.3 Eventos Clinicos y Temas en Valoracion

| Evento / Tema | Categoria | Periodicidad | Precio Ref. | Fecha Programada / Estimada |
| :--- | :--- | :--- | :--- | :--- |
| Aplicacion de Inyeccion Fluanxol 20 mg | `INJECTION` | Cada 21 dias | Incluido en farmacia | `+14 dias` (recurrente 21d) |
| Consulta Psiquiatria Comalcalco | `APPOINTMENT` | Cada 2 meses | `$1,000.00` | `2026-12-15` (estimada) |
| Analisis Clinicos de Control | `LAB_TEST` | Cada 3 o 4 meses | `$600.00` | `2027-01-15` (estimada) |
| Ultrasonido de Seguimiento | `LAB_TEST` | Indeterminada | `$1,000.00` | `2027-01-15` (estimada) |
| Consulta de Reumatologia | `APPOINTMENT` | Cada 3 o 4 meses | `$1,500.00` | `2027-01-15` (estimada) |
| Radiografias Anuales de Control | `LAB_TEST` | Cada 12 meses | `$1,500.00` | `2027-05-15` (estimada) |
| Completar datos Rolet Sup 80/12.5 | Tema P1 | -- | Pendiente | `+2 dias` |
| Valorar Consulta Psiquiatria CDMX | Tema P2 | -- | `$3,000.00` c/u | `+14 dias` |
| Valorar Consultas Psicologicas | Tema P2 | -- | `$900.00` c/u | `+14 dias` |
| Valorar Consultas Atencion de Manos | Tema P2 | -- | `$600.00` c/u | `+21 dias` |

Configuracion financiera inicial: `pay_schedule_type = 'QUINCENAL_15_30'` (`payday_1 = 15`, `payday_2 = 30`), `safety_buffer_days = 7`, `planning_horizon_quincenas = 6`, `include_events_in_plan = TRUE`.

---

## 12. Guia de Operacion, Despliegue y Solucion de Problemas

### 12.1 Variables de Entorno (`.env.example` / `.env.local`)

```env
DATABASE_URL=postgresql://user:password@ep-xyz-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_WEBHOOK_SECRET=secreto-aleatorio-para-telegram
CRON_SECRET=secreto-aleatorio-para-cron-externo
```

- Si `DATABASE_URL` no esta definido, `src/lib/db/client.ts` opera en modo `LOCAL_POSTGRES` usando PGlite en `.pgdata/clinical-care-db`.
- Si `TELEGRAM_BOT_TOKEN` no esta definido, `TelegramNotificationService` opera en modo `SIMULATED_LOCAL` sin fallar.

### 12.2 Scripts de NPM

| Comando | Accion |
| :--- | :--- |
| `npm run dev` | Levanta servidor de desarrollo en `http://localhost:3000` |
| `npm run build` | Compila Next.js produccion + chequeo de tipos y lint de compilacion |
| `npm run start` | Inicia servidor de produccion compilado |
| `npm run verify` | Ejecuta `scripts/verify-system.ts` (12 pruebas aisladas en PGlite temporal + auditoria cero emojis) |
| `npm run db:init` | Aplica esquema idempotente en la DB activa y verifica conexion con Telegram Bot |
| `npm run db:reset-seed` | Aplica DDL/triggers, limpia datos y carga la base real del paciente (preserva automaticamente `telegram_recipients` reales si existen o con `--preserve-telegram`) |

### 12.3 Despliegue en Vercel Hobby + Telegram + Cron Externo

1. Subir variables de entorno (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`) a Vercel Project Settings.
2. Desplegar el proyecto Next.js en region `iad1` (`vercel.json` no debe tener propiedad `crons` en plan Hobby).
3. Abrir la pestana **Telegram Bot** en la URL publica de Vercel:
   - Reemplazar los Chat IDs plantilla (`100100001`, `100100002`, `100100003`) por los Chat IDs reales de paciente/cuidadores.
   - Pulsar **"Probar Conexion Bot"** y luego **"Vincular Webhook con Vercel"** (invoca `setWebhook` con `secret_token` y `allowed_updates: ["message", "callback_query"]`).
4. Configurar **cron-job.org** o **Cloudflare Workers Cron** cada 60 segundos hacia:
   - URL: `https://<tu-dominio>.vercel.app/api/cron/dispatch`
   - Metodo: `GET` o `POST`
   - Header: `Authorization: Bearer <CRON_SECRET>`

### 12.4 Solucion de Problemas Frecuentes

- **Windows PowerShell bloquea `npm` / `npx` (`UnauthorizedAccess` / `ExecutionPolicy`)**:
  Ejecutar siempre con sufijo `.cmd`, por ejemplo `npm.cmd run verify`, `npm.cmd run build`, `npx.cmd tsc --noEmit`.
- **`verify-system.ts` nunca altera Neon DB**:
  Borra `process.env.DATABASE_URL` al inicio y usa un directorio temporal en `os.tmpdir()`.
- **Error `401 Unauthorized` en webhook de Telegram**:
  Verificar que `TELEGRAM_WEBHOOK_SECRET` en Vercel coincida con el `secret_token` enviado al registrar el webhook (volver a pulsar **"Vincular Webhook con Vercel"** tras cambiar el secreto).
- **Actualizar datos iniciales despues de editar `seed.ts`**:
  Ejecutar `npm.cmd run db:reset-seed` (si ya cargaste Chat IDs reales en Telegram, el script los preserva automaticamente o puedes forzarlo con `npx.cmd tsx scripts/reset-and-seed.ts --preserve-telegram`).
