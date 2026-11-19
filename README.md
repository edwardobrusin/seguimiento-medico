# Sistema de Seguimiento Clinico, Farmacologico y Financiero Familiar

Fuente de verdad tecnica, operativa y funcional de la plataforma de seguimiento medico integral para paciente y responsables familiares.

---

## 1. Proposito y Alcance del Sistema

Esta plataforma resuelve de extremo a extremo la operacion clinica y financiera diaria del tratamiento medico familiar:

1. **Acceso Autenticado con Dos Niveles de Permisos y Modo Sigiloso (Stealth RBAC)**:
   - Inicio de sesion obligatorio con usuario y contrasena antes de renderizar cualquier dato clinico.
   - **Rol Paciente (`PATIENT`)**: Libertad completa para consultar y editar tomas diarias, medicamentos, periodicidad, restocks, citas, temas de seguimiento, expediente y plan financiero quincenal. No tiene acceso a acciones destructivas (eliminar o archivar registros, restaurar versiones, gestionar usuarios) ni puede ver ninguna referencia a Telegram, control de versiones o herramientas administrativas. La interfaz del paciente no muestra avisos de bloqueo ni pistas de que existen otros niveles de permisos.
   - **Rol Administrador (`ADMIN`)**: Control total sobre el catalogo, eliminacion con confirmacion en dos pasos, archivo y reactivacion de medicamentos, panel de control de versiones con restauracion a un clic, administracion de cuentas de acceso, bitacora de auditoria y gobernanza del bot de Telegram.
2. **Motor de Periodicidad Inteligente por Dia de la Semana e Intervalos**:
   - Soporta esquemas diarios en todos los dias o restringidos a dias especificos de la semana (por ejemplo, **Leflunomida 20 mg** de **Lunes a Viernes** con descanso sabado y domingo), asi como intervalos por dias o semanas con fecha ancla (`schedule_start_date`) o medicamentos vinculados exclusivamente a citas de agenda (`event_linked_only`).
   - Calcula automaticamente la tasa real de consumo diario ajustada por dias activos:
     $$\text{Tasa Diaria Efectiva} = \frac{\text{Tomas Diarias} \times \text{Dosis} \times \text{Dias Activos por Semana}}{7}$$
   - Genera bitacoras diarias de toma (`intake_logs`) y recordatorios unicamente en los dias activos del medicamento, mostrando en el Resumen del Dia los tratamientos en descanso programado (`resting_medications_today`).
3. **Control de Cambios y Versionado por Medicamento (`medication_versions`)**:
   - Cada creacion, edicion de dosis/horarios/periodicidad, restock, ajuste fisico de stock, archivo, reactivacion o restauracion captura una instantanea completa (`snapshot_json`) y el diferencial campo por campo (`changed_fields`).
   - Cuando el Paciente modifica un medicamento o registra un restock (en web o Telegram), la version queda marcada como pendiente de revision (`reviewed_by_admin = FALSE`) y se encola una alerta inmediata para los administradores (`PATIENT_CHANGE_ALERT`).
   - Los administradores pueden marcar cualquier cambio como revisado o restaurar un medicamento a cualquier version previa, recalculando horarios y tomas pendientes del dia.
4. **Separacion Paciente vs Administrador en Telegram y Monitoreo Automatico**:
   - **Paciente en Telegram**: Recibe recordatorios de bloques de toma y citas; cuenta con teclado dedicado (`[ Tomas de Hoy ]`, `[ Registrar Restock ]`, `[ Proximas Citas ]`, `[ Estado de Inventario ]`) y botones inline para confirmar tomas o sumar cajas al inventario.
   - **Administradores en Telegram**: Reciben alertas automaticas cuando un bloque horario no se marca como tomado tras el periodo de gracia configurable (`MISSED_INTAKE_ALERT`, por defecto 60 minutos), recordatorios de citas en cascada (`-7d`, `-3d`, `-1d`, `0d`), alertas de stock critico (`<= 7 dias`), avisos de cambios hechos por el paciente (`PATIENT_CHANGE_ALERT`) y el **Reporte Semanal de Comportamiento y Adherencia** (`WEEKLY_REPORT`, programado por defecto los domingos a las 20:00 `America/Mexico_City` o bajo demanda con `/reporte`).
5. **Planeador Financiero Quincenal (`FinancialPlannerService`)**:
   - Proyecta el agotamiento exacto de cada medicamento con base en su tasa diaria efectiva, adelanta compras no urgentes a quincenas previas para suavizar picos de gasto y permite medicamentos con datos comerciales diferibles (como `Rolet Sup`).
6. **Interfaz Clinica Basada en Simbolos (`IconActionButton`) y Ventanas Modales (`ClinicalModal`)**:
   - Botones de accion por simbolo SVG (`lucide-react`) de `44x44px` con separacion minima de `8px`, `aria-label`, tooltip contextual, estados de carga y barra de leyenda visual en cada vista.
   - Todos los formularios de creacion, edicion, restock, ajuste, reprogramacion y configuracion abren en ventanas modales centradas (`ClinicalModal`) con validacion en linea y notificaciones flotantes (`clinical-toast`).

---

## 2. Pila Tecnologica y Paridad Dual de Base de Datos

- **Framework**: Next.js 15 (App Router), React 19, TypeScript 5.8.
- **Estilos**: Tailwind CSS v4 con tokens clinicos de alto contraste (`#0F172A`, `#0E7490`, `#065F46`, `#92400E`, `#991B1B`), cero emojis en codigo y documentacion, y cero tonos violetas.
- **Base de Datos Dual**:
  - **Produccion / Nube**: Neon Serverless PostgreSQL (`@neondatabase/serverless`) en region `iad1` (`us-east-1`) cuando `DATABASE_URL` esta definida.
  - **Desarrollo Local / Pruebas**: PGlite (`@electric-sql/pglite`) embebido en `.pglite-clinical-db` o forzado en memoria/local con `FORCE_PGLITE=1`.
  - Ambos motores ejecutan exactamente el mismo esquema (`src/lib/db/schema.sql`), los mismos triggers PL/pgSQL (`src/lib/db/triggers.sql`) y la misma semilla (`src/lib/db/seed.ts`).

---

## 3. Credenciales de Acceso y Matriz de Permisos (RBAC)

### 3.1 Cuentas Iniciales por Defecto

Al inicializar la base de datos (`ensureDefaultAuthUsers`), se crean o sincronizan dos cuentas con hash `scrypt` + sal aleatoria:

| Rol | Usuario por Defecto | Contrasena por Defecto | Variable de Entorno (Usuario / Contrasena) |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin` | `AdminClinico2026!` | `CLINICAL_ADMIN_USER` / `CLINICAL_ADMIN_PASSWORD` |
| **Paciente** | `papa` | `Salud2026` | `CLINICAL_PATIENT_USER` / `CLINICAL_PATIENT_PASSWORD` |

Las credenciales pueden actualizarse en cualquier momento desde la interfaz web entrando como Administrador en **Expediente -> Cuentas de Acceso al Sistema**.

### 3.2 Matriz de Permisos y Modo Sigiloso

| Capacidad / Modulo | Paciente (`PATIENT`) | Administrador (`ADMIN`) |
| :--- | :--- | :--- |
| Consultar y cambiar fecha en Resumen del Dia | Permitido | Permitido |
| Marcar bloques o tomas individuales (`Tomado`, `Posponer`, `Omitir`, `Revertir`, `Nota`) | Permitido | Permitido |
| Eliminar un registro de toma (`delete_log`) | Oculto y bloqueado (`403`) | Permitido (confirmacion 2 pasos) |
| Crear y editar medicamentos, horarios y periodicidad por dia de la semana | Permitido (genera version `PATIENT` + alerta a Admin) | Permitido (genera version `ADMIN`) |
| Registrar restock y ajuste fisico de inventario | Permitido (genera version `PATIENT` + alerta a Admin) | Permitido (genera version `ADMIN`) |
| Ver historial de versiones (`medication_versions`) y restaurar version previa | Oculto en DOM/snapshot y bloqueado (`403`) | Permitido |
| Archivar, reactivar o eliminar permanentemente medicamentos | Oculto y bloqueado (`403`) | Permitido |
| Crear y editar bloques horarios (`intake_clusters`) | Permitido | Permitido |
| Eliminar bloques horarios | Oculto y bloqueado (`403`) | Permitido |
| Crear, editar, reprogramar, completar y reabrir citas/eventos clinicos | Permitido | Permitido |
| Eliminar citas/eventos clinicos | Oculto y bloqueado (`403`) | Permitido |
| Crear y editar temas de seguimiento, anotaciones y convertir a cita | Permitido | Permitido |
| Eliminar temas de seguimiento o anotaciones | Oculto y bloqueado (`403`) | Permitido |
| Configurar plan quincenal, ejecutar compras planeadas, crear y editar gastos | Permitido | Permitido |
| Eliminar gastos de la bitacora | Oculto y bloqueado (`403`) | Permitido |
| Editar ficha clinica del paciente y agregar/editar especialistas | Permitido | Permitido |
| Eliminar especialistas del directorio | Oculto y bloqueado (`403`) | Permitido |
| Gestionar cuentas de acceso (`auth_users`) y ver bitacora de auditoria | Oculto en DOM/snapshot y bloqueado (`403`) | Permitido |
| Pestana Telegram Bot, destinatarios, cola, monitoreo y simulador | Oculto en DOM/snapshot y bloqueado (`403`) | Permitido |

---

## 4. Linea Base Clinica Real Cargada en Semilla (`src/lib/db/seed.ts`)

### 4.1 Bloques Horarios Activos (`intake_clusters`)

| Bloque | Hora Ancla (`America/Mexico_City`) | Regla Gastronomica |
| :--- | :--- | :--- |
| **Bloque Desayuno** | `08:00:00` | `WITH_FOOD` (Con Alimentos) |
| **Bloque Vespertino** | `15:00:00` | `WITH_FOOD` (Con Alimentos) |
| **Bloque Cena / Noche** | `21:00:00` | `WITH_FOOD` (Con Alimentos) |

### 4.2 Catalogo Inicial de 7 Medicamentos Reales (`medications`)

| Medicamento | Dosis | Frecuencia | Dias Activos | Horarios Agrupados | Tasa Diaria Efectiva | Stock Inicial | Unidades / Caja | Precio / Caja (MXN) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Leflunomida 20 mg** | 1 Tableta | `DAILY_SLOTS` (1) | **Lunes a Viernes** (`[1,2,3,4,5]`) | `08:00` | `0.7143` | 90 (126 dias) | 30 | \$250.00 |
| **Omega 3** | 2 Tabletas | `DAILY_SLOTS` (1) | Todos los dias | `08:00` | `2.0000` | 54 | 60 | \$350.00 |
| **Rolet Sup 80/12.5** | 1 Tableta | `DAILY_SLOTS` (1) | Todos los dias | `08:00` | `1.0000` | `NULL` (Pendiente) | `NULL` | `NULL` |
| **Valproato semisodico 500 mg** | 1 Tableta | `DAILY_SLOTS` (3) | Todos los dias | `08:00`, `15:00`, `21:00` | `3.0000` | 51 | 30 | \$330.00 |
| **Quetiapina 100 mg** | 3 Tabletas | `DAILY_SLOTS` (2) | Todos los dias | `08:00`, `21:00` | `6.0000` | 102 | 60 | \$517.00 |
| **Amlodipino 5 mg** | 1 Tableta | `DAILY_SLOTS` (1) | Todos los dias | `21:00` | `1.0000` | 100 | 100 | \$170.00 |
| **Fluanxol 20 mg** | 1 Inyeccion | `INTERVAL_WEEKS` (3) | Ciclo de 3 semanas (`2026-11-27`) | Vinculado a cita de agenda | `0.0476` | 2 | 1 | \$1,370.00 |

### 4.3 Eventos Clinicos Destacados (`clinical_events`)

- **Inyeccion Fluanxol 20 mg**: Fecha oficial confirmada **`2026-11-27 16:00:00+00`** (`date_is_estimated = FALSE`), recurrente cada 21 dias, vinculada a `Fluanxol Depot 20 mg / 1 ml`, con 4 alertas automaticas en cascada (`-7d`, `-3d`, `-1d`, `0d`).
- Consultas programadas y tentativas de Psiquiatria, Psicologia, Neurologia, Reumatologia y Medicina Interna.

---

## 5. Arquitectura de Base de Datos y Triggers PL/pgSQL

### 5.1 Tablas Principales (`src/lib/db/schema.sql`)

1. `auth_users`: Cuentas de inicio de sesion (`username`, `display_name`, `role`, `password_hash`, `is_active`).
2. `intake_clusters`: Bloques horarios (`label`, `anchor_time`, `intake_rule`, `is_active`).
3. `medications`: Catalogo farmacologico con soporte para campos comerciales diferibles (`units_per_package`, `package_price`, `current_stock` anulables), periodicidad semanal (`active_days JSONB`), fecha ancla de ciclo (`schedule_start_date DATE`), tasa diaria efectiva (`daily_consumption_rate`) y columna generada `days_of_supply_remaining`.
4. `medication_schedules`: Horarios ideales y tiempos efectivos agrupados a bloques.
5. `medication_versions`: Historial inmutable de versiones por medicamento (`version_number`, `change_action`, `changed_by_role`, `changed_by_actor`, `change_summary`, `changed_fields JSONB`, `snapshot_json JSONB`, `reviewed_by_admin`, `reviewed_at`).
6. `intake_logs`: Registro diario de tomas (`PENDING`, `TAKEN`, `DELAYED`, `SKIPPED`).
7. `clinical_events`: Citas, inyecciones, estudios y procedimientos (`date_is_estimated`, `is_recurring`, `recurrence_interval_days`).
8. `follow_up_topics` y `topic_annotations`: Pendientes medicos con fecha limite, porcentaje de avance y bitacora de cotizaciones/contactos.
9. `telegram_recipients`: Destinatarios separados por rol (`PATIENT` vs `ADMIN` / cuidadores) con banderas granulares (`receive_med_reminders`, `receive_event_reminders`, `receive_restock_alerts`, `receive_topic_reminders`, `receive_missed_block_alerts`, `receive_weekly_report`, `receive_change_alerts`).
10. `alert_monitoring_settings`: Configuracion singleton (`id = 1`) de zona horaria (`America/Mexico_City`), minutos de gracia para bloques no tomados (`missed_block_grace_mins`), dia y hora del reporte semanal (`weekly_report_day`, `weekly_report_hour`) y aviso inmediato de cambios del paciente.
11. `notification_queue`: Cola idempotente (`idempotency_key UNIQUE`) de envios a Telegram.
12. `financial_settings` y `medical_expenses`: Configuracion quincenal y bitacora de gastos medicos.
13. `patient_profile`, `care_providers` y `governance_audit_logs`: Expediente del paciente, directorio medico y auditoria administrativa.

### 5.2 Triggers Automaticos (`src/lib/db/triggers.sql`)

- `fn_process_medication_intake`:
  - Al cambiar un `intake_log` a `TAKEN`, descuenta `dose_amount` de `medications.current_stock` (si `current_stock IS NOT NULL`).
  - Al revertir de `TAKEN` a otro estado, reembolsa `quantity_deducted` al inventario.
  - Si tras el descuento `days_of_supply_remaining <= 7`, encola de forma idempotente una alerta `RESTOCK_ALERT` (`LOW_STOCK_7D`).
- `fn_schedule_cascading_alerts`:
  - Al insertar o reprogramar un evento en `clinical_events` o un tema en `follow_up_topics`, regenera las 4 etapas de recordatorio (`7_DAYS_BEFORE`, `3_DAYS_BEFORE`, `1_DAY_BEFORE`, `DAY_OF`) en `notification_queue`.

---

## 6. Separacion de Telegram Bot y Monitoreo Administrativo

### 6.1 Comandos y Teclado por Rol de Chat ID

El servicio `TelegramNotificationService` identifica el rol del remitente a partir de `telegram_recipients.role`:

- **Perfil Paciente (`role = 'PATIENT'`)**:
  - Teclado persistente: `[ Tomas de Hoy ]`, `[ Registrar Restock ]`, `[ Proximas Citas ]`, `[ Estado de Inventario ]`.
  - Comandos disponibles: `/start`, `/medicinas`, `/tomas`, `/restock`, `/citas`, `/inventario`, `/estado`.
  - Comandos administrativos (`/reporte`, `/cambios`) estan ocultos y bloqueados para el paciente.
  - Cuando el paciente confirma un restock desde Telegram (`RESTOCK_ADD:<med_id>:<qty>`), el sistema actualiza el stock, crea una nueva version en `medication_versions` con `changed_by_role = 'PATIENT'` y encola una alerta `PATIENT_CHANGE_ALERT` para los administradores.
- **Perfil Administrador (`role != 'PATIENT'`)**:
  - Teclado persistente: `[ Resumen Clinico ]`, `[ Reporte Semanal ]`, `[ Cambios Paciente ]`, `[ Stock Critico ]`, `[ Proximas Citas ]`, `[ Registrar Restock ]`.
  - Comandos adicionales exclusivos: `/reporte` (genera reporte semanal de adherencia de los ultimos 7 dias) y `/cambios` (lista las ultimas ediciones y restocks realizados por el paciente pendientes de revision).

### 6.2 Evaluadores Automaticos en Cada Ciclo de Despacho

Cada vez que se ejecuta `TelegramNotificationService.dispatchQueuedNotifications()` (via `/api/cron/dispatch` o desde el boton **Despachar Cola**):

1. `evaluateMissedBlockAlerts()`: Revisa los bloques horarios del dia actual en `America/Mexico_City`. Si ya transcurrieron `missed_block_grace_mins` (por defecto 60 minutos) desde la hora ancla del bloque y aun existen tomas en estado `PENDING`, encola de forma idempotente una alerta `MISSED_INTAKE_ALERT` dirigida exclusivamente a los administradores con `receive_missed_block_alerts = TRUE`. Si el bloque se confirma posteriormente, la alerta pendiente se marca como atendida.
2. `evaluateWeeklyReportSchedule()`: Si el dia y la hora locales coinciden con `weekly_report_day` y `weekly_report_hour` (por defecto Domingo 20:00), encola de forma idempotente (`WEEKLY_REPORT_<ISO_WEEK>`) el reporte semanal de adherencia para todos los administradores con `receive_weekly_report = TRUE`.

---

## 7. Variables de Entorno y Despliegue en Vercel

Copia `.env.example` a `.env.local` y configura:

```ini
DATABASE_URL=postgresql://user:password@ep-xyz-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
TELEGRAM_BOT_TOKEN=123456789:ABCDEF...
TELEGRAM_WEBHOOK_SECRET=secreto-webhook-telegram
CRON_SECRET=secreto-bearer-cron
SESSION_SECRET=secreto-hmac-sesiones-web
CLINICAL_ADMIN_USER=admin
CLINICAL_ADMIN_PASSWORD=AdminClinico2026!
CLINICAL_PATIENT_USER=papa
CLINICAL_PATIENT_PASSWORD=Salud2026
```

### Compatibilidad con Vercel Hobby (`vercel.json`)

- El archivo `vercel.json` fija `"regions": ["iad1"]` y **no declara la clave `"crons"`** para evitar las restricciones del plan Hobby de Vercel.
- Para despachar la cola de Telegram cada 60 segundos en produccion, configura un servicio externo gratuito (como `cron-job.org` o Cloudflare Workers) apuntando a:
  - **URL**: `https://<tu-dominio>.vercel.app/api/cron/dispatch`
  - **Metodo**: `GET` o `POST`
  - **Header**: `Authorization: Bearer <CRON_SECRET>`

---

## 8. Comandos de Operacion y Verificacion

```bash
# 1. Instalar dependencias
npm install

# 2. Verificar tipos de TypeScript
npx tsc --noEmit

# 3. Ejecutar suite integral de pruebas (T1 - T9 sobre PGlite aislado)
npm run verify

# 4. Reiniciar y poblar la base de datos configurada (Neon o PGlite) con la linea base oficial
npm run db:reset-seed

# 5. Compilar build de produccion de Next.js
npm run build

# 6. Iniciar servidor de desarrollo
npm run dev
```
