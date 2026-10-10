# GymMatch Linz — Mobile-First Personal Training Booking PWA

> **Linz, Austria's on-demand personal training platform connecting fitness athletes, certified freelance coaches, and premium partner gyms with dynamic cryptographic QR check-ins, automated multi-party split payments, and strict multi-tenant Row Level Security.**

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture & Multi-Tenant Data Layer](#architecture--multi-tenant-data-layer)
3. [Mobile-First PWA & Persistent Role Switcher](#mobile-first-pwa--persistent-role-switcher)
4. [Multi-Party Payment Splitting & Stripe Connect](#multi-party-payment-splitting--stripe-connect)
5. [Dynamic Cryptographic QR Check-In Protocol (`GM1`)](#dynamic-cryptographic-qr-check-in-protocol-gm1)
6. [Linz Partner Gyms & Certified Coaches](#linz-partner-gyms--certified-coaches)
7. [Getting Started & Local Development](#getting-started--local-development)
8. [Automated Testing & Verification Suite](#automated-testing--verification-suite)
9. [Configuration: Offline Mock vs. Live Credentials](#configuration-offline-mock-vs-live-credentials)
10. [Directory Structure](#directory-structure)

---

## 1. Project Overview

**GymMatch Linz** is a mobile-first Progressive Web Application (PWA) designed specifically for the fitness ecosystem of Linz, Upper Austria. 

In traditional fitness settings, freelance personal trainers face high venue barrier fees or restrictions, while clients are required to buy expensive long-term gym memberships or multi-visit punch cards in addition to coach fees. 

GymMatch solves this by creating a tripartite marketplace:
- **Clients** discover top-rated certified coaches and book 1-on-1 sessions at premium fitness facilities across Linz (Zentrum, Urfahr, Hafenviertel).
- **Certified Freelance Coaches** manage their weekly availability across affiliated Linz gyms, receive automated net payouts, and eliminate billing overhead.
- **Partner Gyms** monetize off-peak floor capacity by earning an automated **€8.00 floor fee** per completed session without handling customer ticketing or receptionist cash intake.

---

## 2. Architecture & Multi-Tenant Data Layer

GymMatch is built with **Next.js 15 (App Router)**, **React 19**, **Tailwind CSS**, and **TypeScript**.

### PostgreSQL Relational Schema
The database schema is defined in declarative Supabase SQL migrations under `supabase/migrations/`:
- `20261010000001_initial_schema.sql`: 8 normalized tables with foreign keys, constraints, and performance indexes:
  - `profiles`: Multi-role user accounts (`client`, `coach`, `gym_receptionist`, `admin`).
  - `gyms`: Linz fitness facilities with address, contact info, floor fee, and Stripe Connect account IDs.
  - `gym_staff`: Venue receptionists mapped to specific gyms.
  - `coach_profiles`: Certified trainers with hourly rates, specialties, Austrian certifications, ratings, and Stripe Connect account IDs.
  - `coach_gym_affiliations`: Many-to-many verified linkages between coaches and partner gyms.
  - `coach_availability`: Day-of-week and recurring time slots linked to affiliated venues.
  - `bookings`: Session lifecycle records with financial split fields and accounting check constraints.
  - `check_in_passes`: Dynamic HMAC-SHA256 signed check-in tokens with redemption tracking.

### Row Level Security (RLS) Tenant Isolation
Configured in `supabase/migrations/20261010000002_rls_policies.sql`, RLS guarantees strict tenant boundaries:
- **Gym Staff / Receptionists** can only view and redeem check-in passes and bookings assigned to their specific physical `gym_id`. They cannot inspect foreign gym records.
- **Coaches** can only access their personal availability slots, affiliated venues, assigned bookings, client notes, and payout analytics.
- **Clients** can only query their own booking history and unredeemed check-in passes. Cross-client query leakage is blocked at the database engine level.
- **Anonymous Visitors** can read active partner gyms and coach profiles for discovery, but are completely blocked from reading or inserting bookings and passes.

### Offline Deterministic In-Memory Mock Datastore
To enable 100% reproducible testing and development without requiring active cloud credentials or local Docker engines:
- `src/lib/supabase/mock-db.ts`: In-memory PostgREST query builder replicating Supabase JS client syntax (`.from()`, `.select()`, `.insert()`, `.update()`, `.eq()`, `.order()`, `.limit()`, `.single()`).
- `src/lib/supabase/rls-evaluator.ts`: Evaluates RLS SELECT filtering, INSERT `WITH CHECK` expressions, UPDATE constraints, and the `chk_split_balance` mathematical integrity constraint in-memory matching PostgreSQL semantics.
- `src/lib/supabase/client.ts`: Automatic adapter providing role-scoped mock clients (`getAnonClient()`, `getClientUserClient()`, `getCoachClient()`, `getGymReceptionClient()`, `getServiceRoleClient()`).

---

## 3. Mobile-First PWA & Persistent Role Switcher

The user interface is optimized for touch viewports (**390px–430px**) with a responsive desktop frame container, dark athletic aesthetic (`bg-slate-950`), and modern mobile ergonomics.

### Persistent Role Switcher
A persistent segmented control pinned to the header (`[ 👤 Client | 🏋️ Coach | 🏢 Reception ]`) allows instant toggling between all three marketplace roles without login forms or authentication friction:

```
┌───────────────────────────────────────────────┐
│ [  👤 Client  |  🏋️ Coach  |  🏢 Reception  ] │
└───────────────────────────────────────────────┘
```

### Role Views & Capabilities

#### 👤 Client Flow
- **Gym Discovery:** Browse Linz partner gyms with district badges (4020 Zentrum, 4040 Urfahr), amenities chips (Wellness & Spa, Eleiko Olympic Lifting, CrossFit Zone), and included floor fee indicators.
- **Coach Storefront:** Certified coaches catalog with Austrian credentials (ÖBSV, CSCS, B-Lizenz Rehab), specialties filter chips, ratings, reviews, and hourly rates ("incl. gym entry").
- **7-Day Week Calendar:** Horizontal day picker (today + 6 days) with time slots grouped into Morning (08:00–12:00), Afternoon (12:00–17:00), and Evening (17:00–21:00).
- **1-Click Checkout Modal:** Slide-up sheet showing an itemized fee breakdown (Gross, Gym Floor Fee, Platform Fee, Coach Payout), client training notes, escrow protection badge, and 1-click payment simulation.
- **Pass Viewer:** Displays active and redeemed check-in passes with a deterministic 29x29 SVG QR matrix, validity countdown, and "✓ Cached Offline" indicator.

#### 🏋️ Coach Portal
- **Session Dashboard:** Chronologically sorted upcoming training sessions with client names, venues, start times, and net earnings (`+€56.50`).
- **Availability Editor:** Manage 7-day recurring schedules, toggle slots, and add new slots linked to affiliated Linz gyms.
- **Payout Summary & Split Simulator:** Stripe Connect Express status, total earnings, and an interactive fee simulator illustrating payout splits across hourly rates from €50 to €150.

#### 🏢 Gym Reception Desk Portal
- **Live Fee Accumulator:** Real-time revenue counter displaying today's floor fee earnings (`Today's Check-ins × €8.00`), month-to-date accruals, and an audit feed of athlete check-ins.
- **Dynamic QR Scanner:** Mobile camera viewfinder simulation with targeting reticle, corner brackets, and animated laser sweep.
- **Web Audio API Feedback:** Synthesized dual-tone chimes (C5-E5 chord for successful check-ins, low 160Hz pulse for denied scans).
- **Simulation Probes:** Quick-test buttons for `Valid Check-In`, `Replay Attack`, `Wrong Venue`, and `Tampered Token`.
- **Manual Redemption Modal:** Fallback interface allowing desk staff to paste raw GM1 tokens or check-in pass IDs.

### PWA & Offline Basement Resilience
- `public/manifest.json`: Web App Manifest with `display: "standalone"`, `theme_color: "#0f172a"`, and maskable touch icons.
- `public/sw.js`: Service worker implementing cache-first strategies for app shells and static assets.
- `src/context/RoleContext.tsx`: Automatically mirrors active passes into browser `localStorage`, ensuring that clients can display valid QR passes and receptionists can inspect booking details even in network-dead gym basements.

---

## 4. Multi-Party Payment Splitting & Stripe Connect

All monetary calculations are performed in **integer Euro cents** with round-to-nearest on the platform take-rate, and the coach payout calculated as the exact residual. This guarantees **zero floating-point drift** and strict conservation of money.

### Accounting Invariant
$$\text{Gross Amount (cents)} \equiv \text{Gym Floor Fee (cents)} + \text{Platform Fee (cents)} + \text{Coach Payout (cents)}$$

Enforced programmatically in `src/lib/payments/split.ts` and enforced at the database level by PostgreSQL check constraint `chk_split_balance`:
```sql
CONSTRAINT chk_split_balance CHECK (gross_amount = gym_floor_fee + platform_fee + coach_payout)
```

### Baseline €75.00 Session Breakdown
| Component | Formula / Policy | Amount (EUR) | Amount (Cents) | Share |
|---|---|---|---|---|
| **Gross Booking Value (GBV)** | Coach Hourly Rate | **€75.00** | 7,500¢ | 100.00% |
| **Partner Gym Floor Fee** | Fixed per completed session | **€8.00** | 800¢ | 10.67% |
| **Platform Commission** | 14.00% take-rate | **€10.50** | 1,050¢ | 14.00% |
| **Net Coach Payout** | Exact residual ($\text{GBV} - \text{Gym} - \text{Plat}$) | **€56.50** | 5,650¢ | 75.33% |

### Cancellation & Refund Policy
- **Coach / Gym Cancellation:** 100% refund to client (€75.00), €0.00 disbursed to gym or platform.
- **Early Client Cancellation (> 24h before session):** 100% refund to client (€75.00).
- **Late Client Cancellation (≤ 24h before session):** 0% refund to client; full floor fee (€8.00) and net coach payout (€56.50) are protected and disbursed to compensate reserved time and venue slots.

### Stripe Connect Separate Charges & Transfers
- **Charge Capture:** When a booking is confirmed, client funds are captured into platform escrow via `PaymentIntent` with `transfer_group = "booking_<id>"`.
- **Escrow Hold:** Funds remain held until the athlete checks in at the reception desk.
- **Disbursement:** Upon check-in, separate transfers are disbursed:
  - Transfer 1: `amount = 800`, `destination = gym.stripe_account_id`
  - Transfer 2: `amount = 5650`, `destination = coach.stripe_account_id`
  - Platform retains `1050¢` commission in platform balance.
- Supported via `MockStripeService` (`src/lib/payments/stripe-mock.ts`) with idempotency key support and webhook event simulation (`payment_intent.succeeded`, `charge.refunded`).

---

## 5. Dynamic Cryptographic QR Check-In Protocol (`GM1`)

To prevent pass forging, screenshot sharing, venue fraud, and double redemption, check-in passes utilize the **GM1 Protocol** (`src/lib/qr/token.ts`).

### Token Structure
```
GM1.<payload_base64url>.<hmac_sha256_base64url>
```

### Payload Specification
```typescript
interface QRPayload {
  v: 1;          // Protocol version
  pid: string;   // check_in_passes.id
  bid: string;   // booking_id
  cid: string;   // client_id
  gid: string;   // gym_id (scoped physical venue)
  st: number;    // session start epoch timestamp
  vf: number;    // valid from epoch (st - 30 minutes)
  vu: number;    // valid until epoch (st + duration + 30 minutes)
  nce: string;   // 16-byte cryptographically random hex nonce
  iat: number;   // issued at epoch timestamp
}
```

### 4-Stage Verification Pipeline (`src/lib/qr/validator.ts`)
1. **Cryptographic Authenticity:** HMAC-SHA256 signature is evaluated using `crypto.timingSafeEqual()` in constant time to prevent timing side-channel attacks.
2. **Venue Scoping:** Scanned gym venue ID must strictly match `payload.gid`. Cross-gym scanning (e.g. John Harris pass scanned at Fit Fabrik) is immediately rejected.
3. **Time Validity Window:** Token check-in is valid only from 30 minutes before session start to 30 minutes after scheduled session conclusion.
4. **Atomic Compare-and-Swap (CAS) Anti-Replay:**
   $$\text{UPDATE check\_in\_passes SET is\_redeemed = TRUE, redeemed\_at = NOW() WHERE id = pid AND is\_redeemed = FALSE}$$
   If `is_redeemed` is already `TRUE`, the CAS operation returns `false` and produces `errorCode: 'ALREADY_REDEEMED'`. Screenshots or reused tokens cannot be redeemed a second time.

---

## 6. Linz Partner Gyms & Certified Coaches

The platform includes verified domain seed data for Linz (`src/lib/data/linz-seed.ts` and `supabase/seed.sql`):

### Linz Partner Fitness Centers
| Partner Gym | Address / District | Floor Fee | Amenities |
|---|---|---|---|
| **John Harris Fitness Linz Atrium** | Am Winterhafen 4, 4020 Linz | €8.00 | Wellness & Spa, Eleiko Olympic Lifting, Danube Panorama |
| **Fit Fabrik Linz** | Hafenstraße 2a, 4020 Linz | €8.00 | CrossFit Zone, Dumbbells up to 60kg, 24/7 Access |
| **Happy Fit Linz Urfahr** | Freistädter Straße 313, 4040 Linz | €8.00 | Cardio Cinema, Functional Tower, Solarium |
| **Kieser Training Linz Zentrum** | Landstraße 49, 4020 Linz | €8.00 | Medical Strength, Spine Analysis, Joint Protection |

### Certified Freelance Coaches
| Coach Name | Rate / Hour | Specialties | Austrian Certifications |
|---|---|---|---|
| **Lukas Bauer** | €75.00/h | Strength & Conditioning, Powerlifting | ÖBSV Staatlich geprüfter Fitnesstrainer, CSCS |
| **Elena Fischer** | €80.00/h | Mobility & Rehab, Functional Fitness | B-Lizenz Rehabilitation, FMS Level 2 |
| **Markus Weber** | €65.00/h | HIIT & Endurance, Fat Loss | Diplomierter Personal Trainer (Wifi OÖ), TRX |
| **Anna Steyr** | €90.00/h | Olympic Weightlifting, Cross-Training | ÖGV Staatliche Gewichtheber-Trainerin, Eleiko |

---

## 7. Getting Started & Local Development

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ / v22+ recommended)
- **npm**: v9.0.0 or higher

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/danil/GymMatch.git
cd GymMatch
npm install
```

### Running the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

- On mobile devices, add the site to your Home Screen to test full standalone PWA capabilities.
- On desktop browsers, the app renders inside a centered 390px–430px smartphone frame with responsive margins.
- Use the persistent role switcher in the header to switch between Client, Coach, and Reception roles.

---

## 8. Automated Testing & Verification Suite

GymMatch includes a comprehensive, deterministic automated test suite covering unit math, cryptographic validation, RLS multi-tenant isolation, scanner resilience, and complete end-to-end integration journeys.

### 1. Run All Unit & Security Tests
Executes 106 automated tests across 31 suites in under 400ms:
```bash
npm test
```
**Test Suites Covered:**
- `tests/split-math.test.ts`: Split payment precision across variable rates (€25 to €500), odd cents (€99.99), and cancellation refund timing.
- `tests/qr-crypto.test.ts`: GM1 token generation, constant-time verification, venue scoping, expiration boundaries, and CAS replay resistance.
- `tests/rls-isolation.test.ts`: Supabase Row Level Security tenant boundaries (cross-client leakage, cross-coach isolation, staff scoping, anonymous mutation blocks, `chk_split_balance` integrity).
- `tests/stripe-mock.test.ts`: Stripe Connect Separate Charges & Transfers, escrow holds, transfer groups, refunds, and idempotency.
- `tests/challenger-m2-scanner-stress.test.ts`: Viewfinder simulations, accumulator precision sweeps, and audio feedback.
- `tests/remediation-m2-verification.test.ts`: Out-of-the-box seed token validation and state persistence checks.

### 2. Run Standalone E2E Multi-Role Integration Journey
Simulates the entire tripartite user journey in a deterministic integration script:
```bash
npm run test:e2e
```
*or directly with tsx:*
```bash
npx tsx scripts/e2e-simulation.ts
```
**Verified Journey Steps:**
- **Step 1 (Coach):** Lukas Bauer connects to John Harris Fitness Linz Atrium and publishes availability slots.
- **Step 2 (Client):** Max Mustermann discovers gyms, picks coach slot, validates exact split calculation (€75.00 GBV = €8.00 Gym + €10.50 Platform 14% + €56.50 Coach), simulates 1-click checkout, and receives an HMAC-SHA256 signed `GM1` QR pass.
- **Step 3 (Reception):** Front desk scans dynamic QR token -> constant-time signature check passes, gym match passes, atomic CAS sets `is_redeemed = true`, booking transitions to `checked_in`, and floor fee tally increments by exactly €8.00.
- **Step 4 (Escrow):** Stripe Separate Charges & Transfers confirm disbursements (gym +€8.00, coach +€56.50, platform 14% commission retained).
- **Step 5 (Anti-Replay):** Immediate re-scan attempt is strictly rejected by atomic CAS (`ALREADY_REDEEMED`) with zero extra fees accrued.
- **Exit Code:** Exits with code `0` on verified success.

### 3. Run Production Build & Type Checking
Verifies zero TypeScript errors and compiles static production routes:
```bash
npm run build
```
Verify type contracts without building:
```bash
npx tsc --noEmit
```

---

## 9. Configuration: Offline Mock vs. Live Credentials

The application operates in **zero-config offline mock mode** by default, allowing local development and CI/CD pipelines to run without external API keys or network dependencies.

### Environment Configuration (`.env.local`)
To switch between offline mock mode and live Supabase / Stripe cloud environments, create or edit `.env.local` in the project root:

```ini
# =============================================================================
# GymMatch Linz — Environment Configuration
# =============================================================================

# Toggle Mock Mode (default: true for offline development)
USE_MOCK_SUPABASE=true

# Cryptographic QR Signing Secret (GM1 Protocol)
QR_SIGNING_SECRET=gymmatch_dev_linz_secret_key_2026

# -----------------------------------------------------------------------------
# Optional: Live Supabase PostgreSQL Connection
# -----------------------------------------------------------------------------
# NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
# SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# -----------------------------------------------------------------------------
# Optional: Live Stripe Connect Credentials
# -----------------------------------------------------------------------------
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### How the Adapter Works
- In `src/lib/supabase/client.ts`: If `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present and `USE_MOCK_SUPABASE` is not `'true'`, the application connects to your live Supabase cloud database.
- Otherwise, the application seamlessly activates the in-memory PostgREST mock datastore with RLS policy evaluation, initialized from Linz seed data.

---

## 10. Directory Structure

```
GymMatch/
├── package.json                   # Dependencies, build scripts & test commands
├── tsconfig.json                  # TypeScript compiler configuration & path aliases (@/*)
├── tailwind.config.js             # Mobile screen breakpoints (390px, 430px) & athletic theme
├── next.config.js                 # Next.js App Router configuration
├── README.md                      # Comprehensive documentation (this file)
├── public/
│   ├── manifest.json              # Web App Manifest for mobile installation
│   ├── sw.js                      # Service Worker for shell caching & offline pass access
│   └── icons/                     # PWA touch icons (192x192, 512x512, SVG master)
├── supabase/
│   ├── migrations/
│   │   ├── 20261010000001_initial_schema.sql  # 8 tables, indexes, constraints
│   │   └── 20261010000002_rls_policies.sql    # Multi-tenant RLS isolation policies
│   └── seed.sql                   # SQL seed data for Linz partner gyms & coaches
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout with PWA meta tags & RoleProvider
│   │   ├── page.tsx               # Main mobile shell orchestrating role views
│   │   └── globals.css            # Dark athletic styling & laser scan animations
│   ├── components/
│   │   ├── layout/
│   │   │   ├── MobileContainer.tsx    # 390-430px smartphone frame container
│   │   │   └── RoleSwitcher.tsx       # Segmented control [ Client | Coach | Reception ]
│   │   ├── client/
│   │   │   ├── GymDiscovery.tsx       # Linz gym search & district filters
│   │   │   ├── CoachStorefront.tsx    # Certified coaches catalog & rates
│   │   │   ├── AvailabilityPicker.tsx # 7-day horizontal calendar slot picker
│   │   │   ├── CheckoutModal.tsx      # Transparent split breakdown & 1-click pay
│   │   │   └── PassViewer.tsx         # SVG QR matrix renderer & pass viewer
│   │   ├── coach/
│   │   │   ├── CoachDashboard.tsx     # Session dashboard & client notes
│   │   │   ├── AvailabilityManager.tsx# Weekly schedule editor linked to gyms
│   │   │   └── PayoutSummary.tsx      # Stripe Connect stats & live fee simulator
│   │   └── reception/
│   │       ├── ReceptionScanner.tsx   # Viewfinder, audio chimes & scan simulation
│   │       ├── LiveFeeTally.tsx       # Real-time floor fee accumulator widget
│   │       └── ManualRedeemModal.tsx  # Fallback token entry modal
│   ├── context/
│   │   └── RoleContext.tsx        # Multi-role state & localStorage synchronization
│   ├── lib/
│   │   ├── payments/
│   │   │   ├── split.ts           # Integer cent payment split calculator
│   │   │   └── stripe-mock.ts     # Mock Stripe Connect Separate Transfers
│   │   ├── qr/
│   │   │   ├── token.ts           # GM1 HMAC-SHA256 token generator & validator
│   │   │   └── validator.ts       # Reception check-in engine & atomic CAS
│   │   ├── supabase/
│   │   │   ├── client.ts          # Scoped Supabase client adapter
│   │   │   ├── mock-db.ts         # In-memory PostgREST mock datastore
│   │   │   └── rls-evaluator.ts   # In-memory Row Level Security policy evaluator
│   │   └── data/
│   │       └── linz-seed.ts       # Linz gyms, coaches, affiliations & seed passes
│   └── types/
│       ├── database.ts            # PostgreSQL schema TypeScript interfaces
│       ├── payments.ts            # Payment split & Stripe Connect interfaces
│       └── qr.ts                  # GM1 QR payload & verification interfaces
├── tests/
│   ├── split-math.test.ts         # Payment split math & cancellation refund tests
│   ├── qr-crypto.test.ts          # GM1 protocol & CAS anti-replay tests
│   ├── rls-isolation.test.ts      # Multi-tenant RLS security tests
│   ├── stripe-mock.test.ts        # Stripe Connect mock transfer tests
│   ├── challenger-stress.test.ts  # Financial split sweep & RLS edge case tests
│   ├── challenger-m2-scanner-stress.test.ts # Reception scanner & tally stress tests
│   └── remediation-m2-verification.test.ts  # Seed pass signature & state persistence tests
└── scripts/
    └── e2e-simulation.ts          # Deterministic standalone 5-step integration script
```

---

## License
MIT License. Built for the fitness community of Linz, Austria.
