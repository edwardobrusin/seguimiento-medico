import type {
  AlertStage,
  AlertStatus,
  EventCategory,
  IntakeConstraint,
  IntakeStatus,
  MedFrequencyType,
  NoteType,
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
  LAB_TEST: "Estudio de Laboratorio",
  PROCEDURE: "Procedimiento",
  OTHER: "Otro Evento",
};

export const EVENT_CATEGORY_TAG: Record<EventCategory, string> = {
  APPOINTMENT: "[CITA]",
  INJECTION: "[INYECCION]",
  LAB_TEST: "[LABORATORIO]",
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
  PRIMARY_CAREGIVER: "[CUIDADOR PRINCIPAL]",
  FAMILY_MEMBER: "[FAMILIAR]",
  CAREGIVER: "[CUIDADOR]",
};
