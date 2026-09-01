export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  plan: string;
  inactiveAfterDays: number;
  aiMonthlyBudget: number | null;
}

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
}

export interface UpdateOrganizationInput {
  aiMonthlyBudget: number | null;
}
