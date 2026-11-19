import type { DbExecutor } from "./client";
import { ensureDefaultAuthUsers } from "../auth/seed-users";
import { getClinicalDateParts } from "../utils";

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
  await ensureDefaultAuthUsers(db);

  await db.query(
    `INSERT INTO alert_monitoring_settings (
       id, timezone, missed_block_grace_mins, missed_block_alerts_enabled,
       weekly_report_enabled, weekly_report_day, weekly_report_hour, notify_admin_on_patient_change
     ) VALUES (1, 'America/Mexico_City', 60, TRUE, TRUE, 0, 20, TRUE)
     ON CONFLICT (id) DO NOTHING`
  );

  const existingClusters = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM intake_clusters"
  );
  if (Number(existingClusters.rows[0]?.count ?? "0") > 0) {
    return;
  }

  // 1. Insertar los 3 bloques horarios reales del esquema clinico (Desayuno 08:00, Vespertino 15:00, Cena 21:00)
  const cDesayuno = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Desayuno', '08:00:00', 'WITH_FOOD', TRUE)
     RETURNING id`
  );
  const cVespertino = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Vespertino', '15:00:00', 'NONE', TRUE)
     RETURNING id`
  );
  const cCena = await db.query<{ id: string }>(
    `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
     VALUES ('Bloque Cena / Noche', '21:00:00', 'WITH_FOOD', TRUE)
     RETURNING id`
  );

  const clusterDesayunoId = cDesayuno.rows[0].id;
  const clusterVespertinoId = cVespertino.rows[0].id;
  const clusterCenaId = cCena.rows[0].id;

  // 2. Insertar catalogo real de 7 medicamentos del esquema del paciente
  const medLeflunomida = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Leflunomida 20 mg', 'Leflunomida', 'Tableta', 30, 250.00,
      1, 90, 'DAILY_SLOTS', 1,
      30, 'WITH_FOOD', '[1,2,3,4,5]'::jsonb, 0.7143,
      1, 7, '1 tableta en el desayuno de Lunes a Viernes (descansa sabado y domingo). Caja de 30 tabletas ($250 MXN).'
    ) RETURNING id`
  );

  const medOmega3 = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Omega 3', 'Acidos grasos Omega-3 (EPA/DHA)', 'Tableta', 60, 350.00,
      2, 54, 'DAILY_SLOTS', 1,
      30, 'WITH_FOOD', NULL, 2.0000,
      3, 7, '2 tabletas en el desayuno todos los dias. Frasco de 60 tabletas ($350 MXN).'
    ) RETURNING id`
  );

  const medRolet = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Rolet Sup 80/12.5', 'Telmisartan 80 mg / Hidroclorotiazida 12.5 mg', 'Tableta', NULL, NULL,
      1, NULL, 'DAILY_SLOTS', 1,
      30, 'WITH_FOOD', NULL, 1.0000,
      1, 7, 'Medicamento nuevo en adquisicion. Pendiente capturar precio por caja, piezas por envase e inventario inicial.'
    ) RETURNING id`
  );

  const medValproato = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Valproato semisodico 500 mg', 'Valproato semisodico', 'Tableta', 30, 330.00,
      1, 51, 'DAILY_SLOTS', 3,
      30, 'NONE', NULL, 3.0000,
      1, 7, '1 tableta en desayuno (08:00), 1 tableta a las 15:00 y 1 tableta en cena (21:00) — horario aprobado por medico. Caja de 30 tabletas ($330 MXN).'
    ) RETURNING id`
  );

  const medQuetiapina = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Quetiapina 100 mg', 'Quetiapina fumarato', 'Tableta', 60, 517.00,
      3, 102, 'DAILY_SLOTS', 2,
      30, 'WITH_FOOD', NULL, 6.0000,
      1, 7, '3 tabletas en el desayuno y 3 tabletas en la cena (6/dia; 1 caja de 60 rinde 10 dias, $517 MXN).'
    ) RETURNING id`
  );

  const medAmlodipino = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Amlodipino 5 mg', 'Amlodipino besilato', 'Tableta', 100, 170.00,
      1, 100, 'DAILY_SLOTS', 1,
      30, 'NONE', NULL, 1.0000,
      1, 7, '1 tableta en la noche. Caja de 100 tabletas ($170 MXN).'
    ) RETURNING id`
  );

  const medFluanxol = await db.query<{ id: string }>(
    `INSERT INTO medications (
      name, active_ingredient, presentation, units_per_package, package_price,
      dose_amount, current_stock, frequency_type, frequency_value,
      tolerance_window_mins, intake_rule, active_days, daily_consumption_rate,
      purchase_priority, safety_buffer_days, clinical_notes
    ) VALUES (
      'Fluanxol 20 mg', 'Flupentixol decanoato', 'Inyeccion', 1, 1370.00,
      1, 2, 'INTERVAL_WEEKS', 3,
      60, 'NONE', NULL, 0.0476,
      1, 10, '1 inyeccion cada 21 dias ($1,370 MXN por pieza). Vinculada a evento clinico recurrente (fecha oficial 27 nov 2026).'
    ) RETURNING id`
  );

  const lefluId = medLeflunomida.rows[0].id;
  const omegaId = medOmega3.rows[0].id;
  const roletId = medRolet.rows[0].id;
  const valproatoId = medValproato.rows[0].id;
  const quetiapinaId = medQuetiapina.rows[0].id;
  const amlodipinoId = medAmlodipino.rows[0].id;
  const fluanxolId = medFluanxol.rows[0].id;

  // 3. Programacion vinculada a los 3 Clusters Horarios (Desayuno 08:00, Vespertino 15:00, Cena 21:00)
  const sLeflu = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [lefluId, clusterDesayunoId]
  );
  const sOmega = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [omegaId, clusterDesayunoId]
  );
  const sRolet = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [roletId, clusterDesayunoId]
  );
  const sValp1 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [valproatoId, clusterDesayunoId]
  );
  const sValp2 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '15:00:00', '15:00:00') RETURNING id`,
    [valproatoId, clusterVespertinoId]
  );
  const sValp3 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '21:00:00', '21:00:00') RETURNING id`,
    [valproatoId, clusterCenaId]
  );
  const sQuet1 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '08:00:00', '08:00:00') RETURNING id`,
    [quetiapinaId, clusterDesayunoId]
  );
  const sQuet2 = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '21:00:00', '21:00:00') RETURNING id`,
    [quetiapinaId, clusterCenaId]
  );
  const sAmlo = await db.query<{ id: string }>(
    `INSERT INTO medication_schedules (medication_id, cluster_id, ideal_time, effective_clustered_time)
     VALUES ($1, $2, '21:00:00', '21:00:00') RETURNING id`,
    [amlodipinoId, clusterCenaId]
  );

  // 4. Tomas del dia actual (respetando dias activos Lunes-Viernes de Leflunomida en horario America/Mexico_City)
  const { dateStr: todayStr, dayOfWeek } = getClinicalDateParts("America/Mexico_City");
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  if (isWeekday) {
    await db.query(
      `INSERT INTO intake_logs (medication_id, schedule_id, cluster_id, scheduled_for, status, quantity_deducted)
       VALUES ($1, $2, $3, (($4 || ' 08:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1)`,
      [lefluId, sLeflu.rows[0].id, clusterDesayunoId, todayStr]
    );
  }

  await db.query(
    `INSERT INTO intake_logs (medication_id, schedule_id, cluster_id, scheduled_for, status, quantity_deducted)
     VALUES
     ($1, $2, $3, (($15 || ' 08:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 2),
     ($4, $5, $3, (($15 || ' 08:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1),
     ($6, $7, $3, (($15 || ' 08:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1),
     ($8, $9, $3, (($15 || ' 08:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 3),
     ($6, $10, $11, (($15 || ' 15:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1),
     ($8, $12, $13, (($15 || ' 21:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 3),
     ($6, $14, $13, (($15 || ' 21:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1),
     ($16, $17, $13, (($15 || ' 21:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'PENDING', 1)`,
    [
      omegaId,
      sOmega.rows[0].id,
      clusterDesayunoId,
      roletId,
      sRolet.rows[0].id,
      valproatoId,
      sValp1.rows[0].id,
      quetiapinaId,
      sQuet1.rows[0].id,
      sValp2.rows[0].id,
      clusterVespertinoId,
      sQuet2.rows[0].id,
      clusterCenaId,
      sValp3.rows[0].id,
      todayStr,
      amlodipinoId,
      sAmlo.rows[0].id,
    ]
  );

  const desayunoItems = [
    ...(isWeekday
      ? [{ name: "Leflunomida 20 mg", dose: "1 Tableta", ruleLabel: "Con Alimentos" }]
      : []),
    { name: "Omega 3", dose: "2 Tableta", ruleLabel: "Con Alimentos" },
    { name: "Quetiapina 100 mg", dose: "3 Tableta", ruleLabel: "Con Alimentos" },
    { name: "Rolet Sup 80/12.5", dose: "1 Tableta", ruleLabel: "Con Alimentos" },
    { name: "Valproato semisodico 500 mg", dose: "1 Tableta", ruleLabel: "Sin Restriccion" },
  ];

  await db.query(
    `INSERT INTO notification_queue (
      source_type, source_id, stage, trigger_at, status, title, message, callback_action_payload, idempotency_key
    ) VALUES
    (
      'MEDICATION_INTAKE', $1::uuid, 'EXACT_TIME', NOW(), 'QUEUED',
      '[BLOQUE DE MEDICACION - 08:00] Bloque Desayuno',
      $2,
      $3,
      $4
    ),
    (
      'MEDICATION_INTAKE', $5::uuid, 'EXACT_TIME', (($6 || ' 15:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'QUEUED',
      '[BLOQUE DE MEDICACION - 15:00] Bloque Vespertino',
      $7,
      $8,
      $9
    ),
    (
      'MEDICATION_INTAKE', $10::uuid, 'EXACT_TIME', (($6 || ' 21:00:00')::timestamp AT TIME ZONE 'America/Mexico_City'), 'QUEUED',
      '[BLOQUE DE MEDICACION - 21:00] Bloque Cena / Noche',
      $11,
      $12,
      $13
    )
    ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      clusterDesayunoId,
      formatClusterMessageHtml(
        "BLOQUE DESAYUNO",
        "08:00",
        desayunoItems,
        "PENDIENTE DE CONFIRMACION"
      ),
      `ack_cluster:${clusterDesayunoId}:${todayStr}`,
      `CLUSTER_${clusterDesayunoId}_${todayStr}`,
      clusterVespertinoId,
      todayStr,
      formatClusterMessageHtml(
        "BLOQUE VESPERTINO",
        "15:00",
        [{ name: "Valproato semisodico 500 mg", dose: "1 Tableta", ruleLabel: "Sin Restriccion" }],
        "PENDIENTE DE CONFIRMACION"
      ),
      `ack_cluster:${clusterVespertinoId}:${todayStr}`,
      `CLUSTER_${clusterVespertinoId}_${todayStr}`,
      clusterCenaId,
      formatClusterMessageHtml(
        "BLOQUE CENA / NOCHE",
        "21:00",
        [
          { name: "Amlodipino 5 mg", dose: "1 Tableta", ruleLabel: "Sin Restriccion" },
          { name: "Quetiapina 100 mg", dose: "3 Tableta", ruleLabel: "Con Alimentos" },
          { name: "Valproato semisodico 500 mg", dose: "1 Tableta", ruleLabel: "Sin Restriccion" },
        ],
        "PENDIENTE DE CONFIRMACION"
      ),
      `ack_cluster:${clusterCenaId}:${todayStr}`,
      `CLUSTER_${clusterCenaId}_${todayStr}`,
    ]
  );

  // 5. Eventos clinicos (inyeccion Fluanxol con fecha oficial 27 nov 2026 + 5 consultas/estudios)
  const eventsData: Array<{
    title: string;
    category: string;
    specialist: string;
    location: string;
    datetimeExpr: string;
    isRecurring: boolean;
    intervalDays: number | null;
    medId: string | null;
    prep: string;
    estimatedCost: number;
    periodicityLabel: string;
    dateEstimated: boolean;
  }> = [
    {
      title: "Aplicacion de Inyeccion Fluanxol 20 mg",
      category: "INJECTION",
      specialist: "Aplicacion Intramuscular Supervisada",
      location: "Domicilio / Clinica Local",
      datetimeExpr: "'2026-11-27 16:00:00+00'::timestamptz",
      isRecurring: true,
      intervalDays: 21,
      medId: fluanxolId,
      prep: "Fecha oficial confirmada (27 nov 2026). Inyeccion de deposito cada 21 dias; verificar ampolleta en inventario ($1,370 MXN en compras).",
      estimatedCost: 0,
      periodicityLabel: "Cada 21 dias",
      dateEstimated: false,
    },
    {
      title: "Consulta Psiquiatria Comalcalco",
      category: "APPOINTMENT",
      specialist: "Psiquiatria Comalcalco",
      location: "Comalcalco, Tabasco",
      datetimeExpr: "'2026-12-15 16:00:00+00'::timestamptz",
      isRecurring: true,
      intervalDays: 60,
      medId: null,
      prep: "Llevar control de adherencia a Fluanxol 20 mg, Quetiapina 100 mg y Valproato 500 mg.",
      estimatedCost: 1000,
      periodicityLabel: "Cada 2 meses",
      dateEstimated: true,
    },
    {
      title: "Analisis Clinicos de Control",
      category: "LAB_TEST",
      specialist: "Laboratorio Clinico",
      location: "Por confirmar sucursal",
      datetimeExpr: "'2027-01-15 14:00:00+00'::timestamptz",
      isRecurring: true,
      intervalDays: 105,
      medId: null,
      prep: "Ayuno estricto de 8 a 10 horas previo a la extraccion sanguinea.",
      estimatedCost: 600,
      periodicityLabel: "Cada 3 o 4 meses",
      dateEstimated: true,
    },
    {
      title: "Ultrasonido de Seguimiento",
      category: "LAB_TEST",
      specialist: "Gabinete de Imagenologia",
      location: "Por confirmar centro",
      datetimeExpr: "'2027-01-15 16:30:00+00'::timestamptz",
      isRecurring: false,
      intervalDays: null,
      medId: null,
      prep: "Confirmar indicacion previa de ayuno o ingesta de agua segun estudio.",
      estimatedCost: 1000,
      periodicityLabel: "Indeterminada",
      dateEstimated: true,
    },
    {
      title: "Consulta de Reumatologia",
      category: "APPOINTMENT",
      specialist: "Especialista en Reumatologia",
      location: "Por confirmar consultorio",
      datetimeExpr: "'2027-01-15 22:00:00+00'::timestamptz",
      isRecurring: true,
      intervalDays: 105,
      medId: null,
      prep: "Presentar resultados de analisis clinicos y ultrasonido de control.",
      estimatedCost: 1500,
      periodicityLabel: "Cada 3 o 4 meses",
      dateEstimated: true,
    },
    {
      title: "Radiografias Anuales de Control",
      category: "LAB_TEST",
      specialist: "Gabinete de Radiologia",
      location: "Por confirmar centro",
      datetimeExpr: "'2027-05-15 16:00:00+00'::timestamptz",
      isRecurring: true,
      intervalDays: 365,
      medId: null,
      prep: "Llevar placas o estudios radiograficos anteriores para comparacion.",
      estimatedCost: 1500,
      periodicityLabel: "Cada 12 meses",
      dateEstimated: true,
    },
  ];

  for (const evt of eventsData) {
    const inserted = await db.query<{
      id: string;
      title: string;
      preparation_instructions: string;
      event_datetime: string;
    }>(
      `INSERT INTO clinical_events (
        title, category, specialist_or_center, location_address, event_datetime,
        is_recurring, recurrence_interval_days, medication_id, preparation_instructions,
        estimated_cost, periodicity_label, date_is_estimated
      ) VALUES (
        $1, $2::event_category, $3, $4, ${evt.datetimeExpr},
        $5, $6, $7, $8,
        $9, $10, $11
      ) RETURNING id, title, preparation_instructions, event_datetime`,
      [
        evt.title,
        evt.category,
        evt.specialist,
        evt.location,
        evt.isRecurring,
        evt.intervalDays,
        evt.medId,
        evt.prep,
        evt.estimatedCost,
        evt.periodicityLabel,
        evt.dateEstimated,
      ]
    );
    const row = inserted.rows[0];
    await db.query(
      `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
      [row.id, row.title, row.preparation_instructions, row.event_datetime]
    );
  }

  // 6. Temas de seguimiento
  const topicRolet = await db.query<{
    id: string;
    title: string;
    description: string;
    deadline_at: string;
  }>(
    `INSERT INTO follow_up_topics (
      title, description, status, priority, progress_percentage, estimated_budget, deadline_at
    ) VALUES (
      'Completar precio e inventario inicial de Rolet Sup 80/12.5',
      'Al obtener el medicamento, registrar precio por caja, cantidad de tabletas por envase e inventario inicial para integrarlo al plan quincenal.',
      'IN_PROGRESS', 1, 25, NULL, NOW() + INTERVAL '2 days'
    ) RETURNING id, title, description, deadline_at`
  );
  await db.query(
    `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1::uuid, $2, $3, $4::timestamptz)`,
    [
      topicRolet.rows[0].id,
      topicRolet.rows[0].title,
      topicRolet.rows[0].description,
      topicRolet.rows[0].deadline_at,
    ]
  );
  await db.query(
    `INSERT INTO topic_annotations (topic_id, author, note_type, content)
     VALUES ($1, 'Sistema Clinico', 'UPDATE', 'Medicamento dado de alta en bloque de desayuno (1 tableta diaria) con precio e inventario marcados como pendientes.')`,
    [topicRolet.rows[0].id]
  );

  const valoraciones = [
    {
      title: "Valorar Consulta Psiquiatria CDMX",
      desc: "Evaluar viabilidad, costo de traslado y segunda opinion psiquiatrica en CDMX ($3,000 MXN c/u).",
      budget: 3000,
      days: 14,
      quoteNote: "Costo de referencia por consulta: $3,000.00 MXN c/u. Pendiente decidir especialista y fecha.",
    },
    {
      title: "Valorar Consultas Psicologicas",
      desc: "Definir especialista, frecuencia de sesiones y presupuesto para acompanamiento psicologico ($900 MXN c/u).",
      budget: 900,
      days: 14,
      quoteNote: "Costo de referencia por sesion: $900.00 MXN c/u. Evaluar modalidad presencial o en linea.",
    },
    {
      title: "Valorar Consultas para Atencion de Manos",
      desc: "Valorar especialista para atencion articular/rehabilitacion de manos ($600 MXN c/u).",
      budget: 600,
      days: 21,
      quoteNote: "Costo de referencia por consulta: $600.00 MXN c/u. Pendiente cotizar opciones locales.",
    },
  ];

  for (const val of valoraciones) {
    const tRes = await db.query<{
      id: string;
      title: string;
      description: string;
      deadline_at: string;
    }>(
      `INSERT INTO follow_up_topics (
        title, description, status, priority, progress_percentage, estimated_budget, deadline_at
      ) VALUES (
        $1, $2, 'PENDING', 2, 10, $3, NOW() + make_interval(days => $4::integer)
      ) RETURNING id, title, description, deadline_at`,
      [val.title, val.desc, val.budget, val.days]
    );
    const tRow = tRes.rows[0];
    await db.query(
      `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1::uuid, $2, $3, $4::timestamptz)`,
      [tRow.id, tRow.title, tRow.description, tRow.deadline_at]
    );
    await db.query(
      `INSERT INTO topic_annotations (topic_id, author, note_type, estimated_cost, content)
       VALUES ($1, 'Cuidador Principal', 'QUOTE', $2, $3)`,
      [tRow.id, val.budget, val.quoteNote]
    );
  }

  // 7. Configuracion Financiera Quincenal (Dias 15 y 30 / ultimo dia de mes)
  await db.query(
    `INSERT INTO financial_settings (
      id, currency, pay_schedule_type, payday_1, payday_2,
      safety_buffer_days, planning_horizon_quincenas, include_events_in_plan
    ) VALUES (
      1, 'MXN', 'QUINCENAL_15_30', 15, 30, 7, 6, TRUE
    ) ON CONFLICT (id) DO NOTHING`
  );

  // 8. Perfil Clinico Base y Directorio Medico Inicial
  await db.query(
    `INSERT INTO patient_profile (
      id, full_name, chronic_conditions, general_notes
    ) VALUES (
      1,
      'Papa (Paciente Titular)',
      'Seguimiento reumatologico, psiquiatrico y control de hipertension arterial.',
      'Ficha clinica lista para completar alergias, tipo de sangre, poliza y contacto de emergencia.'
    ) ON CONFLICT (id) DO NOTHING`
  );

  await db.query(
    `INSERT INTO care_providers (name, specialty, city, consultation_fee, notes)
     VALUES
     ('Psiquiatria Comalcalco', 'Psiquiatria', 'Comalcalco, Tabasco', 1000.00, 'Seguimiento cada 2 meses. Proxima fecha estimada: 15 dic 2026.'),
     ('Especialista en Reumatologia', 'Reumatologia', 'Por confirmar', 1500.00, 'Control cada 3 o 4 meses. Proxima fecha estimada: 15 ene 2027.'),
     ('Laboratorio de Analisis Clinicos', 'Laboratorio Clinico', 'Local', 600.00, 'Panel de control cada 3 o 4 meses.'),
     ('Gabinete de Imagenologia (US / RX)', 'Imagenologia y Radiologia', 'Local', 1000.00, 'Ultrasonido ($1,000) y Radiografias anuales ($1,500).'),
     ('Psiquiatria CDMX (Por valorar)', 'Psiquiatria', 'CDMX', 3000.00, 'Opcion en valoracion ($3,000 c/u).'),
     ('Atencion Psicologica (Por valorar)', 'Psicologia', 'Por definir', 900.00, 'Consultas psicologicas en valoracion ($900 c/u).'),
     ('Atencion Especializada de Manos (Por valorar)', 'Rehabilitacion / Manos', 'Por definir', 600.00, 'Consultas para atencion de manos en valoracion ($600 c/u).')`
  );

  // 9. Destinatarios plantilla de Telegram (separacion clara Paciente vs Administrador)
  const existingRecipients = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM telegram_recipients"
  );
  if (Number(existingRecipients.rows[0]?.count ?? "0") === 0) {
    await db.query(
      `INSERT INTO telegram_recipients (
        full_name, role, telegram_chat_id,
        receive_med_reminders, receive_restock_alerts, receive_event_reminders, receive_topic_reminders,
        receive_missed_block_alerts, receive_weekly_report, receive_change_alerts, is_active
      ) VALUES
      ('Paciente (Titular)', 'PATIENT', '100100001', TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE),
      ('Cuidador Principal (Admin)', 'ADMIN', '100100002', FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
      ('Familiar Responsable (Admin)', 'ADMIN', '100100003', FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)`
    );
  }

  // 10. Registro inicial de auditoria
  await db.query(
    `INSERT INTO governance_audit_logs (
      entity_type, entity_id, entity_label, action, actor, summary
    ) VALUES (
      'SYSTEM', 'SEED', 'Catalogo Clinico Real', 'CREATE', 'Sistema',
      'Carga inicial del esquema real (Valproato 08/15/21h, Leflunomida Lun-Vie, Fluanxol oficial 27 nov 2026) y control RBAC/versiones.'
    )`
  );
}
