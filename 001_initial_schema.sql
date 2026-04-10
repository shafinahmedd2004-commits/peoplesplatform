-- ═══════════════════════════════════════════════════════════════
-- PEOPLE PLATFORM — Initial Schema
-- Migration: 001_initial_schema.sql
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query
--   Paste this entire file → Run All
-- ═══════════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ─── ENUMS ────────────────────────────────────────────────────
CREATE TYPE user_role_enum AS ENUM (
  'investor','founder','freelancer','farmer',
  'student','service_provider','mentor'
);
CREATE TYPE visibility_enum AS ENUM ('public','connections','private');
CREATE TYPE post_type_enum AS ENUM (
  'idea','job','service','looking_for','product','mentorship','tutoring'
);
CREATE TYPE post_status_enum AS ENUM ('active','paused','closed','deleted');
CREATE TYPE connection_status_enum AS ENUM ('pending','accepted','rejected','blocked');
CREATE TYPE conversation_type_enum AS ENUM ('direct','group');
CREATE TYPE message_type_enum AS ENUM ('text','image','file','voice_note');
CREATE TYPE booking_status_enum AS ENUM (
  'pending','accepted','declined','completed','cancelled','disputed'
);
CREATE TYPE payment_status_enum AS ENUM ('unpaid','paid','refunded');
CREATE TYPE notification_type_enum AS ENUM (
  'message','connection_request','booking_update',
  'post_interest','review','system'
);
CREATE TYPE report_status_enum AS ENUM ('pending','reviewed','actioned','dismissed');
CREATE TYPE report_target_enum AS ENUM ('post','user','message');
CREATE TYPE skill_level_enum AS ENUM ('beginner','mid','expert');
CREATE TYPE boost_type_enum AS ENUM ('featured','top_of_feed','highlighted');

-- ═══════════════════════════════════════════════════════════════
-- USERS & PROFILES
-- ═══════════════════════════════════════════════════════════════

-- Main users table (mirrors Supabase auth.users)
CREATE TABLE users (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           varchar(255),
  phone           varchar(30),
  is_admin        boolean DEFAULT false,
  is_suspended    boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  last_active     timestamptz DEFAULT now()
);

-- Auto-create users row when auth user is created
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- User public profiles
CREATE TABLE user_profiles (
  id                      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name            varchar(100),
  bio                     text,
  avatar_url              text,
  location_city           varchar(100),
  location_country        varchar(100),
  lat                     decimal(10,7),
  lng                     decimal(10,7),
  is_verified             boolean DEFAULT false,
  verification_type       varchar(50),
  visibility              visibility_enum DEFAULT 'public',
  rating_avg              decimal(3,2) DEFAULT 0,
  rating_count            int DEFAULT 0,
  profile_completion_pct  int DEFAULT 0,
  portfolio_url           text,
  website_url             text,
  linkedin_url            text,
  updated_at              timestamptz DEFAULT now()
);

-- Auto-create profile row when users row is created
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, profile_completion_pct)
  VALUES (new.id, split_part(new.email, '@', 1), 10)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Roles per user (multi-role support)
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  role        user_role_enum NOT NULL,
  is_primary  boolean DEFAULT false,
  active      boolean DEFAULT true,
  UNIQUE(user_id, role)
);

-- Skills per user
CREATE TABLE user_skills (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  skill    varchar(100) NOT NULL,
  level    skill_level_enum DEFAULT 'mid',
  UNIQUE(user_id, skill)
);

-- Industry tags per user
CREATE TABLE user_industry_tags (
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  tag      varchar(100) NOT NULL,
  PRIMARY KEY (user_id, tag)
);

-- Role-specific extended details
CREATE TABLE role_details_investor (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  budget_min           bigint,
  budget_max           bigint,
  preferred_industries text[],
  investment_stage     text[]
);

CREATE TABLE role_details_farmer (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  land_size_acres decimal(10,2),
  crop_types      text[],
  region          varchar(100),
  certifications  text[]
);

CREATE TABLE role_details_freelancer (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hourly_rate_min  int,
  hourly_rate_max  int,
  availability     varchar(50),
  portfolio_url    text,
  years_experience int
);

CREATE TABLE role_details_student (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  institution     varchar(200),
  degree          varchar(200),
  graduation_year int,
  seeking         varchar(50)
);

-- ═══════════════════════════════════════════════════════════════
-- SECTIONS & POSTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE sections (
  id           serial PRIMARY KEY,
  slug         varchar(50) UNIQUE NOT NULL,
  name         varchar(100) NOT NULL,
  icon         varchar(10),
  description  text,
  module       varchar(50)
);

INSERT INTO sections (slug, name, icon, module) VALUES
  ('idea-hub',   'Idea Hub',       '💡', 'ideas'),
  ('services',   'Services',       '⚡', 'services'),
  ('jobs',       'Jobs',           '💼', 'jobs'),
  ('farmers',    'Farmers Market', '🌾', 'farmers'),
  ('mentorship', 'Mentorship',     '🧭', 'mentorship'),
  ('learning',   'Learning',       '📚', 'learning'),
  ('investors',  'Investors',      '💰', 'investors'),
  ('events',     'Events',         '📅', 'events');

CREATE TABLE posts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  section_id        int REFERENCES sections(id),
  post_type         post_type_enum NOT NULL,
  title             varchar(300) NOT NULL,
  description       text NOT NULL,
  tags              text[] DEFAULT '{}',
  location_city     varchar(100),
  location_country  varchar(100),
  lat               decimal(10,7),
  lng               decimal(10,7),
  budget_min        bigint,
  budget_max        bigint,
  currency          varchar(10) DEFAULT 'BDT',
  status            post_status_enum DEFAULT 'active',
  is_boosted        boolean DEFAULT false,
  boost_expires_at  timestamptz,
  view_count        int DEFAULT 0,
  interest_count    int DEFAULT 0,
  fts               tsvector,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Full-text search auto-update trigger
CREATE OR REPLACE FUNCTION update_post_fts()
RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('english',
    unaccent(coalesce(NEW.title,'')) || ' ' ||
    unaccent(coalesce(NEW.description,'')) || ' ' ||
    unaccent(array_to_string(NEW.tags,' '))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_fts_trigger
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_post_fts();

CREATE TABLE post_media (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id       uuid REFERENCES posts(id) ON DELETE CASCADE,
  url           text NOT NULL,
  file_type     varchar(50),
  size_bytes    bigint,
  display_order int DEFAULT 0
);

CREATE TABLE post_bookmarks (
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ═══════════════════════════════════════════════════════════════
-- CONNECTIONS & MESSAGING
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE connections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  receiver_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  status        connection_status_enum DEFAULT 'pending',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(requester_id, receiver_id)
);

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type             conversation_type_enum DEFAULT 'direct',
  name             varchar(200),
  created_at       timestamptz DEFAULT now(),
  last_message_at  timestamptz DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  joined_at        timestamptz DEFAULT now(),
  last_read_at     timestamptz DEFAULT now(),
  is_muted         boolean DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid REFERENCES users(id),
  type             message_type_enum DEFAULT 'text',
  content          text,
  file_url         text,
  file_name        varchar(255),
  file_size        bigint,
  is_deleted       boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- BOOKINGS & TRANSACTIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id          uuid REFERENCES posts(id),
  provider_id      uuid REFERENCES users(id),
  client_id        uuid REFERENCES users(id),
  title            varchar(300) NOT NULL,
  description      text,
  scheduled_at     timestamptz,
  duration_minutes int DEFAULT 60,
  price            bigint NOT NULL,
  currency         varchar(10) DEFAULT 'BDT',
  commission_pct   decimal(5,2) DEFAULT 10,
  status           booking_status_enum DEFAULT 'pending',
  payment_status   payment_status_enum DEFAULT 'unpaid',
  payment_ref      varchar(255),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE transactions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        uuid REFERENCES bookings(id),
  payer_id          uuid REFERENCES users(id),
  payee_id          uuid REFERENCES users(id),
  gross_amount      bigint NOT NULL,
  commission_amount bigint NOT NULL,
  net_amount        bigint NOT NULL,
  currency          varchar(10) DEFAULT 'BDT',
  gateway           varchar(50),
  gateway_ref       varchar(255),
  status            varchar(30) DEFAULT 'completed',
  created_at        timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- REVIEWS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE reviews (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id   uuid REFERENCES bookings(id) UNIQUE,
  reviewer_id  uuid REFERENCES users(id),
  reviewee_id  uuid REFERENCES users(id),
  role_context user_role_enum,
  rating       int CHECK (rating BETWEEN 1 AND 5),
  comment      text,
  created_at   timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type_enum NOT NULL,
  title      varchar(200),
  body       text,
  data       jsonb DEFAULT '{}',
  is_read    boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- MONETIZATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE subscription_plans (
  id                  serial PRIMARY KEY,
  name                varchar(50) NOT NULL,
  price_monthly       bigint DEFAULT 0,
  price_yearly        bigint DEFAULT 0,
  features            jsonb DEFAULT '{}',
  post_boost_credits  int DEFAULT 0,
  max_posts_per_month int DEFAULT 5,
  can_feature_profile boolean DEFAULT false
);

INSERT INTO subscription_plans
  (name, price_monthly, price_yearly, post_boost_credits, max_posts_per_month, can_feature_profile)
VALUES
  ('Free',     0,      0,       0,  5,   false),
  ('Pro',      499,    4990,    5,  30,  false),
  ('Business', 1499,   14990,   20, 999, true);

CREATE TABLE user_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid REFERENCES users(id) ON DELETE CASCADE,
  plan_id             int REFERENCES subscription_plans(id),
  status              varchar(30) DEFAULT 'active',
  current_period_end  timestamptz,
  stripe_sub_id       varchar(255),
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE post_boosts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  boost_type  boost_type_enum DEFAULT 'featured',
  starts_at   timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  amount_paid bigint DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- MODERATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id  uuid REFERENCES users(id),
  target_type  report_target_enum NOT NULL,
  target_id    uuid NOT NULL,
  reason       varchar(100) NOT NULL,
  description  text,
  status       report_status_enum DEFAULT 'pending',
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE moderation_actions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    uuid REFERENCES users(id),
  target_type report_target_enum,
  target_id   uuid,
  action      varchar(50) NOT NULL,
  reason      text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE user_suspensions (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  suspended_until  timestamptz NOT NULL,
  reason           text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES (performance-critical — do not skip)
-- ═══════════════════════════════════════════════════════════════

-- Posts feed query (most common query in the app)
CREATE INDEX idx_posts_feed
  ON posts(section_id, status, is_boosted DESC, created_at DESC);

-- Posts by author (profile page)
CREATE INDEX idx_posts_author
  ON posts(author_id, status);

-- Full-text search on posts
CREATE INDEX idx_posts_fts
  ON posts USING GIN(fts);

-- Tag search on posts
CREATE INDEX idx_posts_tags
  ON posts USING GIN(tags);

-- Location-based post search
CREATE INDEX idx_posts_location
  ON posts(location_city, status);

-- Boosted post cleanup query
CREATE INDEX idx_posts_boost_expiry
  ON posts(is_boosted, boost_expires_at)
  WHERE is_boosted = true;

-- Chat — message pagination (most common chat query)
CREATE INDEX idx_messages_conv_created
  ON messages(conversation_id, created_at DESC);

-- Conversation participant lookup
CREATE INDEX idx_conv_participants_user
  ON conversation_participants(user_id);

-- Connection lookup both directions
CREATE INDEX idx_connections_requester
  ON connections(requester_id, status);
CREATE INDEX idx_connections_receiver
  ON connections(receiver_id, status);

-- Unread notification badge count
CREATE INDEX idx_notifications_unread
  ON notifications(user_id, is_read, created_at DESC);

-- User search by name
CREATE INDEX idx_profiles_name_trgm
  ON user_profiles USING GIN(display_name gin_trgm_ops);

-- User search by city
CREATE INDEX idx_profiles_location
  ON user_profiles(location_city, location_country);

-- Booking lookup for both sides
CREATE INDEX idx_bookings_provider
  ON bookings(provider_id, status);
CREATE INDEX idx_bookings_client
  ON bookings(client_id, status);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

-- user_profiles: anyone can read public profiles, only owner can update
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by all"
  ON user_profiles FOR SELECT
  USING (visibility = 'public' OR id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- posts: active posts readable by all; authors manage own
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active posts are public"
  ON posts FOR SELECT
  USING (status = 'active' OR author_id = auth.uid());

CREATE POLICY "Authors can insert own posts"
  ON posts FOR INSERT
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can update own posts"
  ON posts FOR UPDATE
  USING (author_id = auth.uid());

-- messages: only conversation participants
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can read messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- notifications: own only
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR ALL
  USING (user_id = auth.uid());

-- bookings: provider and client only
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Booking participants only"
  ON bookings FOR SELECT
  USING (provider_id = auth.uid() OR client_id = auth.uid());

CREATE POLICY "Clients can create bookings"
  ON bookings FOR INSERT
  WITH CHECK (client_id = auth.uid());

-- connections: involved users only
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Connection participants can view"
  ON connections FOR SELECT
  USING (requester_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send connection requests"
  ON connections FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- REALTIME PUBLICATION
-- Enable these tables to broadcast changes via Supabase Realtime.
-- You must ALSO toggle them ON in Dashboard → Database → Replication.
-- ═══════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE connections;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
