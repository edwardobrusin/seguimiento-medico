-- Extensiones requeridas (tolerante a motores PG 13+ con gen_random_uuid nativo como PGlite)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Enums para integridad de estados (idempotentes)
DO $$ BEGIN
    CREATE TYPE med_frequency_type AS ENUM ('FIXED_HOURS', 'DAILY_SLOTS', 'INTERVAL_DAYS', 'INTERVAL_WEEKS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE intake_constraint AS ENUM ('NONE', 'FASTING', 'WITH_FOOD', 'SEPARATE_FROM_OTHERS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE intake_status AS ENUM ('PENDING', 'TAKEN', 'DELAYED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE event_category AS ENUM ('APPOINTMENT', 'INJECTION', 'LAB_TEST', 'PROCEDURE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE task_status AS ENUM ('PENDING', 'IN_PROGRESS', 'WAITING_RESPONSE', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE alert_stage AS ENUM ('7_DAYS_BEFORE', '3_DAYS_BEFORE', '1_DAY_BEFORE', 'DAY_OF', 'EXACT_TIME', 'LOW_STOCK_7D');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE alert_status AS ENUM ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'SNOOZED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE expense_category AS ENUM ('MEDICATION', 'APPOINTMENT', 'LAB_TEST', 'IMAGING', 'PROCEDURE', 'THERAPY', 'INSURANCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE expense_status AS ENUM ('PAID', 'PLANNED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Catalogo e Inventario de Medicamentos (con soporte para datos diferibles/pendientes y costos)
CREATE TABLE IF NOT EXISTS medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    active_ingredient VARCHAR(150),
    presentation VARCHAR(80) NOT NULL,
    units_per_package NUMERIC(10, 2),
    package_price NUMERIC(12, 2),
    dose_amount NUMERIC(10, 2) NOT NULL,
    current_stock NUMERIC(10, 2),
    frequency_type med_frequency_type NOT NULL,
    frequency_value INTEGER NOT NULL,
    tolerance_window_mins INTEGER NOT NULL DEFAULT 30,
    intake_rule intake_constraint NOT NULL DEFAULT 'NONE',
    daily_consumption_rate NUMERIC(10, 4) NOT NULL,
    days_of_supply_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (
        CASE
            WHEN current_stock IS NULL THEN NULL
            WHEN daily_consumption_rate > 0 THEN ROUND(current_stock / daily_consumption_rate, 2)
            ELSE 999
        END
    ) STORED,
    preferred_pharmacy VARCHAR(150),
    purchase_priority SMALLINT NOT NULL DEFAULT 2,
    safety_buffer_days INTEGER NOT NULL DEFAULT 7,
    clinical_notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    discontinuation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migraciones idempotentes sobre medications para instancias existentes
ALTER TABLE medications ADD COLUMN IF NOT EXISTS units_per_package NUMERIC(10, 2);
ALTER TABLE medications ADD COLUMN IF NOT EXISTS package_price NUMERIC(12, 2);
ALTER TABLE medications ADD COLUMN IF NOT EXISTS preferred_pharmacy VARCHAR(150);
ALTER TABLE medications ADD COLUMN IF NOT EXISTS purchase_priority SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS safety_buffer_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS discontinuation_reason TEXT;

ALTER TABLE medications ALTER COLUMN units_per_package DROP NOT NULL;
ALTER TABLE medications ALTER COLUMN units_per_package DROP DEFAULT;
ALTER TABLE medications ALTER COLUMN current_stock DROP NOT NULL;
ALTER TABLE medications ALTER COLUMN current_stock DROP DEFAULT;

DO $$
DECLARE
    v_expr TEXT;
BEGIN
    SELECT pg_get_expr(ad.adbin, ad.adrelid)
    INTO v_expr
    FROM pg_attribute a
    JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = 'medications'::regclass
      AND a.attname = 'days_of_supply_remaining'
      AND NOT a.attisdropped;

    IF v_expr IS NULL OR POSITION('current_stock IS NULL' IN v_expr) = 0 THEN
        DROP INDEX IF EXISTS idx_meds_low_stock;
        ALTER TABLE medications DROP COLUMN IF EXISTS days_of_supply_remaining;
        ALTER TABLE medications ADD COLUMN days_of_supply_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (
            CASE
                WHEN current_stock IS NULL THEN NULL
                WHEN daily_consumption_rate > 0 THEN ROUND(current_stock / daily_consumption_rate, 2)
                ELSE 999
            END
        ) STORED;
    END IF;
END $$;

-- 2. Bloques de Agrupacion Horaria (Clusters de Toma Optimizada)
CREATE TABLE IF NOT EXISTS intake_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(80) NOT NULL,
    anchor_time TIME NOT NULL,
    intake_rule intake_constraint NOT NULL DEFAULT 'NONE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. Programacion de Tomas por Medicamento vinculada a Clusters
CREATE TABLE IF NOT EXISTS medication_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    cluster_id UUID REFERENCES intake_clusters(id) ON DELETE SET NULL,
    ideal_time TIME NOT NULL,
    effective_clustered_time TIME NOT NULL,
    day_of_week SMALLINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Registro Historico y Operativo de Tomas (Adherencia Cero Fallos)
CREATE TABLE IF NOT EXISTS intake_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES medication_schedules(id) ON DELETE SET NULL,
    cluster_id UUID REFERENCES intake_clusters(id) ON DELETE SET NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    taken_at TIMESTAMPTZ,
    status intake_status NOT NULL DEFAULT 'PENDING',
    quantity_deducted NUMERIC(10, 2) NOT NULL,
    recorded_by VARCHAR(100),
    observations TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Eventos Clinicos (Citas Medicas, Inyecciones, Estudios - Unicos y Recurrentes)
CREATE TABLE IF NOT EXISTS clinical_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    category event_category NOT NULL,
    specialist_or_center VARCHAR(150),
    location_address TEXT,
    event_datetime TIMESTAMPTZ NOT NULL,
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    recurrence_interval_days INTEGER,
    medication_id UUID REFERENCES medications(id) ON DELETE SET NULL,
    parent_event_id UUID REFERENCES clinical_events(id) ON DELETE SET NULL,
    preparation_instructions TEXT,
    estimated_cost NUMERIC(12, 2),
    actual_cost NUMERIC(12, 2),
    periodicity_label VARCHAR(80),
    date_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12, 2);
ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(12, 2);
ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS periodicity_label VARCHAR(80);
ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS date_is_estimated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE clinical_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 6. Temas de Seguimiento y Gestion Medica (Case & Task Management)
CREATE TABLE IF NOT EXISTS follow_up_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'PENDING',
    priority SMALLINT NOT NULL DEFAULT 2,
    progress_percentage SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
    estimated_budget NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
);

ALTER TABLE follow_up_topics ADD COLUMN IF NOT EXISTS estimated_budget NUMERIC(12, 2);
ALTER TABLE follow_up_topics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 7. Bitacora de Anotaciones por Tema de Seguimiento
CREATE TABLE IF NOT EXISTS topic_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES follow_up_topics(id) ON DELETE CASCADE,
    author VARCHAR(100),
    note_type VARCHAR(50) NOT NULL DEFAULT 'PROPOSAL',
    contact_name VARCHAR(150),
    contact_phone VARCHAR(50),
    estimated_cost NUMERIC(12, 2),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE topic_annotations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 8. Destinatarios Autorizados de Telegram
CREATE TABLE IF NOT EXISTS telegram_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(60) NOT NULL DEFAULT 'CAREGIVER',
    telegram_chat_id VARCHAR(64) UNIQUE NOT NULL,
    receive_med_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    receive_restock_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    receive_event_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    receive_topic_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Cola Unificada de Recordatorios y Alertas via Telegram (Idempotente)
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(40) NOT NULL,
    source_id UUID NOT NULL,
    stage alert_stage NOT NULL,
    trigger_at TIMESTAMPTZ NOT NULL,
    status alert_status NOT NULL DEFAULT 'QUEUED',
    title VARCHAR(250) NOT NULL,
    message TEXT NOT NULL,
    callback_action_payload VARCHAR(64),
    telegram_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    retry_count SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    idempotency_key VARCHAR(180) UNIQUE NOT NULL,
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_chat_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Configuracion Financiera y Calendario de Pago Quincenal (Singleton)
CREATE TABLE IF NOT EXISTS financial_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    currency VARCHAR(10) NOT NULL DEFAULT 'MXN',
    pay_schedule_type VARCHAR(30) NOT NULL DEFAULT 'QUINCENAL_15_30',
    payday_1 SMALLINT NOT NULL DEFAULT 15 CHECK (payday_1 BETWEEN 1 AND 31),
    payday_2 SMALLINT NOT NULL DEFAULT 30 CHECK (payday_2 BETWEEN 1 AND 31),
    biweekly_anchor_date DATE,
    quincenal_budget_cap NUMERIC(12, 2),
    monthly_budget_cap NUMERIC(12, 2),
    safety_buffer_days INTEGER NOT NULL DEFAULT 7,
    planning_horizon_quincenas SMALLINT NOT NULL DEFAULT 6 CHECK (planning_horizon_quincenas BETWEEN 2 AND 12),
    include_events_in_plan BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Bitacora de Gastos Medicos y Compras Realizadas
CREATE TABLE IF NOT EXISTS medical_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    category expense_category NOT NULL DEFAULT 'MEDICATION',
    status expense_status NOT NULL DEFAULT 'PAID',
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    quincena_label VARCHAR(40),
    medication_id UUID REFERENCES medications(id) ON DELETE SET NULL,
    clinical_event_id UUID REFERENCES clinical_events(id) ON DELETE SET NULL,
    packages_purchased NUMERIC(10, 2),
    units_added NUMERIC(10, 2),
    provider_or_pharmacy VARCHAR(150),
    payment_method VARCHAR(60),
    receipt_reference VARCHAR(120),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Perfil Clinico del Paciente (Singleton)
CREATE TABLE IF NOT EXISTS patient_profile (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    full_name VARCHAR(150) NOT NULL DEFAULT 'Paciente (Papa)',
    birth_date DATE,
    blood_type VARCHAR(10),
    weight_kg NUMERIC(5, 2),
    height_cm NUMERIC(5, 1),
    allergies TEXT,
    chronic_conditions TEXT,
    insurance_provider VARCHAR(150),
    insurance_policy VARCHAR(120),
    emergency_contact_name VARCHAR(150),
    emergency_contact_phone VARCHAR(60),
    emergency_contact_relation VARCHAR(80),
    general_notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Directorio de Especialistas, Centros, Laboratorios y Farmacias
CREATE TABLE IF NOT EXISTS care_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    specialty VARCHAR(120) NOT NULL,
    clinic_or_center VARCHAR(180),
    city VARCHAR(100),
    phone VARCHAR(60),
    consultation_fee NUMERIC(12, 2),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Bitacora de Auditoria y Gobernanza del Sistema
CREATE TABLE IF NOT EXISTS governance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    entity_label VARCHAR(200) NOT NULL,
    action VARCHAR(40) NOT NULL,
    actor VARCHAR(100) NOT NULL DEFAULT 'Consola Clinica Web',
    summary TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices Parciales de Alta Velocidad para Neon y PGlite
CREATE INDEX IF NOT EXISTS idx_meds_low_stock ON medications (days_of_supply_remaining) WHERE is_active = TRUE AND days_of_supply_remaining IS NOT NULL AND days_of_supply_remaining <= 7;
CREATE INDEX IF NOT EXISTS idx_intake_pending_today ON intake_logs (scheduled_for, cluster_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_events_upcoming ON clinical_events (event_datetime) WHERE is_completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_topics_open ON follow_up_topics (deadline_at, status) WHERE status != 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_notifications_dispatch ON notification_queue (trigger_at, retry_count) WHERE status = 'QUEUED' AND retry_count < 5;
CREATE INDEX IF NOT EXISTS idx_telegram_active_recipients ON telegram_recipients (telegram_chat_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_expenses_active_date ON medical_expenses (expense_date DESC) WHERE status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_audit_recent ON governance_audit_logs (created_at DESC);
