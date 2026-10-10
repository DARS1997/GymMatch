import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMockSupabaseClient,
  resetMockDatastore,
} from '../src/lib/supabase/mock-db';

describe('Supabase Row Level Security (RLS) Multi-Tenant Isolation', () => {
  beforeEach(() => {
    resetMockDatastore();
  });

  const clientId1 = '11111111-1111-1111-1111-000000000001'; // Max Mustermann
  const clientId2 = '11111111-1111-1111-1111-000000000002'; // Sophie Huber
  const coachUserIdLukas = '22222222-2222-2222-2222-000000000001';
  const coachUserIdElena = '22222222-2222-2222-2222-000000000002';
  const receptionUserIdJohnHarris = '33333333-3333-3333-3333-000000000001';
  const receptionUserIdFitFabrik = '33333333-3333-3333-3333-000000000002';

  it('Anonymous visitors can read active gyms & coaches but are blocked from bookings and passes', async () => {
    const anonClient = createMockSupabaseClient({
      user: { id: '00000000-0000-0000-0000-000000000000', email: 'anon@test.at', role: 'anon' },
    });

    // Public read gyms
    const { data: gyms } = await anonClient.from('gyms').select();
    assert.ok(gyms && gyms.length >= 4);

    // Public read coaches
    const { data: coaches } = await anonClient.from('coach_profiles').select();
    assert.ok(coaches && coaches.length >= 4);

    // Blocked from sensitive bookings
    const { data: bookings } = await anonClient.from('bookings').select();
    assert.equal(bookings?.length, 0);

    // Blocked from passes
    const { data: passes } = await anonClient.from('check_in_passes').select();
    assert.equal(passes?.length, 0);

    // Anonymous INSERT rejected with 42501
    const { error: insertError } = await anonClient.from('bookings').insert({
      client_id: clientId1,
      coach_id: '44444444-4444-4444-4444-000000000001',
      gym_id: '00000000-0000-0000-0000-000000000001',
      session_time: '2026-10-15T09:00:00Z',
      gross_amount: 75.0,
      gym_floor_fee: 8.0,
      platform_fee: 10.5,
      coach_payout: 56.5,
      status: 'pending',
    });
    assert.ok(insertError);
    assert.equal(insertError.code, '42501');
  });

  it('Client isolation: Client 1 sees own bookings, Client 2 cannot see Client 1 bookings', async () => {
    const client1 = createMockSupabaseClient({
      user: { id: clientId1, email: 'max.mustermann@linz.at', role: 'client' },
    });
    const client2 = createMockSupabaseClient({
      user: { id: clientId2, email: 'sophie.huber@linz.at', role: 'client' },
    });

    // Client 1 queries bookings -> sees baseline booking
    const { data: b1 } = await client1.from('bookings').select();
    assert.equal(b1?.length, 1);
    assert.equal(b1?.[0].client_id, clientId1);

    // Client 2 queries bookings -> sees 0 rows (zero leakage!)
    const { data: b2 } = await client2.from('bookings').select();
    assert.equal(b2?.length, 0);

    // Client 2 attempts to forge a booking impersonating Client 1 -> REJECTED
    const { error: forgeError } = await client2.from('bookings').insert({
      client_id: clientId1, // Impersonation attempt
      coach_id: '44444444-4444-4444-4444-000000000001',
      gym_id: '00000000-0000-0000-0000-000000000001',
      session_time: '2026-10-15T11:00:00Z',
      gross_amount: 75.0,
      gym_floor_fee: 8.0,
      platform_fee: 10.5,
      coach_payout: 56.5,
      status: 'pending',
    });
    assert.ok(forgeError);
    assert.equal(forgeError.code, '42501');
  });

  it('Coach isolation: Coach Lukas sees assigned bookings, Coach Elena sees 0 bookings', async () => {
    const lukasClient = createMockSupabaseClient({
      user: { id: coachUserIdLukas, email: 'lukas.bauer@coach.at', role: 'coach' },
    });
    const elenaClient = createMockSupabaseClient({
      user: { id: coachUserIdElena, email: 'elena.fischer@coach.at', role: 'coach' },
    });

    const { data: lukasBookings } = await lukasClient.from('bookings').select();
    assert.equal(lukasBookings?.length, 1);
    assert.equal(lukasBookings?.[0].coach_id, '44444444-4444-4444-4444-000000000001');

    const { data: elenaBookings } = await elenaClient.from('bookings').select();
    assert.equal(elenaBookings?.length, 0);
  });

  it('Gym Reception isolation: John Harris reception sees venue bookings, Fit Fabrik reception sees 0', async () => {
    const jHarrisStaff = createMockSupabaseClient({
      user: { id: receptionUserIdJohnHarris, email: 'empfang.johnharris@linz.at', role: 'gym_receptionist' },
    });
    const fitFabrikStaff = createMockSupabaseClient({
      user: { id: receptionUserIdFitFabrik, email: 'empfang.fitfabrik@linz.at', role: 'gym_receptionist' },
    });

    const { data: jhBookings } = await jHarrisStaff.from('bookings').select();
    assert.equal(jhBookings?.length, 1);
    assert.equal(jhBookings?.[0].gym_id, '00000000-0000-0000-0000-000000000001');

    const { data: ffBookings } = await fitFabrikStaff.from('bookings').select();
    assert.equal(ffBookings?.length, 0);
  });

  it('Check Constraint chk_split_balance prevents mathematical imbalance in bookings', async () => {
    const client1 = createMockSupabaseClient({
      user: { id: clientId1, email: 'max.mustermann@linz.at', role: 'client' },
    });

    // Attempt to insert booking where gross (75.00) != floor (8.00) + plat (10.50) + coach (50.00) (sum is 68.50)
    const { error: balanceError } = await client1.from('bookings').insert({
      client_id: clientId1,
      coach_id: '44444444-4444-4444-4444-000000000001',
      gym_id: '00000000-0000-0000-0000-000000000001',
      session_time: '2026-10-16T10:00:00Z',
      gross_amount: 75.0,
      gym_floor_fee: 8.0,
      platform_fee: 10.5,
      coach_payout: 50.0, // Tampered!
      status: 'pending',
    });

    assert.ok(balanceError);
    assert.equal(balanceError.code, '23514');
  });
});
