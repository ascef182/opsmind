// Espelha o model Task de apps/api (@opsmind/database).
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface Task {
  id: string;
  organizationId: string;
  customerId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  actorType: string;
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  customerId?: string;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  customerId?: string;
  assigneeId?: string;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  customerId?: string;
}
