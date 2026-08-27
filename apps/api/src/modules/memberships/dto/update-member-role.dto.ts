import { IsIn } from 'class-validator';
import type { Role } from '@opsmind/shared-types';
import { ROLE_HIERARCHY } from '../../../shared/constants/roles.constant';

export class UpdateMemberRoleDto {
  @IsIn(ROLE_HIERARCHY)
  role!: Role;
}
