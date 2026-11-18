import type { DbExecutor } from "./client";

function formatClusterMessageHtml(
  label: string,
  timeHHMM: string,
  items: Array<{ name: string; dose: string; ruleLabel: string }>,
  statusLabel: string
): string {
  const lines = items.map(
    (item, idx) =>
      `<b>${idx + 1}. ${item.name}</b> | Dosis: ${item.dose} | Regla: ${item.ruleLabel}`
  );
  return [
    `<b>[${label.toUpperCase()} - ${timeHHMM}]</b>`,
    "----------------------------------------",
    ...lines,
    "----------------------------------------",
    `Estado: ${statusLabel}`,
  ].join("\n");
}

export async function seedClinicalDatabaseIfEmpty(
  db: DbExecutor
): Promise<void> {
  const existingClusters = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM intake_clusters"
  );
  if (Number(existingClusters.rows[0]?.count ?? "0") > 0) {
    return;
  }

  // 1. Insertar los 4 bloques horarios optimizados
  const cAyunas = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Matutino Ayunas', '07:00:00', 'FASTING', TRUE)
     RETURNING id`
  );
  const cMatutino = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Matutino Alimentos', '08:00:00', 'WITH_FOOD', TRUE)
     RETURNING id`
  );
  const cVespertino = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Vespertino', '16:00:00', 'NONE', TRUE)
     RETURNING id`
  );
  const cNocturno = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Nocturno', '22:00:00', 'NONE', TRUE)
     RETURNING id`
  );

  const clusterAyunasId = cAyunas.rows[0].id;
  const clusterMatutinoId = cMatutino.rows[0].id;
  const clusterVespertinoId = cVespertino.rows[0].id;
  const clusterNocturnoId = cNocturno.rows[0].id;

  // 2. Insertar catalogo inicial de medicamentos
  // Levotiroxina con stock critico <= 7 dias para demostrar alerta automatica
  const medLevotiroxina = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, dose_amount, current_stock,
      frequency_type, frequency_value, tolerance_window_mins, intake_rule,
      daily_consumption_rate, clinical_notes
    ) VALUES (
      'Levotiroxina 50mcg', 'Levotiroxina sodica', 'Tableta', 1, 5,
      'DAILY_SLOTS', 1, 30, 'FASTING',
      1.0000, 'Administrar estrictamente en ayunas 45 a 60 minutos antes del desayuno.'
    ) RETURNING id`
  );

  const medMetotrexato = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, dose_amount, current_stock,
      frequency_type, frequency_value, tolerance_window_mins, intake_rule,
      daily_consumption_rate, clinical_notes
    ) VALUES (
      'Metotrexato 2.5mg', 'Metotrexato', 'Tableta', 2, 48,
      'DAILY_SLOTS', 1, 30, 'WITH_FOOD',
      2.0000, 'Tomar con alimentos matutinos para proteccion gastrica.'
    ) RETURNING id`
  );

  const medAcidoFolico = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, dose_amount, current_stock,
      frequency_type, frequency_value, tolerance_window_mins, intake_rule,
      daily_consumption_rate, clinical_notes
    ) VALUES (
      'Acido Folico 5mg', 'Acido Folico', 'Tableta', 1, 6,
      'DAILY_SLOTS', 1, 30, 'NONE',
      1.0000, 'Suplemento coadyuvante. Stock bajo requiere reposicion esta semana.'
    ) RETURNING id`
  );

  const medLosartan = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, dose_amount, current_stock,
      frequency_type, frequency_value, tolerance_window_mins, intake_rule,
      daily_consumption_rate, clinical_notes
    ) VALUES (
      'Losartan 50mg', 'Losartan potasico', 'Tableta', 1, 60,
      'FIXED_HOURS', 8, 30, 'NONE',
      3.0000, 'Serie cada 8h desplazada simetricamente a 08:00, 16:00 y 22:00/00:00.'
    ) RETURNING id`
  );

  const medAdalimumab = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, dose_amount, current_stock,
      frequency_type, frequency_value, tolerance_window_mins, intake_rule,
      daily_consumption_rate, clinical_notes
    ) VALUES (
      'Adalimumab 40mg', 'Adalimumab', 'Jeringa Prellenada', 1, 2,
      'INTERVAL_WEEKS', 3, 60, 'NONE',
      0.0476, 'Biologico subcutaneo cada 21 dias. Mantener refrigerado entre 2 y 8 grados.'
    ) RETURNING id`
  );

  const levoId = medLevotiroxina.rows[0].id;
  const mtxId = medMetotrexato.rows[0].id;
  const folicoId = medAcidoFolico.rows[0].id;
  const losartanId = medLosartan.rows[0].id;
  const adaId = medAdalimumab.rows[0].id;

  // 3. Programacion vinculada a Clusters
  const sLevo = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '07:00:00', '07:00:00') RETURNING id`,
    [levoId, clusterAyunasId]
  );
  const sMtx = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [mtxId, clusterMatutinoId]
  );
  const sFolico = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:15:00', '08:00:00') RETURNING id`,
    [folicoId, clusterMatutinoId]
  );
  const sLos1 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '07:45:00', '08:00:00') RETURNING id`,
    [losartanId, clusterMatutinoId]
  );
  const sLos2 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '15:45:00', '16:00:00') RETURNING id`,
    [losartanId, clusterVespertinoId]
  );
  const sLos3 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '22:15:00', '22:00:00') RETURNING id`,
    [losartanId, clusterNocturnoId]
  );

  // 4. Tomas del dia actual
  const todayStr = new Date().toISOString().slice(0, 10);

  await db.query(
    `INSERT INTO intake_logs (medication_id, schedule_id, cluster_id, scheduled_for, status, quantity_deducted)
     VALUES
     ($1, $2, $3, ($4 || ' 07:00:00+00')::timestamptz, 'PENDING', 1),
     ($5, $6, $7, ($4 || ' 08:00:00+00')::timestamptz, 'PENDING', 2),
     ($8, $9, $7, ($4 || ' 08:00:00+00')::timestamptz, 'PENDING', 1),
     ($10, $11, $7, ($4 || ' 08:00:00+00')::timestamptz, 'PENDING', 1),
     ($10, $12, $13, ($4 || ' 16:00:00+00')::timestamptz, 'PENDING', 1),
     ($10, $14, $15, ($4 || ' 22:00:00+00')::timestamptz, 'PENDING', 1)`,
    [
      levoId,
      sLevo.rows[0].id,
      clusterAyunasId,
      todayStr,
      mtxId,
      sMtx.rows[0].id,
      clusterMatutinoId,
      folicoId,
      sFolico.rows[0].id,
      losartanId,
      sLos1.rows[0].id,
      sLos2.rows[0].id,
      clusterVespertinoId,
      sLos3.rows[0].id,
      clusterNocturnoId,
    ]
  );

  // Alertas iniciales en cola para los bloques del dia y alertas de restock critico para los <= 7 dias
  await db.query(
    `INSERT INTO notification_queue (
      source_type, source_id, stage, trigger_at, status, title, message, callback_action_payload, idempotency_key
    ) VALUES
    (
      'MEDICATION_INTAKE', $1::uuid, 'EXACT_TIME', NOW(), 'SENT',
      '[BLOQUE DE MEDICACION - 07:00]',
      $2,
      $3,
      $4
    ),
    (
      'MEDICATION_INTAKE', $5::uuid, 'EXACT_TIME', NOW(), 'QUEUED',
      '[BLOQUE DE MEDICACION - 08:00]',
      $6,
      $7,
      $8
    ),
    (
      'RESTOCK_ALERT', $9::uuid, 'LOW_STOCK_7D', NOW(), 'QUEUED',
      '[ALERTA DE RESTOCK CRITICO] Levotiroxina 50mcg',
      'Inventario actual: 5.00 (Tableta). Cobertura estimada: 5.00 dias. Se requiere reabastecimiento inmediato.',
      $10,
      $11
    ),
    (
      'RESTOCK_ALERT', $12::uuid, 'LOW_STOCK_7D', NOW(), 'QUEUED',
      '[ALERTA DE RESTOCK CRITICO] Acido Folico 5mg',
      'Inventario actual: 6.00 (Tableta). Cobertura estimada: 6.00 dias. Se requiere reabastecimiento inmediato.',
      $13,
      $14
    )
    ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      clusterAyunasId,
      formatClusterMessageHtml(
        "BLOQUE MATUTINO AYUNAS",
        "07:00",
        [
          {
            name: "Levotiroxina 50mcg",
            dose: "1 Tableta",
            ruleLabel: "En Ayunas",
          },
        ],
        "PENDIENTE DE CONFIRMACION"
      ),
      `ack_cluster:${clusterAyunasId}:${todayStr}`,
      `CLUSTER_${clusterAyunasId}_${todayStr}`,
      clusterMatutinoId,
      formatClusterMessageHtml(
        "BLOQUE MATUTINO ALIMENTOS",
        "08:00",
        [
          {
            name: "Metotrexato 2.5mg",
            dose: "2 Tabletas",
            ruleLabel: "Con Alimentos",
          },
          {
            name: "Acido Folico 5mg",
            dose: "1 Tableta",
            ruleLabel: "Sin Restriccion",
          },
          {
            name: "Losartan 50mg",
            dose: "1 Tableta",
            ruleLabel: "Sin Restriccion",
          },
        ],
        "PENDIENTE DE CONFIRMACION"
      ),
      `ack_cluster:${clusterMatutinoId}:${todayStr}`,
      `CLUSTER_${clusterMatutinoId}_${todayStr}`,
      levoId,
      `ack_restock:${levoId}`,
      `RESTOCK_${levoId}_${todayStr}`,
      folicoId,
      `ack_restock:${folicoId}`,
      `RESTOCK_${folicoId}_${todayStr}`,
    ]
  );

  // 5. Eventos clinicos unicos y recurrentes con cascada -7d, -3d, -1d, 0d
  const evtReuma = await db.query<{
    id: string;
    title: string;
    preparation_instructions: string;
    event_datetime: string;
  }>(
    `INSERT INTO clinical_events (
      title, category, specialist_or_center, location_address, event_datetime,
      is_recurring, recurrence_interval_days, medication_id, preparation_instructions
    ) VALUES (
      'Cita de Control con Reumatologia', 'APPOINTMENT',
      'Dra. Elena Vargas - Reumatologia Clinica',
      'Hospital Angeles Pedregal, Torre de Especialidades Cons. 412',
      NOW() + INTERVAL '5 days',
      FALSE, NULL, NULL,
      'Presentar biometria hematica completa, perfil hepatico y bitacora de adherencia farmacologica.'
    ) RETURNING id, title, preparation_instructions, event_datetime`
  );

  await db.query(
    `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4)`,
    [
      evtReuma.rows[0].id,
      evtReuma.rows[0].title,
      evtReuma.rows[0].preparation_instructions,
      evtReuma.rows[0].event_datetime,
    ]
  );

  const evtInyeccion = await db.query<{
    id: string;
    title: string;
    preparation_instructions: string;
    event_datetime: string;
  }>(
    `INSERT INTO clinical_events (
      title, category, specialist_or_center, location_address, event_datetime,
      is_recurring, recurrence_interval_days, medication_id, preparation_instructions
    ) VALUES (
      'Inyeccion Biologica Subcutanea Cada 3 Semanas', 'INJECTION',
      'Enfermeria Domiciliaria / Aplicacion Supervisada',
      'Domicilio del Paciente',
      NOW() + INTERVAL '2 days',
      TRUE, 21, $1,
      'Retirar jeringa prellenada de Adalimumab 40mg del refrigerador 30 minutos antes. Rotar zona abdominal.'
    ) RETURNING id, title, preparation_instructions, event_datetime`,
    [adaId]
  );

  await db.query(
    `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4)`,
    [
      evtInyeccion.rows[0].id,
      evtInyeccion.rows[0].title,
      evtInyeccion.rows[0].preparation_instructions,
      evtInyeccion.rows[0].event_datetime,
    ]
  );

  const evtLab = await db.query<{
    id: string;
    title: string;
    preparation_instructions: string;
    event_datetime: string;
  }>(
    `INSERT INTO clinical_events (
      title, category, specialist_or_center, location_address, event_datetime,
      is_recurring, recurrence_interval_days, medication_id, preparation_instructions
    ) VALUES (
      'Estudio de Perfil Hepatico, PCR y VSG', 'LAB_TEST',
      'Laboratorio Medico Polanco - Sucursal Sur',
      'Av. Revolucion 1840, Piso 1',
      NOW() + INTERVAL '9 days',
      FALSE, NULL, NULL,
      'Ayuno estricto de 8 a 10 horas. Tomar Levotiroxina despues de la extraccion sanguinea.'
    ) RETURNING id, title, preparation_instructions, event_datetime`
  );

  await db.query(
    `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4)`,
    [
      evtLab.rows[0].id,
      evtLab.rows[0].title,
      evtLab.rows[0].preparation_instructions,
      evtLab.rows[0].event_datetime,
    ]
  );

  // 6. Temas de seguimiento y bitacora estructurada
  const topicTerapeuta = await db.query<{
    id: string;
    title: string;
    description: string;
    deadline_at: string;
  }>(
    `INSERT INTO follow_up_topics (
      title, description, status, priority, progress_percentage, deadline_at
    ) VALUES (
      'Encontrar Terapeuta Fisico a Domicilio',
      'Seleccionar especialista en rehabilitacion geriatrica y articular con disponibilidad martes y jueves por la manana.',
      'IN_PROGRESS', 1, 45, NOW() + INTERVAL '6 days'
    ) RETURNING id, title, description, deadline_at`
  );

  await db.query(
    `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1, $2, $3, $4)`,
    [
      topicTerapeuta.rows[0].id,
      topicTerapeuta.rows[0].title,
      topicTerapeuta.rows[0].description,
      topicTerapeuta.rows[0].deadline_at,
    ]
  );

  await db.query(
    `INSERT INTO topic_annotations (
      topic_id, author, note_type, contact_name, contact_phone, estimated_cost, content
    ) VALUES
    (
      $1, 'Cuidador Principal', 'PROPOSAL',
      'Lic. Carlos Mendoza - Centro Kinesis', '+52 55 4120 8891', 850.00,
      'Primera propuesta recibida. Cuenta con cedula en fisioterapia ortopedica. Tarifa por sesion de 60 minutos a domicilio.'
    ),
    (
      $1, 'Familiar', 'QUOTE',
      'Dra. Sofia Navarro - Rehabilitacion Integral', '+52 55 3901 4420', 780.00,
      'Paquete mensual de 8 sesiones con descuento del 10%. Disponible desde la proxima semana a las 10:00 hrs.'
    )`,
    [topicTerapeuta.rows[0].id]
  );

  const topicSeguro = await db.query<{
    id: string;
    title: string;
    description: string;
    deadline_at: string;
  }>(
    `INSERT INTO follow_up_topics (
      title, description, status, priority, progress_percentage, deadline_at
    ) VALUES (
      'Tramitar Reembolso de Medicamento Biologico en Aseguradora',
      'Enviar informe medico actualizado y facturas CFDI de farmacia especializada para renovacion de carta pase.',
      'WAITING_RESPONSE', 2, 65, NOW() + INTERVAL '11 days'
    ) RETURNING id, title, description, deadline_at`
  );

  await db.query(
    `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1, $2, $3, $4)`,
    [
      topicSeguro.rows[0].id,
      topicSeguro.rows[0].title,
      topicSeguro.rows[0].description,
      topicSeguro.rows[0].deadline_at,
    ]
  );

  await db.query(
    `INSERT INTO topic_annotations (
      topic_id, author, note_type, contact_name, contact_phone, estimated_cost, content
    ) VALUES
    (
      $1, 'Cuidador Principal', 'UPDATE',
      'Lic. Laura Montes - Agente GMM', '+52 55 8820 1104', 18400.00,
      'Folio de tramite GMM-2026-8419 ingresado. Tiempo de respuesta estimado de dictamen medico: 5 dias habiles.'
    )`,
    [topicSeguro.rows[0].id]
  );

  // 7. Destinatarios autorizados de Telegram
  await db.query(
    `INSERT INTO telegram_recipients (
      full_name, role, telegram_chat_id,
      receive_med_reminders, receive_restock_alerts, receive_event_reminders, receive_topic_reminders, is_active
    ) VALUES
    ('Paciente (Titular)', 'PATIENT', '100100001', TRUE, FALSE, TRUE, FALSE, TRUE),
    ('Cuidador Principal', 'PRIMARY_CAREGIVER', '100100002', TRUE, TRUE, TRUE, TRUE, TRUE),
    ('Familiar de Apoyo', 'FAMILY_MEMBER', '100100003', FALSE, TRUE, TRUE, TRUE, TRUE)`
  );
}
