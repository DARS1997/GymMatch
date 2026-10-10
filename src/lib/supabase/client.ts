import {
  createMockSupabaseClient,
  MockSupabaseClient,
} from './mock-db';
import { MockAuthContext, MockAuthUser } from './rls-evaluator';

const isLiveSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.USE_MOCK_SUPABASE !== 'true'
);

/**
 * Returns a Supabase client instance.
 * Defaults to the in-memory deterministic mock Supabase client for offline execution and testing.
 */
export function getSupabaseClient(context?: MockAuthContext): MockSupabaseClient {
  if (isLiveSupabaseConfigured) {
    // If live Supabase credentials are configured in environment variables,
    // in future steps dynamic real Supabase client could be loaded here.
    // For local deterministic test and development mode, mock client is active.
    return createMockSupabaseClient(context);
  }

  return createMockSupabaseClient(context);
}

/**
 * Convenience helper: Unauthenticated anonymous client
 */
export function getAnonClient(): MockSupabaseClient {
  return createMockSupabaseClient({
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'anon@gymmatch.at',
      role: 'anon',
    },
  });
}

/**
 * Convenience helper: Service role client (bypasses RLS for webhooks & system tasks)
 */
export function getServiceRoleClient(): MockSupabaseClient {
  return createMockSupabaseClient({
    user: {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      email: 'service_role@gymmatch.at',
      role: 'admin',
    },
    serviceRole: true,
  });
}

/**
 * Convenience helper: Scoped authenticated client for a specific client user
 */
export function getClientUserClient(
  clientId: string = '11111111-1111-1111-1111-000000000001',
  email: string = 'max.mustermann@linz.at'
): MockSupabaseClient {
  return createMockSupabaseClient({
    user: {
      id: clientId,
      email,
      role: 'client',
    },
  });
}

/**
 * Convenience helper: Scoped authenticated client for a certified coach user
 */
export function getCoachClient(
  coachUserId: string = '22222222-2222-2222-2222-000000000001',
  email: string = 'lukas.bauer@coach.at'
): MockSupabaseClient {
  return createMockSupabaseClient({
    user: {
      id: coachUserId,
      email,
      role: 'coach',
    },
  });
}

/**
 * Convenience helper: Scoped authenticated client for gym reception staff
 */
export function getGymReceptionClient(
  staffUserId: string = '33333333-3333-3333-3333-000000000001',
  email: string = 'empfang.johnharris@linz.at'
): MockSupabaseClient {
  return createMockSupabaseClient({
    user: {
      id: staffUserId,
      email,
      role: 'gym_receptionist',
    },
  });
}
