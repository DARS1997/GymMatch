export type UserRole = 'client' | 'coach' | 'gym_owner' | 'gym_receptionist' | 'admin';
export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled';
export type StaffRole = 'owner' | 'manager' | 'receptionist';

export interface Profile {
  id: string; // matches auth.users.id
  role: UserRole;
  full_name: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Gym {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string; // 'Linz'
  postal_code: string;
  contact_email: string;
  contact_phone?: string | null;
  floor_fee: number; // default 8.00
  stripe_account_id?: string | null;
  hero_image_url?: string | null;
  image_url?: string | null; // Compatibility alias
  amenities: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GymStaff {
  id: string;
  gym_id: string;
  user_id: string;
  role: StaffRole;
  created_at: string;
}

export interface CoachProfile {
  id: string;
  user_id: string;
  full_name: string;
  bio: string;
  specialties: string[];
  certifications: string[];
  hourly_rate: number; // e.g. 75.00
  rating: number; // 0.00 - 5.00
  review_count: number;
  stripe_account_id?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoachGymAffiliation {
  id: string;
  coach_id: string;
  gym_id: string;
  is_verified: boolean;
  created_at: string;
}

export interface CoachAvailability {
  id: string;
  coach_id: string;
  gym_id: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ...
  start_time: string; // '08:00:00'
  end_time: string; // '09:00:00'
  is_recurring: boolean;
  specific_date?: string | null;
  is_booked: boolean;
  created_at: string;
}

export interface Booking {
  id: string;
  client_id: string;
  coach_id: string;
  gym_id: string;
  session_time: string;
  duration_minutes: number;
  gross_amount: number;
  gym_floor_fee: number;
  platform_fee: number;
  coach_payout: number;
  status: BookingStatus;
  client_notes?: string | null;
  cancellation_reason?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_transfer_coach_id?: string | null;
  stripe_transfer_gym_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckInPass {
  id: string;
  booking_id: string;
  gym_id: string;
  client_id: string;
  dynamic_token: string;
  qr_signature: string;
  nonce: string;
  expires_at: string;
  redeemed_at?: string | null;
  is_redeemed: boolean;
  redeemed_by_user_id?: string | null;
  created_at: string;
}
