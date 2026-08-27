// Espelha o model Document de apps/api (@opsmind/database).
export type DocumentStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface Document {
  id: string;
  organizationId: string;
  customerId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage: string | null;
  uploadedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
