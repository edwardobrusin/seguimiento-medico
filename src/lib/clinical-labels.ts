import type {
  AlertStage,
  AlertStatus,
  EventCategory,
  ExpenseCategory,
  ExpenseStatus,
  IntakeConstraint,
  IntakeStatus,
  MedFrequencyType,
  NoteType,
  PayScheduleType,
  TaskStatus,
} from "./types/clinical";

export const INTAKE_RULE_LABEL: Record<IntakeConstraint, string> = {
  NONE: "Sin Restriccion",
  FASTING: "En Ayunas",
  WITH_FOOD: "Con Alimentos",
  SEPARATE_FROM_OTHERS: "Separado de Otros",
};

export const INTAKE_RULE_TAG: Record<IntakeConstraint, string> = {
  NONE: "[SIN RESTRICCION]",
  FASTING: "[AYUNAS]",
  WITH_FOOD: "[CON ALIMENTOS]",
  SEPARATE_FROM_OTHERS: "[SEPARADO]",
};

export const INTAKE_STATUS_TAG: Record<IntakeStatus, string> = {
  PENDING: "[PENDIENTE]",
  TAKEN: "[TOMADO]",
  DELAYED: "[POSPUESTO]",
  SKIPPED: "[OMITIDO]",
};

export const FREQUENCY_TYPE_LABEL: Record<MedFrequencyType, string> = {
  FIXED_HOURS: "Cada N horas",
  DAILY_SLOTS: "Tomas por dia",
  INTERVAL_DAYS: "Cada N dias",
  INTERVAL_WEEKS: "Cada N semanas",
};

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  APPOINTMENT: "Cita Medica",
  INJECTION: "Inyeccion",
  LAB_TEST: "Estudio / Laboratorio",
  PROCEDURE: "Procedimiento",
  OTHER: "Otro Evento",
};

export const EVENT_CATEGORY_TAG: Record<EventCategory, string> = {
  APPOINTMENT: "[CITA]",
  INJECTION: "[INYECCION]",
  LAB_TEST: "[ESTUDIO / LAB]",
  PROCEDURE: "[PROCEDIMIENTO]",
  OTHER: "[EVENTO]",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En Curso",
  WAITING_RESPONSE: "Esperando Respuesta",
  COMPLETED: "Completado",
};

export const TASK_STATUS_TAG: Record<TaskStatus, string> = {
  PENDING: "[PENDIENTE]",
  IN_PROGRESS: "[EN CURSO]",
  WAITING_RESPONSE: "[ESPERANDO RESPUESTA]",
  COMPLETED: "[COMPLETADO]",
};

export const PRIORITY_TAG: Record<number, string> = {
  1: "[PRIORIDAD 1 - CRITICA]",
  2: "[PRIORIDAD 2 - ALTA]",
  3: "[PRIORIDAD 3 - NORMAL]",
};

export const NOTE_TYPE_TAG: Record<NoteType, string> = {
  PROPOSAL: "[PROPUESTA]",
  CONTACT: "[CONTACTO]",
  UPDATE: "[ACTUALIZACION]",
  QUOTE: "[COTIZACION]",
};

export const ALERT_STAGE_SHORT: Record<AlertStage, string> = {
  "7_DAYS_BEFORE": "-7D",
  "3_DAYS_BEFORE": "-3D",
  "1_DAY_BEFORE": "-1D",
  DAY_OF: "0D",
  EXACT_TIME: "HORA",
  LOW_STOCK_7D: "<=7D",
};

export const ALERT_STATUS_TAG: Record<AlertStatus, string> = {
  QUEUED: "[EN COLA]",
  SENT: "[ENVIADO]",
  ACKNOWLEDGED: "[CONFIRMADO]",
  SNOOZED: "[POSPUESTO]",
};

export const RECIPIENT_ROLE_TAG: Record<string, string> = {
  PATIENT: "[PACIENTE]",
  ADMIN: "[ADMINISTRADOR]",
  PRIMARY_CAREGIVER: "[CUIDADOR ADMIN]",
  FAMILY_MEMBER: "[FAMILIAR ADMIN]",
  CAREGIVER: "[CUIDADOR ADMIN]",
};

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  MEDICATION: "Medicamento",
  APPOINTMENT: "Consulta Medica",
  LAB_TEST: "Analisis Clinico",
  IMAGING: "Imagenologia (RX / US)",
  PROCEDURE: "Procedimiento",
  THERAPY: "Psicologia / Terapia",
  INSURANCE: "Seguro / Reembolso",
  OTHER: "Otro Gasto Medico",
};

export const EXPENSE_CATEGORY_TAG: Record<ExpenseCategory, string> = {
  MEDICATION: "[MEDICAMENTO]",
  APPOINTMENT: "[CONSULTA]",
  LAB_TEST: "[ANALISIS]",
  IMAGING: "[IMAGEN]",
  PROCEDURE: "[PROCEDIMIENTO]",
  THERAPY: "[TERAPIA]",
  INSURANCE: "[SEGURO]",
  OTHER: "[OTRO]",
};

export const EXPENSE_STATUS_TAG: Record<ExpenseStatus, string> = {
  PAID: "[PAGADO]",
  PLANNED: "[PLANEADO]",
  CANCELLED: "[CANCELADO]",
};

export const PAY_SCHEDULE_LABEL: Record<PayScheduleType, string> = {
  QUINCENAL_15_30: "Quincenal (Dias 15 y 30 / Fin de mes)",
  QUINCENAL_1_15: "Quincenal (Dias 1 y 15)",
  CUSTOM_DAYS: "Quincenal (Dias personalizados)",
  CATORCENAL: "Catorcenal (Cada 14 dias)",
};

export const PURCHASE_PRIORITY_TAG: Record<number, string> = {
  1: "[ESENCIAL / CRITICO]",
  2: "[PRIORIDAD MEDIA]",
  3: "[SUPLEMENTO / FLEXIBLE]",
};

export const AUDIT_ACTION_TAG: Record<string, string> = {
  CREATE: "[ALTA]",
  UPDATE: "[EDICION]",
  ARCHIVE: "[ARCHIVADO]",
  RESTORE: "[RESTAURADO]",
  VERSION_RESTORE: "[VERSION RESTAURADA]",
  DELETE: "[ELIMINADO]",
  RESTOCK: "[RESTOCK]",
  STOCK_ADJUST: "[AJUSTE STOCK]",
  COMPLETE: "[COMPLETADO]",
  REOPEN: "[REABIERTO]",
  PURCHASE_EXECUTED: "[COMPRA REGISTRADA]",
  SETTINGS_UPDATE: "[CONFIG FINANCIERA]",
  PROFILE_UPDATE: "[EXPEDIENTE]",
  CONVERT_EVENT: "[CONVERTIDO A CITA]",
  RETRY: "[REINTENTO]",
  CANCEL: "[CANCELADO]",
};

export const VERSION_ACTION_LABEL: Record<string, string> = {
  INITIAL_BASELINE: "Version base inicial",
  CREATE: "Registro inicial",
  UPDATE: "Edicion de esquema/datos",
  RESTOCK: "Restock de inventario",
  STOCK_ADJUST: "Ajuste manual de stock",
  ARCHIVE: "Tratamiento archivado",
  RESTORE: "Tratamiento reactivado",
  VERSION_RESTORE: "Version restaurada por administrador",
};
