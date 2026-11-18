-- A. Descuento Atomico de Inventario y Alerta de Restock (Umbral <= 7 Dias)
CREATE OR REPLACE FUNCTION fn_process_medication_intake()
RETURNS TRIGGER AS $$
DECLARE
    v_remaining_days NUMERIC;
    v_med_name VARCHAR;
    v_current_stock NUMERIC;
    v_presentation VARCHAR;
    v_should_deduct BOOLEAN := FALSE;
BEGIN
    IF NEW.status = 'TAKEN' THEN
        IF TG_OP = 'INSERT' THEN
            v_should_deduct := TRUE;
        ELSIF OLD.status IS DISTINCT FROM 'TAKEN' THEN
            v_should_deduct := TRUE;
        END IF;
    END IF;

    IF v_should_deduct THEN
        UPDATE medications
        SET current_stock = GREATEST(0, current_stock - NEW.quantity_deducted),
            updated_at = NOW()
        WHERE id = NEW.medication_id
        RETURNING days_of_supply_remaining, name, current_stock, presentation
        INTO v_remaining_days, v_med_name, v_current_stock, v_presentation;

        -- Si el inventario existente no dura para mas de una semana (<= 7 dias), disparar alerta de restock
        IF v_remaining_days IS NOT NULL AND v_remaining_days <= 7 THEN
            INSERT INTO notification_queue (
                source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key
            ) VALUES (
                'RESTOCK_ALERT',
                NEW.medication_id,
                'LOW_STOCK_7D',
                NOW(),
                '[ALERTA DE RESTOCK CRITICO] ' || v_med_name,
                'Inventario actual: ' || v_current_stock || ' (' || v_presentation || '). Cobertura estimada: ' || v_remaining_days || ' dias. Se requiere reabastecimiento inmediato.',
                'ack_restock:' || NEW.medication_id,
                'RESTOCK_' || NEW.medication_id || '_' || CURRENT_DATE
            ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_after_intake_taken ON intake_logs;
CREATE TRIGGER trg_after_intake_taken
AFTER INSERT OR UPDATE ON intake_logs
FOR EACH ROW EXECUTE FUNCTION fn_process_medication_intake();

-- B. Generador Automatico de Cascada de Recordatorios (-7d, -3d, -1d, 0d)
CREATE OR REPLACE FUNCTION fn_schedule_cascading_alerts(
    p_source_type VARCHAR,
    p_source_id UUID,
    p_title VARCHAR,
    p_details TEXT,
    p_target_datetime TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
    -- 1. Recordatorio 1 semana antes (-7 dias)
    IF p_target_datetime - INTERVAL '7 days' > NOW() THEN
        INSERT INTO notification_queue (source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key)
        VALUES (
            p_source_type, p_source_id, '7_DAYS_BEFORE', p_target_datetime - INTERVAL '7 days',
            '[RECORDATORIO - 1 SEMANA ANTES] ' || p_title,
            'Fecha programada: ' || TO_CHAR(p_target_datetime, 'YYYY-MM-DD HH24:MI') || '. ' || COALESCE(p_details, ''),
            'ack_notif:' || p_source_id || ':7D',
            p_source_type || '_' || p_source_id || '_7D_' || DATE(p_target_datetime)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- 2. Recordatorio 3 dias antes (-3 dias)
    IF p_target_datetime - INTERVAL '3 days' > NOW() THEN
        INSERT INTO notification_queue (source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key)
        VALUES (
            p_source_type, p_source_id, '3_DAYS_BEFORE', p_target_datetime - INTERVAL '3 days',
            '[RECORDATORIO - 3 DIAS ANTES] ' || p_title,
            'Fecha programada: ' || TO_CHAR(p_target_datetime, 'YYYY-MM-DD HH24:MI') || '. ' || COALESCE(p_details, ''),
            'ack_notif:' || p_source_id || ':3D',
            p_source_type || '_' || p_source_id || '_3D_' || DATE(p_target_datetime)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- 3. Recordatorio 1 dia antes (-1 dia)
    IF p_target_datetime - INTERVAL '1 day' > NOW() THEN
        INSERT INTO notification_queue (source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key)
        VALUES (
            p_source_type, p_source_id, '1_DAY_BEFORE', p_target_datetime - INTERVAL '1 day',
            '[RECORDATORIO - 1 DIA ANTES] ' || p_title,
            'Accion requerida para manana: ' || TO_CHAR(p_target_datetime, 'YYYY-MM-DD HH24:MI') || '. ' || COALESCE(p_details, ''),
            'ack_notif:' || p_source_id || ':1D',
            p_source_type || '_' || p_source_id || '_1D_' || DATE(p_target_datetime)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- 4. Recordatorio el dia en cuestion (0 dias)
    INSERT INTO notification_queue (source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key)
    VALUES (
        p_source_type, p_source_id, 'DAY_OF', p_target_datetime,
        '[RECORDATORIO - HOY] ' || p_title,
        'Programado para hoy: ' || TO_CHAR(p_target_datetime, 'YYYY-MM-DD HH24:MI') || '. ' || COALESCE(p_details, ''),
        'ack_notif:' || p_source_id || ':0D',
        p_source_type || '_' || p_source_id || '_0D_' || DATE(p_target_datetime)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
