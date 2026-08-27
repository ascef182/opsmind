import { IsEmail, IsIn } from 'class-validator';
import type { Role } from '@opsmind/shared-types';
import { ROLE_HIERARCHY } from '../../../shared/constants/roles.constant';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ROLE_HIERARCHY)
  role!: Role;
}
