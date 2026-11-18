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

-- 1. Catalogo e Inventario de Medicamentos
CREATE TABLE IF NOT EXISTS medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    active_ingredient VARCHAR(150),
    presentation VARCHAR(80) NOT NULL,
    units_per_package NUMERIC(10, 2) NOT NULL DEFAULT 30,
    dose_amount NUMERIC(10, 2) NOT NULL,
    current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
    frequency_type med_frequency_type NOT NULL,
    frequency_value INTEGER NOT NULL,
    tolerance_window_mins INTEGER NOT NULL DEFAULT 30,
    intake_rule intake_constraint NOT NULL DEFAULT 'NONE',
    daily_consumption_rate NUMERIC(10, 4) NOT NULL,
    days_of_supply_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (
        CASE WHEN daily_consumption_rate > 0 THEN ROUND(current_stock / daily_consumption_rate, 2) ELSE 999 END
    ) STORED,
    clinical_notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE medications
ADD COLUMN IF NOT EXISTS units_per_package NUMERIC(10, 2) NOT NULL DEFAULT 30;

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
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Temas de Seguimiento y Gestion Medica (Case & Task Management)
CREATE TABLE IF NOT EXISTS follow_up_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'PENDING',
    priority SMALLINT NOT NULL DEFAULT 2,
    progress_percentage SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Indices Parciales de Alta Velocidad para Neon
CREATE INDEX IF NOT EXISTS idx_meds_low_stock ON medications (days_of_supply_remaining) WHERE is_active = TRUE AND days_of_supply_remaining <= 7;
CREATE INDEX IF NOT EXISTS idx_intake_pending_today ON intake_logs (scheduled_for, cluster_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_events_upcoming ON clinical_events (event_datetime) WHERE is_completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_topics_open ON follow_up_topics (deadline_at, status) WHERE status != 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_notifications_dispatch ON notification_queue (trigger_at, retry_count) WHERE status = 'QUEUED' AND retry_count < 5;
CREATE INDEX IF NOT EXISTS idx_telegram_active_recipients ON telegram_recipients (telegram_chat_id) WHERE is_active = TRUE;
