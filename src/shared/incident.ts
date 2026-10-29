import type { PatientState } from "./patient.ts";

export type TransferLeg = {
  legId: string;
  resourceId: string;
  createdAt: number; // epoch ms
  completedAt: number | null; // null while Active
};

// The whole Incident as the Coordinator sends it; Closed is derived from the legs (ADR 0006).
export type Incident = {
  incidentId: string; // INC- plus digits
  createdAt: number; // epoch ms
  closed: boolean;
  legs: TransferLeg[]; // in creation order
  patientId: string;
  patient: PatientState; // from the projection
};
