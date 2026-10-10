import {
  Profile,
  Gym,
  GymStaff,
  CoachProfile,
  CoachGymAffiliation,
  CoachAvailability,
  Booking,
  CheckInPass,
  UserRole,
} from '@/types/database';

export interface MockAuthUser {
  id: string;
  email: string;
  role: UserRole | 'anon';
}

export interface MockAuthContext {
  user: MockAuthUser | null;
  serviceRole?: boolean;
}

export interface InMemoryDatastore {
  profiles: Profile[];
  gyms: Gym[];
  gym_staff: GymStaff[];
  coach_profiles: CoachProfile[];
  coach_gym_affiliations: CoachGymAffiliation[];
  coach_availability: CoachAvailability[];
  bookings: Booking[];
  check_in_passes: CheckInPass[];
}

export class RlsPolicyEvaluator {
  /**
   * Helper: Get gym IDs where the user is an active staff member
   */
  public static getAuthGymIds(userId: string | undefined, datastore: InMemoryDatastore): string[] {
    if (!userId) return [];
    return datastore.gym_staff
      .filter((staff) => staff.user_id === userId)
      .map((staff) => staff.gym_id);
  }

  /**
   * Helper: Get coach profile ID for the current authenticated user
   */
  public static getAuthCoachId(userId: string | undefined, datastore: InMemoryDatastore): string | null {
    if (!userId) return null;
    const coach = datastore.coach_profiles.find((c) => c.user_id === userId);
    return coach ? coach.id : null;
  }

  /**
   * Filter rows on SELECT operations based on RLS policies
   */
  public static filterSelect<T>(
    tableName: keyof InMemoryDatastore,
    rows: T[],
    context: MockAuthContext,
    datastore: InMemoryDatastore
  ): T[] {
    if (context.serviceRole) {
      return [...rows];
    }

    const user = context.user;
    const isAuth = !!user && user.role !== 'anon';
    const userId = user?.id;
    const authGymIds = isAuth ? this.getAuthGymIds(userId, datastore) : [];
    const authCoachId = isAuth ? this.getAuthCoachId(userId, datastore) : null;

    switch (tableName) {
      case 'gyms': {
        const gyms = rows as unknown as Gym[];
        return gyms.filter((gym) => {
          // Public read active gyms
          if (gym.is_active) return true;
          // Staff can view inactive gyms for their venue
          if (isAuth && authGymIds.includes(gym.id)) return true;
          return false;
        }) as unknown as T[];
      }

      case 'profiles': {
        if (!isAuth) return [];
        const profiles = rows as unknown as Profile[];
        return profiles.filter((p) => p.id === userId) as unknown as T[];
      }

      case 'gym_staff': {
        if (!isAuth) return [];
        const staff = rows as unknown as GymStaff[];
        // Staff can read colleagues for their gym venues
        return staff.filter((s) => authGymIds.includes(s.gym_id)) as unknown as T[];
      }

      case 'coach_profiles': {
        const coaches = rows as unknown as CoachProfile[];
        return coaches.filter((c) => {
          // Public read active coaches
          if (c.is_active) return true;
          // Coach can view own inactive profile
          if (isAuth && c.user_id === userId) return true;
          return false;
        }) as unknown as T[];
      }

      case 'coach_gym_affiliations': {
        const affs = rows as unknown as CoachGymAffiliation[];
        return affs.filter((a) => {
          // Public read verified affiliations
          if (a.is_verified) return true;
          // Coach or gym staff can view unverified
          if (authCoachId && a.coach_id === authCoachId) return true;
          if (authGymIds.includes(a.gym_id)) return true;
          return false;
        }) as unknown as T[];
      }

      case 'coach_availability': {
        // Public read availability
        return [...rows];
      }

      case 'bookings': {
        if (!isAuth) return [];
        const bookings = rows as unknown as Booking[];
        return bookings.filter((b) => {
          // Client view own bookings
          if (b.client_id === userId) return true;
          // Coach view own assigned bookings
          if (authCoachId && b.coach_id === authCoachId) return true;
          // Gym staff view bookings for their specific venue
          if (authGymIds.includes(b.gym_id)) return true;
          return false;
        }) as unknown as T[];
      }

      case 'check_in_passes': {
        if (!isAuth) return [];
        const passes = rows as unknown as CheckInPass[];
        return passes.filter((p) => {
          // Client view own passes
          if (p.client_id === userId) return true;
          // Gym staff view passes for their specific venue
          if (authGymIds.includes(p.gym_id)) return true;
          return false;
        }) as unknown as T[];
      }

      default:
        return [...rows];
    }
  }

  /**
   * Validate INSERT mutations against RLS policy WITH CHECK expressions
   */
  public static validateInsert<T extends Record<string, any>>(
    tableName: keyof InMemoryDatastore,
    newRow: T,
    context: MockAuthContext,
    datastore: InMemoryDatastore
  ): void {
    if (context.serviceRole) return;

    const user = context.user;
    if (!user || user.role === 'anon') {
      throw {
        message: `new row violates row-level security policy for table "${tableName}"`,
        code: '42501',
      };
    }

    const userId = user.id;
    const authGymIds = this.getAuthGymIds(userId, datastore);
    const authCoachId = this.getAuthCoachId(userId, datastore);

    switch (tableName) {
      case 'profiles':
        if (newRow.id !== userId) {
          throw {
            message: 'new row violates row-level security policy for table "profiles"',
            code: '42501',
          };
        }
        break;

      case 'coach_profiles':
        if (newRow.user_id !== userId) {
          throw {
            message: 'new row violates row-level security policy for table "coach_profiles"',
            code: '42501',
          };
        }
        break;

      case 'coach_availability':
        if (!authCoachId || newRow.coach_id !== authCoachId) {
          throw {
            message: 'new row violates row-level security policy for table "coach_availability"',
            code: '42501',
          };
        }
        break;

      case 'bookings': {
        if (newRow.client_id !== userId) {
          throw {
            message: 'new row violates row-level security policy for table "bookings"',
            code: '42501',
          };
        }
        if (newRow.status !== 'pending' && !context.serviceRole) {
          throw {
            message: 'Client can only create bookings with status "pending"',
            code: '42501',
          };
        }
        // Accounting integrity invariant check constraint
        const gross = Number(newRow.gross_amount);
        const floor = Number(newRow.gym_floor_fee ?? 8.0);
        const plat = Number(newRow.platform_fee);
        const coach = Number(newRow.coach_payout);

        if (Math.round((gross - (floor + plat + coach)) * 100) !== 0) {
          throw {
            message: `new row for relation "bookings" violates check constraint "chk_split_balance"`,
            code: '23514',
          };
        }
        break;
      }

      case 'check_in_passes':
        // Passes can only be created by system/client booking confirmation
        if (newRow.client_id !== userId && !context.serviceRole) {
          throw {
            message: 'new row violates row-level security policy for table "check_in_passes"',
            code: '42501',
          };
        }
        break;

      default:
        break;
    }
  }

  /**
   * Validate UPDATE mutations against RLS policy USING and WITH CHECK expressions
   */
  public static validateUpdate<T extends Record<string, any>>(
    tableName: keyof InMemoryDatastore,
    existingRow: T,
    updatedRow: T,
    context: MockAuthContext,
    datastore: InMemoryDatastore
  ): void {
    if (context.serviceRole) return;

    const user = context.user;
    if (!user || user.role === 'anon') {
      throw {
        message: `row update violates row-level security policy for table "${tableName}"`,
        code: '42501',
      };
    }

    const userId = user.id;
    const authGymIds = this.getAuthGymIds(userId, datastore);
    const authCoachId = this.getAuthCoachId(userId, datastore);

    switch (tableName) {
      case 'profiles':
        if (existingRow.id !== userId || updatedRow.id !== userId) {
          throw {
            message: 'row update violates row-level security policy for table "profiles"',
            code: '42501',
          };
        }
        break;

      case 'coach_profiles':
        if (existingRow.user_id !== userId || updatedRow.user_id !== userId) {
          throw {
            message: 'row update violates row-level security policy for table "coach_profiles"',
            code: '42501',
          };
        }
        break;

      case 'bookings': {
        const isClient = existingRow.client_id === userId;
        const isCoach = authCoachId && existingRow.coach_id === authCoachId;
        const isGymStaff = authGymIds.includes(existingRow.gym_id);

        if (!isClient && !isCoach && !isGymStaff) {
          throw {
            message: 'row update violates row-level security policy for table "bookings"',
            code: '42501',
          };
        }

        // If client is updating, can only cancel pending/confirmed booking
        if (isClient && !isCoach && !isGymStaff) {
          if (updatedRow.status !== 'cancelled') {
            throw {
              message: 'Client can only update booking status to "cancelled"',
              code: '42501',
            };
          }
        }
        break;
      }

      case 'check_in_passes': {
        const isGymStaff = authGymIds.includes(existingRow.gym_id);
        if (!isGymStaff) {
          throw {
            message: 'Only authorized gym staff can redeem check-in passes for this venue',
            code: '42501',
          };
        }
        // Redemption policy: USING is_redeemed = FALSE, WITH CHECK is_redeemed = TRUE
        if (existingRow.is_redeemed === true && updatedRow.is_redeemed === true) {
          throw {
            message: 'Pass has already been redeemed and cannot be updated again',
            code: '42501',
          };
        }
        break;
      }

      default:
        break;
    }
  }
}
