export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  plan: string;
  inactiveAfterDays: number;
}

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
}
