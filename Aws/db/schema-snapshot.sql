--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'active',
    'suspended',
    'deleted'
);


--
-- Name: actor_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.actor_role AS ENUM (
    'customer',
    'driver',
    'fleet_owner',
    'admin',
    'system'
);


--
-- Name: admin_sub_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_sub_role AS ENUM (
    'super_admin',
    'operations',
    'support',
    'finance'
);


--
-- Name: alert_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_severity AS ENUM (
    'info',
    'warning',
    'error'
);


--
-- Name: alert_subject_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_subject_type AS ENUM (
    'compliance_document',
    'truck',
    'payout'
);


--
-- Name: alert_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_type AS ENUM (
    'doc_expiring',
    'doc_expired',
    'truck_idle',
    'payout_failed'
);


--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'searching',
    'assigned',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'paid',
    'cancelled',
    'no_drivers_found',
    'disputed',
    'refunded'
);


--
-- Name: commission_band; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commission_band AS ENUM (
    'A',
    'B',
    'C'
);


--
-- Name: compliance_doc_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.compliance_doc_type AS ENUM (
    'insurance',
    'rc',
    'puc',
    'permit'
);


--
-- Name: compliance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.compliance_status AS ENUM (
    'valid',
    'expiring_soon',
    'expired'
);


--
-- Name: doc_review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.doc_review_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: driver_doc_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.driver_doc_type AS ENUM (
    'license',
    'rc',
    'gov_id',
    'inspection',
    'selfie'
);


--
-- Name: driver_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.driver_level AS ENUM (
    'bronze',
    'silver',
    'gold',
    'platinum'
);


--
-- Name: fleet_onboarding_step; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fleet_onboarding_step AS ENUM (
    'profile',
    'payout_account',
    'notifications',
    'done'
);


--
-- Name: fleet_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fleet_status AS ENUM (
    'pending',
    'active',
    'suspended'
);


--
-- Name: import_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.import_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


--
-- Name: kyc_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.kyc_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'incomplete',
    'suspended'
);


--
-- Name: otp_purpose; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.otp_purpose AS ENUM (
    'fleet_login',
    'driver_login',
    'customer_login',
    'booking_start',
    'admin_login'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'upi',
    'card',
    'cash',
    'wallet'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'authorized',
    'captured',
    'failed',
    'refunded'
);


--
-- Name: payout_account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_account_status AS ENUM (
    'unlinked',
    'pending',
    'active',
    'rejected',
    'suspended'
);


--
-- Name: payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_status AS ENUM (
    'requested',
    'processing',
    'paid',
    'failed'
);


--
-- Name: pricing_rule_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_rule_kind AS ENUM (
    'slab',
    'long_distance',
    'roadside'
);


--
-- Name: refund_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.refund_status AS ENUM (
    'pending',
    'processed',
    'failed'
);


--
-- Name: service_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_type AS ENUM (
    'tow',
    'battery',
    'flat_tyre',
    'fuel',
    'breakdown',
    'accident_recovery',
    'lockout',
    'winch_out'
);


--
-- Name: social_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.social_provider AS ENUM (
    'google',
    'apple'
);


--
-- Name: surge_band; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.surge_band AS ENUM (
    'standard',
    'high',
    'peak'
);


--
-- Name: truck_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.truck_status AS ENUM (
    'active',
    'inactive',
    'non_compliant'
);


--
-- Name: vehicle_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vehicle_class AS ENUM (
    'wheel_lift',
    'flatbed'
);


--
-- Name: wallet_owner_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.wallet_owner_type AS ENUM (
    'user',
    'driver',
    'fleet'
);


--
-- Name: wallet_txn_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.wallet_txn_type AS ENUM (
    'fare_credit',
    'commission_debit',
    'fleet_share_credit',
    'driver_share_credit',
    'payout_debit',
    'refund_debit',
    'refund_credit',
    'adjustment',
    'tax_debit',
    'cash_collected_debit',
    'wallet_spend_debit'
);


--
-- Name: bump_admin_authz_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_admin_authz_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."sub_role" IS DISTINCT FROM OLD."sub_role"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."password_hash" IS DISTINCT FROM OLD."password_hash" THEN
    NEW."authz_version" := OLD."authz_version" + 1;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text,
    full_address text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid,
    before jsonb,
    after jsonb,
    reason text,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    body text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_admin_notes_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text, 'fleet'::text, 'booking'::text, 'dispute'::text, 'sos_alert'::text, 'support_ticket'::text, 'truck'::text, 'payout'::text, 'deletion_request'::text])))
);


--
-- Name: admin_recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    mobile text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    sub_role public.admin_sub_role NOT NULL,
    status public.account_status DEFAULT 'active'::public.account_status NOT NULL,
    twofa_secret text,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    authz_version integer DEFAULT 1 NOT NULL,
    twofa_enabled boolean DEFAULT false NOT NULL,
    twofa_secret_enc text,
    twofa_confirmed_at timestamp with time zone,
    created_by uuid,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    receives_ops_alerts boolean DEFAULT false NOT NULL,
    twofa_last_counter integer,
    must_change_password boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_admin_users_twofa_secret CHECK (((twofa_enabled = false) OR (twofa_secret_enc IS NOT NULL)))
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fleet_id uuid NOT NULL,
    type public.alert_type NOT NULL,
    severity public.alert_severity NOT NULL,
    message text NOT NULL,
    href text NOT NULL,
    subject_type public.alert_subject_type NOT NULL,
    subject_id uuid NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_band_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_band_daily (
    day date NOT NULL,
    band public.commission_band NOT NULL,
    bookings_paid integer DEFAULT 0 NOT NULL,
    gmv_paise bigint DEFAULT 0 NOT NULL,
    commission_paise bigint DEFAULT 0 NOT NULL,
    driver_payout_paise bigint DEFAULT 0 NOT NULL
);


--
-- Name: analytics_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_daily (
    day date NOT NULL,
    bookings_created integer DEFAULT 0 NOT NULL,
    bookings_matched integer DEFAULT 0 NOT NULL,
    bookings_completed integer DEFAULT 0 NOT NULL,
    bookings_paid integer DEFAULT 0 NOT NULL,
    bookings_cancelled integer DEFAULT 0 NOT NULL,
    no_drivers_found integer DEFAULT 0 NOT NULL,
    gmv_paise bigint DEFAULT 0 NOT NULL,
    commission_paise bigint DEFAULT 0 NOT NULL,
    tax_paise bigint DEFAULT 0 NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    refunds_paise bigint DEFAULT 0 NOT NULL,
    aov_paise bigint DEFAULT 0 NOT NULL,
    take_rate_bps integer DEFAULT 0 NOT NULL,
    fill_rate_bps integer DEFAULT 0 NOT NULL,
    ttm_p50_s integer,
    ttm_p90_s integer,
    on_time_bps integer,
    active_drivers integer DEFAULT 0 NOT NULL,
    new_customers integer DEFAULT 0 NOT NULL,
    coupon_redemptions integer DEFAULT 0 NOT NULL,
    sos_alerts integer DEFAULT 0 NOT NULL,
    sos_ack_p95_s integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_demand_grid; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_demand_grid (
    day date NOT NULL,
    hour smallint NOT NULL,
    cell_lat numeric(6,2) NOT NULL,
    cell_lng numeric(6,2) NOT NULL,
    bookings integer DEFAULT 0 NOT NULL,
    no_drivers integer DEFAULT 0 NOT NULL,
    avg_wave numeric(4,1)
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    booking_id uuid,
    subject_type text,
    subject_id uuid,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_zone_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_zone_daily (
    day date NOT NULL,
    zone_id uuid NOT NULL,
    bookings_created integer DEFAULT 0 NOT NULL,
    bookings_matched integer DEFAULT 0 NOT NULL,
    no_drivers_found integer DEFAULT 0 NOT NULL,
    gmv_paise bigint DEFAULT 0 NOT NULL,
    commission_paise bigint DEFAULT 0 NOT NULL,
    ttm_p50_s integer
);


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    min_customer_version text DEFAULT '1.0.0'::text NOT NULL,
    min_driver_version text DEFAULT '1.0.0'::text NOT NULL,
    force_upgrade boolean DEFAULT false NOT NULL,
    sev_level text,
    sev_message text,
    sev_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    support_phone text DEFAULT '+911800123456'::text NOT NULL,
    support_email text DEFAULT 'support@mitow.in'::text NOT NULL,
    referrer_reward_paise integer DEFAULT 10000 NOT NULL,
    referee_reward_paise integer DEFAULT 10000 NOT NULL,
    CONSTRAINT ck_app_config_referee_reward_paise CHECK ((referee_reward_paise >= 0)),
    CONSTRAINT ck_app_config_referrer_reward_paise CHECK ((referrer_reward_paise >= 0)),
    CONSTRAINT ck_app_config_sev_level CHECK (((sev_level IS NULL) OR (sev_level = ANY (ARRAY['sev1'::text, 'sev2'::text, 'sev3'::text])))),
    CONSTRAINT ck_app_config_sev_message_length CHECK (((sev_message IS NULL) OR (length(sev_message) <= 500))),
    CONSTRAINT ck_app_config_sev_pair CHECK (((sev_level IS NULL) = (sev_message IS NULL))),
    CONSTRAINT ck_app_config_singleton CHECK (singleton)
);


--
-- Name: banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    image_key text NOT NULL,
    cta_link text,
    cta_label text,
    audience text DEFAULT 'customer'::text NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_banners_audience CHECK ((audience = ANY (ARRAY['customer'::text, 'driver'::text]))),
    CONSTRAINT ck_banners_window CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (starts_at < ends_at)))
);


--
-- Name: booking_location_path; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_location_path (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT ck_booking_messages_body CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000))),
    CONSTRAINT ck_booking_messages_sender_type CHECK ((sender_type = ANY (ARRAY['customer'::text, 'driver'::text])))
);


--
-- Name: booking_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    status public.booking_status NOT NULL,
    actor public.actor_role DEFAULT 'system'::public.actor_role NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    driver_id uuid,
    fleet_id uuid,
    zone_id uuid,
    service_type public.service_type NOT NULL,
    vehicle_class public.vehicle_class NOT NULL,
    pickup_lat double precision NOT NULL,
    pickup_lng double precision NOT NULL,
    pickup_address text,
    drop_lat double precision,
    drop_lng double precision,
    drop_address text,
    distance_km numeric(8,2),
    status public.booking_status DEFAULT 'searching'::public.booking_status NOT NULL,
    base_fare numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    distance_charge numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    night_charge numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    highway_charge numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    accident_charge numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    waiting_charge numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    surge_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    discount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    commission_band public.commission_band,
    commission_pct numeric(5,2),
    commission_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    driver_payout numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    otp_verified boolean DEFAULT false NOT NULL,
    otp_expires_at timestamp with time zone,
    share_token text,
    share_expires_at timestamp with time zone,
    cancelled_by public.actor_role,
    cancellation_reason text,
    cancellation_fee numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    unable_reason text,
    payment_id uuid,
    payment_method public.payment_method,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    booking_otp_hash text,
    otp_attempts integer DEFAULT 0 NOT NULL,
    truck_id uuid,
    search_wave integer,
    dispatch_deadline_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    contact_name text,
    contact_mobile text,
    note text,
    arrived_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    waiting_free_minutes integer,
    waiting_per_minute numeric(12,2),
    route_polyline text,
    route_drop_polyline text,
    route_source text,
    eta_seconds integer,
    eta_updated_at timestamp with time zone,
    tax_pct numeric(5,2) DEFAULT 0.00 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    coupon_id uuid,
    coupon_code text,
    invoice_key text,
    invoice_generated_at timestamp with time zone,
    paid_at timestamp with time zone,
    driver_compensation numeric(12,2) DEFAULT 0.00 NOT NULL,
    driver_pay_model text,
    driver_share_pct numeric(5,2),
    in_transit_at timestamp with time zone,
    CONSTRAINT ck_bookings_cancellation_fee_needs_cancel CHECK (((cancellation_fee = (0)::numeric) OR (cancelled_by IS NOT NULL))),
    CONSTRAINT ck_bookings_commission_pct_guardrail CHECK (((commission_pct IS NULL) OR ((commission_pct > (0)::numeric) AND (commission_pct <= (30)::numeric)))),
    CONSTRAINT ck_bookings_driver_pay_model CHECK (((driver_pay_model IS NULL) OR (driver_pay_model = ANY (ARRAY['independent'::text, 'share'::text, 'salary'::text])))),
    CONSTRAINT ck_bookings_driver_share_pct CHECK (((driver_share_pct IS NULL) OR ((driver_share_pct >= (0)::numeric) AND (driver_share_pct <= (100)::numeric)))),
    CONSTRAINT ck_bookings_non_negative CHECK (((total >= (0)::numeric) AND (commission_amount >= (0)::numeric) AND (driver_payout >= (0)::numeric) AND (discount >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (cancellation_fee >= (0)::numeric) AND (driver_compensation >= (0)::numeric))),
    CONSTRAINT ck_bookings_otp_attempts_non_negative CHECK ((otp_attempts >= 0)),
    CONSTRAINT ck_bookings_otp_verified_needs_hash CHECK (((otp_verified = false) OR (booking_otp_hash IS NOT NULL))),
    CONSTRAINT ck_bookings_payout_within_total CHECK ((((commission_amount + driver_payout) + tax_amount) <= total)),
    CONSTRAINT ck_bookings_route_source CHECK (((route_source IS NULL) OR (route_source = ANY (ARRAY['google_directions'::text, 'haversine'::text])))),
    CONSTRAINT ck_bookings_search_wave_positive CHECK (((search_wave IS NULL) OR (search_wave >= 1))),
    CONSTRAINT ck_bookings_tax_pct_range CHECK (((tax_pct >= (0)::numeric) AND (tax_pct <= (28)::numeric)))
);


--
-- Name: charge_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    night_pct numeric(5,2) DEFAULT 15.00 NOT NULL,
    night_start_hour integer DEFAULT 22 NOT NULL,
    night_end_hour integer DEFAULT 6 NOT NULL,
    highway_charge numeric(12,2) DEFAULT 500.00 NOT NULL,
    accident_charge numeric(12,2) DEFAULT 1500.00 NOT NULL,
    waiting_free_minutes integer DEFAULT 15 NOT NULL,
    waiting_per_minute numeric(12,2) DEFAULT 5.00 NOT NULL,
    surge_pct_high numeric(5,2) DEFAULT 10.00 NOT NULL,
    surge_pct_peak numeric(5,2) DEFAULT 25.00 NOT NULL,
    haversine_road_factor numeric(4,2) DEFAULT 1.30 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tax_pct numeric(5,2) DEFAULT 0.00 NOT NULL,
    tax_label text DEFAULT 'GST'::text NOT NULL,
    cancel_free_minutes integer DEFAULT 2 NOT NULL,
    cancel_partial_minutes integer DEFAULT 10 NOT NULL,
    cancel_partial_fee numeric(12,2) DEFAULT 150.00 NOT NULL,
    cancel_driver_comp_pct numeric(5,2) DEFAULT 50.00 NOT NULL,
    payout_auto_approve_max numeric(12,2) DEFAULT 100000.00 NOT NULL,
    CONSTRAINT ck_charge_config_cancel_amounts CHECK (((cancel_partial_fee >= (0)::numeric) AND (cancel_driver_comp_pct >= (0)::numeric) AND (cancel_driver_comp_pct <= (100)::numeric))),
    CONSTRAINT ck_charge_config_cancel_windows CHECK (((cancel_free_minutes >= 0) AND (cancel_partial_minutes >= cancel_free_minutes))),
    CONSTRAINT ck_charge_config_payout_threshold CHECK ((payout_auto_approve_max >= (0)::numeric)),
    CONSTRAINT ck_charge_config_ranges CHECK (((night_pct >= (0)::numeric) AND (night_pct <= (100)::numeric) AND (night_start_hour >= 0) AND (night_start_hour <= 23) AND (night_end_hour >= 0) AND (night_end_hour <= 23) AND (highway_charge >= (0)::numeric) AND (accident_charge >= (0)::numeric) AND (waiting_free_minutes >= 0) AND (waiting_free_minutes <= 120) AND (waiting_per_minute >= (0)::numeric) AND (surge_pct_high >= (0)::numeric) AND (surge_pct_high <= (100)::numeric) AND (surge_pct_peak >= (0)::numeric) AND (surge_pct_peak <= (100)::numeric) AND (haversine_road_factor >= (1)::numeric) AND (haversine_road_factor <= (3)::numeric))),
    CONSTRAINT ck_charge_config_singleton CHECK ((singleton = true)),
    CONSTRAINT ck_charge_config_tax_pct CHECK (((tax_pct >= (0)::numeric) AND (tax_pct <= (28)::numeric)))
);


--
-- Name: commission_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    band public.commission_band NOT NULL,
    pct numeric(5,2) NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_commission_config_guardrail CHECK (((pct > (0)::numeric) AND (pct <= (30)::numeric)))
);


--
-- Name: commission_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    band public.commission_band NOT NULL,
    old_pct numeric(5,2),
    new_pct numeric(5,2) NOT NULL,
    changed_by uuid,
    admin_action_id uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_guardrail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_guardrail (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    floor_pct numeric(5,2) NOT NULL,
    cap_pct numeric(5,2) NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_commission_guardrail_bounds CHECK (((floor_pct > (0)::numeric) AND (cap_pct <= (30)::numeric) AND (floor_pct < cap_pct))),
    CONSTRAINT ck_commission_guardrail_singleton CHECK (singleton)
);


--
-- Name: commission_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    band public.commission_band NOT NULL,
    pct numeric(5,2) NOT NULL,
    proposed_by uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    admin_action_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_commission_proposals_pct CHECK (((pct > (0)::numeric) AND (pct <= (30)::numeric))),
    CONSTRAINT ck_commission_proposals_reason CHECK ((length(reason) >= 3)),
    CONSTRAINT ck_commission_proposals_status CHECK ((status = ANY (ARRAY['open'::text, 'applied'::text, 'declined'::text])))
);


--
-- Name: compliance_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    truck_id uuid NOT NULL,
    doc_type public.compliance_doc_type NOT NULL,
    file_url text,
    issued_at timestamp with time zone,
    expires_at timestamp with time zone,
    alert_sent_30d boolean DEFAULT false NOT NULL,
    status public.compliance_status DEFAULT 'valid'::public.compliance_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    subject_type text NOT NULL,
    policy_type text NOT NULL,
    policy_version text NOT NULL,
    consented_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    action text DEFAULT 'granted'::text NOT NULL,
    CONSTRAINT ck_consent_records_action CHECK ((action = ANY (ARRAY['granted'::text, 'withdrawn'::text]))),
    CONSTRAINT ck_consent_records_policy_type CHECK ((policy_type = ANY (ARRAY['privacy_policy'::text, 'terms_of_service'::text]))),
    CONSTRAINT ck_consent_records_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: content_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    is_published boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_content_pages_kind CHECK ((kind = ANY (ARRAY['faq'::text, 'legal'::text])))
);


--
-- Name: coupon_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coupon_id uuid NOT NULL,
    user_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    discount_amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_coupon_redemptions_amount CHECK ((discount_amount > (0)::numeric))
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    kind text NOT NULL,
    value numeric(12,2) NOT NULL,
    max_discount numeric(12,2),
    min_order numeric(12,2) DEFAULT 0 NOT NULL,
    max_uses integer,
    max_uses_per_user integer DEFAULT 1 NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_coupons_kind CHECK ((kind = ANY (ARRAY['percent'::text, 'flat'::text]))),
    CONSTRAINT ck_coupons_percent_ceiling CHECK (((kind <> 'percent'::text) OR (value <= (100)::numeric))),
    CONSTRAINT ck_coupons_used_count CHECK ((used_count >= 0)),
    CONSTRAINT ck_coupons_value CHECK ((value > (0)::numeric)),
    CONSTRAINT ck_coupons_window CHECK (((starts_at IS NULL) OR (expires_at IS NULL) OR (expires_at > starts_at)))
);


--
-- Name: deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    subject_type text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    reason text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hold_reason text,
    decided_by uuid,
    decided_at timestamp with time zone,
    executed_at timestamp with time zone,
    anonymised_at timestamp with time zone,
    CONSTRAINT ck_deletion_requests_status CHECK ((status = ANY (ARRAY['requested'::text, 'on_hold'::text, 'approved'::text, 'executing'::text, 'completed'::text, 'rejected'::text]))),
    CONSTRAINT ck_deletion_requests_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    subject_type text NOT NULL,
    push_token text,
    platform text,
    app_version text,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    installation_id text NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    CONSTRAINT ck_devices_platform CHECK (((platform IS NULL) OR (platform = ANY (ARRAY['ios'::text, 'android'::text])))),
    CONSTRAINT ck_devices_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: dispatch_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    wave integer NOT NULL,
    radius_km numeric(6,2) NOT NULL,
    driver_id uuid,
    outcome text NOT NULL,
    offered_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT ck_dispatch_attempts_outcome CHECK ((outcome = ANY (ARRAY['offered'::text, 'accepted'::text, 'rejected'::text, 'expired'::text, 'revoked'::text, 'unable'::text, 'reassigned'::text])))
);


--
-- Name: dispatch_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    weight_proximity numeric(5,2) DEFAULT 60.00 NOT NULL,
    weight_rating numeric(5,2) DEFAULT 15.00 NOT NULL,
    weight_acceptance numeric(5,2) DEFAULT 15.00 NOT NULL,
    weight_completion numeric(5,2) DEFAULT 10.00 NOT NULL,
    stale_ping_seconds integer DEFAULT 15 NOT NULL,
    one_active_booking_per_customer boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    block_on_unpaid_balance boolean DEFAULT true NOT NULL,
    redispatch_priority text DEFAULT 'front'::text NOT NULL,
    ping_on_job_ms integer DEFAULT 3000 NOT NULL,
    ping_idle_ms integer DEFAULT 10000 NOT NULL,
    per_service_max_offers jsonb,
    CONSTRAINT ck_dispatch_config_per_service_offers_object CHECK (((per_service_max_offers IS NULL) OR (jsonb_typeof(per_service_max_offers) = 'object'::text))),
    CONSTRAINT ck_dispatch_config_ping_cadence CHECK (((ping_on_job_ms >= 1000) AND (ping_on_job_ms <= 300000) AND (ping_idle_ms >= 1000) AND (ping_idle_ms <= 300000))),
    CONSTRAINT ck_dispatch_config_ranges CHECK (((weight_proximity >= (0)::numeric) AND (weight_rating >= (0)::numeric) AND (weight_acceptance >= (0)::numeric) AND (weight_completion >= (0)::numeric) AND (stale_ping_seconds >= 5) AND (stale_ping_seconds <= 300))),
    CONSTRAINT ck_dispatch_config_redispatch_priority CHECK ((redispatch_priority = ANY (ARRAY['front'::text, 'normal'::text]))),
    CONSTRAINT ck_dispatch_config_singleton CHECK ((singleton = true)),
    CONSTRAINT ck_dispatch_config_weights_sum CHECK (((((weight_proximity + weight_rating) + weight_acceptance) + weight_completion) = (100)::numeric))
);


--
-- Name: dispatch_wave_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_wave_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    wave integer NOT NULL,
    radius_km numeric(6,2) NOT NULL,
    considered integer NOT NULL,
    eligible integer NOT NULL,
    offered integer NOT NULL,
    degraded boolean DEFAULT false NOT NULL,
    weights jsonb NOT NULL,
    config jsonb NOT NULL,
    excluded jsonb NOT NULL,
    candidates jsonb NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_ms integer NOT NULL
);


--
-- Name: dispute_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispute_id uuid NOT NULL,
    uploaded_by_type text NOT NULL,
    uploaded_by_id uuid,
    kind text NOT NULL,
    file_key text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_dispute_evidence_kind CHECK ((kind = ANY (ARRAY['photo'::text, 'document'::text]))),
    CONSTRAINT ck_dispute_evidence_uploaded_by_type CHECK ((uploaded_by_type = ANY (ARRAY['admin'::text, 'customer'::text, 'driver'::text])))
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    opened_by_type text NOT NULL,
    opened_by_id uuid,
    reason_code text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_from_status text NOT NULL,
    assigned_admin_id uuid,
    resolution text,
    refund_id uuid,
    refund_amount numeric(12,2),
    liability text,
    resolution_note text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_disputes_liability CHECK ((liability = ANY (ARRAY['shared'::text, 'platform'::text, 'provider'::text, 'driver'::text, 'fleet'::text]))),
    CONSTRAINT ck_disputes_opened_by_type CHECK ((opened_by_type = ANY (ARRAY['admin'::text, 'customer'::text, 'driver'::text]))),
    CONSTRAINT ck_disputes_opened_from_status CHECK ((opened_from_status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'paid'::text]))),
    CONSTRAINT ck_disputes_reason_code CHECK ((reason_code = ANY (ARRAY['service_not_completed'::text, 'vehicle_damage'::text, 'overcharge'::text, 'driver_conduct'::text, 'customer_conduct'::text, 'payment_issue'::text, 'unable_to_deliver'::text, 'other'::text]))),
    CONSTRAINT ck_disputes_refund_amount_positive CHECK (((refund_amount IS NULL) OR (refund_amount > (0)::numeric))),
    CONSTRAINT ck_disputes_resolution CHECK ((resolution = ANY (ARRAY['complete_and_charge'::text, 'cancel_no_charge'::text, 'uphold_charge'::text, 'full_refund'::text, 'partial_refund'::text]))),
    CONSTRAINT ck_disputes_status CHECK ((status = ANY (ARRAY['open'::text, 'under_review'::text, 'resolved'::text])))
);


--
-- Name: driver_document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    doc_type text NOT NULL,
    file_url text NOT NULL,
    status text NOT NULL,
    rejection_reason text,
    verified_by uuid,
    verified_at timestamp with time zone,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: driver_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    doc_type public.driver_doc_type NOT NULL,
    file_url text NOT NULL,
    status public.doc_review_status DEFAULT 'pending'::public.doc_review_status NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rejection_reason text,
    issued_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: driver_zone_restrictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_zone_restrictions (
    driver_id uuid NOT NULL,
    zone_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mobile text NOT NULL,
    name text,
    email text,
    photo_url text,
    fleet_id uuid,
    kyc_status public.kyc_status DEFAULT 'incomplete'::public.kyc_status NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    vehicle_class public.vehicle_class,
    long_distance_enabled boolean DEFAULT false NOT NULL,
    current_location public.geography(Point,4326),
    last_ping_at timestamp with time zone,
    rating numeric(2,1),
    total_trips integer DEFAULT 0 NOT NULL,
    acceptance_rate numeric(5,2),
    completion_rate numeric(5,2),
    level public.driver_level DEFAULT 'bronze'::public.driver_level NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_truck_id uuid,
    kyc_submitted_at timestamp with time zone,
    current_zone_id uuid,
    notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    pending_suspension_reason text,
    pending_suspension_by uuid,
    pending_suspension_at timestamp with time zone,
    suspended_at timestamp with time zone,
    suspended_by uuid,
    suspension_reason text,
    services public.service_type[] DEFAULT ARRAY[]::public.service_type[] NOT NULL,
    name_verified_at timestamp with time zone
);


--
-- Name: earnings_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.earnings_daily (
    fleet_id uuid NOT NULL,
    day date NOT NULL,
    driver_id uuid NOT NULL,
    jobs integer DEFAULT 0 NOT NULL,
    gross numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    commission numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    pool numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    driver_share numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    fleet_share numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emergency_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    relation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: erasure_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erasure_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_erasure_jobs_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT ck_erasure_jobs_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: fleet_driver_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_driver_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fleet_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    driver_share numeric(5,2) NOT NULL,
    fleet_share numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_fleet_driver_shares_sum_100 CHECK (((driver_share + fleet_share) = (100)::numeric))
);


--
-- Name: fleet_owner_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_owner_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fleet_trucks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_trucks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fleet_id uuid NOT NULL,
    type public.vehicle_class NOT NULL,
    plate text NOT NULL,
    capacity text,
    current_location public.geography(Point,4326),
    last_ping_at timestamp with time zone,
    status public.truck_status DEFAULT 'active'::public.truck_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    make text,
    model text
);


--
-- Name: fleets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    business_name text NOT NULL,
    gstin text,
    address text,
    status public.fleet_status DEFAULT 'pending'::public.fleet_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    onboarding_step public.fleet_onboarding_step DEFAULT 'profile'::public.fleet_onboarding_step NOT NULL,
    profile_completed_at timestamp with time zone,
    suspended_at timestamp with time zone,
    suspended_by uuid,
    suspension_reason text,
    driver_pay_model text DEFAULT 'share'::text NOT NULL,
    driver_share_pct numeric(5,2) DEFAULT 80 NOT NULL,
    CONSTRAINT ck_fleets_driver_pay_model CHECK ((driver_pay_model = ANY (ARRAY['share'::text, 'salary'::text]))),
    CONSTRAINT ck_fleets_driver_share_pct CHECK (((driver_share_pct >= (0)::numeric) AND (driver_share_pct <= (100)::numeric))),
    CONSTRAINT ck_fleets_notification_prefs_object CHECK ((jsonb_typeof(notification_prefs) = 'object'::text)),
    CONSTRAINT ck_fleets_profile_completed_requires_address CHECK (((profile_completed_at IS NULL) OR ((address IS NOT NULL) AND (length(btrim(address)) > 0))))
);


--
-- Name: impersonation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impersonation_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    reason text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: login_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    realm text NOT NULL,
    otp_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subject_type text NOT NULL,
    CONSTRAINT ck_login_challenges_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text, 'admin'::text])))
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    recipient_key text NOT NULL,
    channel text NOT NULL,
    device_id uuid,
    destination text,
    status text DEFAULT 'queued'::text NOT NULL,
    skip_reason text,
    vendor text,
    vendor_ref text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_notification_deliveries_channel CHECK ((channel = ANY (ARRAY['push'::text, 'sms'::text, 'whatsapp'::text, 'email'::text]))),
    CONSTRAINT ck_notification_deliveries_destination CHECK (((status = 'skipped'::text) OR (destination IS NOT NULL))),
    CONSTRAINT ck_notification_deliveries_skip_reason CHECK (((skip_reason IS NULL) OR (skip_reason = ANY (ARRAY['no_address'::text, 'no_push_target'::text, 'suppressed_by_pref'::text, 'notifications_disabled'::text])))),
    CONSTRAINT ck_notification_deliveries_status CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    dedupe_key text,
    fanned_out_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    subject_type text NOT NULL,
    event_id uuid NOT NULL,
    event text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_notifications_category CHECK ((category = ANY (ARRAY['transactional'::text, 'safety'::text, 'job'::text, 'money'::text, 'promotions'::text, 'compliance'::text]))),
    CONSTRAINT ck_notifications_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text, 'fleet'::text])))
);


--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    purpose public.otp_purpose NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    gateway_ref text,
    amount numeric(12,2) NOT NULL,
    method public.payment_method NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    captured_at timestamp with time zone,
    failure_reason text,
    provider text,
    gateway_order_ref text,
    purpose text DEFAULT 'booking'::text NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    refunded_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    wallet_applied numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    CONSTRAINT ck_payments_amount_positive CHECK (((amount >= (0)::numeric) AND ((amount + wallet_applied) > (0)::numeric))),
    CONSTRAINT ck_payments_purpose CHECK ((purpose = ANY (ARRAY['booking'::text, 'cancellation_fee'::text]))),
    CONSTRAINT ck_payments_refunded_within_amount CHECK (((refunded_amount >= (0)::numeric) AND (refunded_amount <= amount))),
    CONSTRAINT ck_payments_wallet_applied CHECK ((wallet_applied >= (0)::numeric))
);


--
-- Name: payout_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    owner_type public.wallet_owner_type NOT NULL,
    status public.payout_account_status DEFAULT 'unlinked'::public.payout_account_status NOT NULL,
    route_account_id text,
    route_fund_account_id text,
    beneficiary_name text,
    account_number_last4 text,
    account_number_fingerprint text,
    ifsc text,
    bank_name text,
    failure_reason text,
    linked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_payout_accounts_active_has_destination CHECK (((status <> 'active'::public.payout_account_status) OR (route_fund_account_id IS NOT NULL))),
    CONSTRAINT ck_payout_accounts_ifsc CHECK (((ifsc IS NULL) OR (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'::text)))
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    owner_type public.wallet_owner_type NOT NULL,
    amount numeric(12,2) NOT NULL,
    route_ref text,
    status public.payout_status DEFAULT 'requested'::public.payout_status NOT NULL,
    idempotency_key text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    failure_reason text,
    provider text,
    last_synced_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approval_state text DEFAULT 'auto_approved'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    CONSTRAINT ck_payouts_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT ck_payouts_approval_state CHECK ((approval_state = ANY (ARRAY['auto_approved'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: pricing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_kind public.pricing_rule_kind NOT NULL,
    service_type public.service_type,
    vehicle_class public.vehicle_class,
    max_km numeric(8,2),
    price numeric(12,2) NOT NULL,
    price_max numeric(12,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_pricing_rules_max_km_positive CHECK (((max_km IS NULL) OR (max_km > (0)::numeric))),
    CONSTRAINT ck_pricing_rules_non_negative CHECK (((price >= (0)::numeric) AND ((price_max IS NULL) OR (price_max >= (0)::numeric)))),
    CONSTRAINT ck_pricing_rules_price_range CHECK (((price_max IS NULL) OR (price_max >= price))),
    CONSTRAINT ck_pricing_rules_shape CHECK ((((rule_kind = 'slab'::public.pricing_rule_kind) AND (vehicle_class IS NOT NULL) AND (max_km IS NOT NULL) AND (service_type IS NULL) AND (price_max IS NULL)) OR ((rule_kind = 'long_distance'::public.pricing_rule_kind) AND (vehicle_class IS NOT NULL) AND (max_km IS NOT NULL) AND (service_type IS NULL) AND (price_max IS NOT NULL)) OR ((rule_kind = 'roadside'::public.pricing_rule_kind) AND (service_type IS NOT NULL) AND (vehicle_class IS NULL) AND (max_km IS NULL) AND (price_max IS NULL))))
);


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    service_slug text NOT NULL,
    vehicle_class text NOT NULL,
    pickup_lat double precision NOT NULL,
    pickup_lng double precision NOT NULL,
    pickup_address text,
    drop_lat double precision,
    drop_lng double precision,
    drop_address text,
    distance_km numeric(8,2) NOT NULL,
    notes text,
    total_paise bigint,
    breakdown jsonb,
    commission_pct numeric(5,2),
    commission_paise bigint,
    driver_payout_paise bigint,
    quoted_by uuid,
    quoted_at timestamp with time zone,
    valid_until timestamp with time zone,
    rejection_reason text,
    decided_at timestamp with time zone,
    booking_id uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_quotes_amounts CHECK (((status = ANY (ARRAY['requested'::text, 'rejected'::text, 'expired'::text])) OR ((total_paise IS NOT NULL) AND (commission_pct IS NOT NULL)))),
    CONSTRAINT ck_quotes_status CHECK ((status = ANY (ARRAY['requested'::text, 'quoted'::text, 'accepted'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    user_id uuid NOT NULL,
    direction text NOT NULL,
    rating integer NOT NULL,
    review text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_ratings_direction CHECK ((direction = ANY (ARRAY['customer_to_driver'::text, 'driver_to_customer'::text]))),
    CONSTRAINT ck_ratings_value CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: referral_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_codes (
    user_id uuid NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: referral_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_user_id uuid NOT NULL,
    referee_user_id uuid NOT NULL,
    code text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    rewarded_booking_id uuid,
    rewarded_at timestamp with time zone,
    referrer_reward_paise integer,
    referee_reward_paise integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_referral_redemptions_not_self CHECK ((referrer_user_id <> referee_user_id)),
    CONSTRAINT ck_referral_redemptions_status CHECK ((status = ANY (ARRAY['pending'::text, 'rewarded'::text])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    realm text NOT NULL,
    fleet_id uuid,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    rotated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_reason text,
    user_agent text,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    reason text,
    gateway_ref text,
    status public.refund_status DEFAULT 'pending'::public.refund_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    failure_reason text,
    initiated_by text DEFAULT 'system'::text NOT NULL,
    dispute_id uuid,
    kind text DEFAULT 'full'::text NOT NULL,
    payment_id uuid,
    liability text,
    cause text,
    delivery text DEFAULT 'original'::text NOT NULL,
    provider_share numeric(12,2),
    bearer_override_reason text,
    CONSTRAINT ck_refunds_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT ck_refunds_cause CHECK (((cause IS NULL) OR (cause = ANY (ARRAY['fare_error'::text, 'platform_error'::text, 'goodwill'::text, 'driver_misconduct'::text])))),
    CONSTRAINT ck_refunds_delivery CHECK ((delivery = ANY (ARRAY['original'::text, 'wallet'::text]))),
    CONSTRAINT ck_refunds_kind CHECK ((kind = ANY (ARRAY['full'::text, 'partial'::text]))),
    CONSTRAINT ck_refunds_liability CHECK (((liability IS NULL) OR (liability = ANY (ARRAY['shared'::text, 'platform'::text, 'provider'::text, 'driver'::text, 'fleet'::text])))),
    CONSTRAINT ck_refunds_provider_share CHECK (((provider_share IS NULL) OR ((provider_share >= (0)::numeric) AND (provider_share <= amount))))
);


--
-- Name: retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    policy_key text NOT NULL,
    retention_days integer NOT NULL,
    description text NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    make_model text,
    plate text,
    rc_url text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_zone_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_zone_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid NOT NULL,
    version integer NOT NULL,
    area_geojson jsonb NOT NULL,
    surge_band public.surge_band NOT NULL,
    is_highway boolean NOT NULL,
    is_active boolean NOT NULL,
    dispatch_config jsonb,
    changed_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    area public.geography(Polygon,4326) NOT NULL,
    surge_band public.surge_band DEFAULT 'standard'::public.surge_band NOT NULL,
    is_highway boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    dispatch_config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text NOT NULL,
    notes text,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_service_zones_area_valid CHECK (public.st_isvalid((area)::public.geometry)),
    CONSTRAINT ck_service_zones_dispatch_config_object CHECK (((dispatch_config IS NULL) OR (jsonb_typeof(dispatch_config) = 'object'::text)))
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    service_type public.service_type NOT NULL,
    default_vehicle_class public.vehicle_class,
    name text NOT NULL,
    description text NOT NULL,
    requires_drop boolean DEFAULT false NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_services_display_order CHECK ((display_order >= 0))
);


--
-- Name: social_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.social_provider NOT NULL,
    provider_subject text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    email text,
    email_verified boolean DEFAULT false NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_social_identities_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: sos_alert_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_alert_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_id uuid NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    relation text,
    notified_channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sos_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_alert_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_id uuid NOT NULL,
    kind text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    note text,
    data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_sos_alert_events_actor_type CHECK ((actor_type = ANY (ARRAY['subject'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT ck_sos_alert_events_kind CHECK ((kind = ANY (ARRAY['triggered'::text, 'contacts_notified'::text, 'ops_alerted'::text, 'acknowledged'::text, 'contacted'::text, 'note'::text, 'broadcast'::text, 'resolved'::text, 'cancelled'::text])))
);


--
-- Name: sos_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    booking_id uuid,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m double precision,
    source text NOT NULL,
    status text DEFAULT 'triggered'::text NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_sos_alerts_ack_pair CHECK (((acknowledged_at IS NULL) = (acknowledged_by IS NULL))),
    CONSTRAINT ck_sos_alerts_resolve_pair CHECK (((resolved_at IS NULL) = (resolved_by IS NULL))),
    CONSTRAINT ck_sos_alerts_source CHECK ((source = ANY (ARRAY['app'::text, 'ops'::text, 'sms_fallback'::text]))),
    CONSTRAINT ck_sos_alerts_status CHECK ((status = ANY (ARRAY['triggered'::text, 'acknowledged'::text, 'resolved'::text, 'cancelled'::text]))),
    CONSTRAINT ck_sos_alerts_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text])))
);


--
-- Name: support_ticket_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    kind text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_support_ticket_events_actor_type CHECK ((actor_type = ANY (ARRAY['requester'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT ck_support_ticket_events_kind CHECK ((kind = ANY (ARRAY['created'::text, 'assigned'::text, 'status_changed'::text, 'message'::text, 'note'::text, 'linked_booking'::text])))
);


--
-- Name: support_ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    author_type text NOT NULL,
    author_id uuid,
    body text NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_support_ticket_messages_author_type CHECK ((author_type = ANY (ARRAY['requester'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT ck_support_ticket_messages_visibility CHECK ((visibility = ANY (ARRAY['public'::text, 'internal'::text])))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    requester_type text NOT NULL,
    requester_id uuid NOT NULL,
    booking_id uuid,
    category text NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    assigned_admin_id uuid,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_support_tickets_category CHECK ((category = ANY (ARRAY['booking'::text, 'payment'::text, 'kyc'::text, 'app'::text, 'safety'::text, 'other'::text]))),
    CONSTRAINT ck_support_tickets_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT ck_support_tickets_requester_type CHECK ((requester_type = ANY (ARRAY['user'::text, 'driver'::text, 'fleet'::text]))),
    CONSTRAINT ck_support_tickets_status CHECK ((status = ANY (ARRAY['open'::text, 'pending_requester'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: suspension_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suspension_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_suspension_requests_status CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT ck_suspension_requests_subject_type CHECK ((subject_type = ANY (ARRAY['user'::text, 'driver'::text, 'fleet'::text])))
);


--
-- Name: truck_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.truck_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fleet_id uuid NOT NULL,
    filename text,
    status public.import_status DEFAULT 'pending'::public.import_status NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    imported_rows integer DEFAULT 0 NOT NULL,
    failed_rows integer DEFAULT 0 NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    payload text,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mobile text NOT NULL,
    name text,
    email text,
    photo_url text,
    default_lat double precision,
    default_lng double precision,
    status public.account_status DEFAULT 'active'::public.account_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    suspended_at timestamp with time zone,
    suspended_by uuid,
    suspension_reason text,
    language text,
    appearance text,
    CONSTRAINT ck_users_appearance CHECK (((appearance IS NULL) OR (appearance = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])))),
    CONSTRAINT ck_users_language CHECK (((language IS NULL) OR (language = ANY (ARRAY['en'::text, 'hi'::text, 'kn'::text, 'ta'::text, 'te'::text, 'ml'::text, 'mr'::text, 'bn'::text]))))
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    type public.wallet_txn_type NOT NULL,
    amount numeric(12,2) NOT NULL,
    reason text,
    ref_id uuid,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_wallet_transactions_amount_nonzero CHECK ((amount <> (0)::numeric))
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    owner_type public.wallet_owner_type NOT NULL,
    balance numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error text
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: admin_notes admin_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notes
    ADD CONSTRAINT admin_notes_pkey PRIMARY KEY (id);


--
-- Name: admin_recovery_codes admin_recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_recovery_codes
    ADD CONSTRAINT admin_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_unique UNIQUE (email);


--
-- Name: admin_users admin_users_mobile_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_mobile_unique UNIQUE (mobile);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: analytics_band_daily analytics_band_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_band_daily
    ADD CONSTRAINT analytics_band_daily_pkey PRIMARY KEY (day, band);


--
-- Name: analytics_daily analytics_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_daily
    ADD CONSTRAINT analytics_daily_pkey PRIMARY KEY (day);


--
-- Name: analytics_demand_grid analytics_demand_grid_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_demand_grid
    ADD CONSTRAINT analytics_demand_grid_pkey PRIMARY KEY (day, hour, cell_lat, cell_lng);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_zone_daily analytics_zone_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_zone_daily
    ADD CONSTRAINT analytics_zone_daily_pkey PRIMARY KEY (day, zone_id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_singleton_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_singleton_unique UNIQUE (singleton);


--
-- Name: banners banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


--
-- Name: booking_location_path booking_location_path_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_location_path
    ADD CONSTRAINT booking_location_path_pkey PRIMARY KEY (id);


--
-- Name: booking_messages booking_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_pkey PRIMARY KEY (id);


--
-- Name: booking_status_history booking_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: charge_config charge_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_config
    ADD CONSTRAINT charge_config_pkey PRIMARY KEY (id);


--
-- Name: charge_config charge_config_singleton_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_config
    ADD CONSTRAINT charge_config_singleton_unique UNIQUE (singleton);


--
-- Name: commission_config commission_config_band_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_config
    ADD CONSTRAINT commission_config_band_unique UNIQUE (band);


--
-- Name: commission_config_history commission_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_config_history
    ADD CONSTRAINT commission_config_history_pkey PRIMARY KEY (id);


--
-- Name: commission_config commission_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_config
    ADD CONSTRAINT commission_config_pkey PRIMARY KEY (id);


--
-- Name: commission_guardrail commission_guardrail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_guardrail
    ADD CONSTRAINT commission_guardrail_pkey PRIMARY KEY (id);


--
-- Name: commission_guardrail commission_guardrail_singleton_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_guardrail
    ADD CONSTRAINT commission_guardrail_singleton_unique UNIQUE (singleton);


--
-- Name: commission_proposals commission_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_proposals
    ADD CONSTRAINT commission_proposals_pkey PRIMARY KEY (id);


--
-- Name: compliance_documents compliance_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_documents
    ADD CONSTRAINT compliance_documents_pkey PRIMARY KEY (id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: content_pages content_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pages
    ADD CONSTRAINT content_pages_pkey PRIMARY KEY (id);


--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: deletion_requests deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: dispatch_attempts dispatch_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_attempts
    ADD CONSTRAINT dispatch_attempts_pkey PRIMARY KEY (id);


--
-- Name: dispatch_config dispatch_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_config
    ADD CONSTRAINT dispatch_config_pkey PRIMARY KEY (id);


--
-- Name: dispatch_config dispatch_config_singleton_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_config
    ADD CONSTRAINT dispatch_config_singleton_unique UNIQUE (singleton);


--
-- Name: dispatch_wave_logs dispatch_wave_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_wave_logs
    ADD CONSTRAINT dispatch_wave_logs_pkey PRIMARY KEY (id);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: driver_document_versions driver_document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_document_versions
    ADD CONSTRAINT driver_document_versions_pkey PRIMARY KEY (id);


--
-- Name: driver_documents driver_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);


--
-- Name: driver_zone_restrictions driver_zone_restrictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_zone_restrictions
    ADD CONSTRAINT driver_zone_restrictions_pkey PRIMARY KEY (driver_id, zone_id);


--
-- Name: drivers drivers_mobile_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_mobile_unique UNIQUE (mobile);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: earnings_daily earnings_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_daily
    ADD CONSTRAINT earnings_daily_pkey PRIMARY KEY (fleet_id, day, driver_id);


--
-- Name: emergency_contacts emergency_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_contacts
    ADD CONSTRAINT emergency_contacts_pkey PRIMARY KEY (id);


--
-- Name: erasure_jobs erasure_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_jobs
    ADD CONSTRAINT erasure_jobs_pkey PRIMARY KEY (id);


--
-- Name: fleet_driver_shares fleet_driver_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_driver_shares
    ADD CONSTRAINT fleet_driver_shares_pkey PRIMARY KEY (id);


--
-- Name: fleet_owner_credentials fleet_owner_credentials_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_owner_credentials
    ADD CONSTRAINT fleet_owner_credentials_email_unique UNIQUE (email);


--
-- Name: fleet_owner_credentials fleet_owner_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_owner_credentials
    ADD CONSTRAINT fleet_owner_credentials_pkey PRIMARY KEY (id);


--
-- Name: fleet_owner_credentials fleet_owner_credentials_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_owner_credentials
    ADD CONSTRAINT fleet_owner_credentials_user_id_unique UNIQUE (user_id);


--
-- Name: fleet_trucks fleet_trucks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_trucks
    ADD CONSTRAINT fleet_trucks_pkey PRIMARY KEY (id);


--
-- Name: fleets fleets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleets
    ADD CONSTRAINT fleets_pkey PRIMARY KEY (id);


--
-- Name: impersonation_sessions impersonation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_pkey PRIMARY KEY (id);


--
-- Name: login_challenges login_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_challenges
    ADD CONSTRAINT login_challenges_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payout_accounts payout_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: pricing_rules pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: referral_codes referral_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_pkey PRIMARY KEY (user_id);


--
-- Name: referral_redemptions referral_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: retention_policies retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_pkey PRIMARY KEY (id);


--
-- Name: saved_vehicles saved_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_vehicles
    ADD CONSTRAINT saved_vehicles_pkey PRIMARY KEY (id);


--
-- Name: service_zone_versions service_zone_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zone_versions
    ADD CONSTRAINT service_zone_versions_pkey PRIMARY KEY (id);


--
-- Name: service_zones service_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zones
    ADD CONSTRAINT service_zones_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: social_identities social_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_identities
    ADD CONSTRAINT social_identities_pkey PRIMARY KEY (id);


--
-- Name: sos_alert_contacts sos_alert_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alert_contacts
    ADD CONSTRAINT sos_alert_contacts_pkey PRIMARY KEY (id);


--
-- Name: sos_alert_events sos_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alert_events
    ADD CONSTRAINT sos_alert_events_pkey PRIMARY KEY (id);


--
-- Name: sos_alerts sos_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_events support_ticket_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_events
    ADD CONSTRAINT support_ticket_events_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_messages support_ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: suspension_requests suspension_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspension_requests
    ADD CONSTRAINT suspension_requests_pkey PRIMARY KEY (id);


--
-- Name: truck_imports truck_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.truck_imports
    ADD CONSTRAINT truck_imports_pkey PRIMARY KEY (id);


--
-- Name: fleet_driver_shares uq_fleet_driver_shares_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_driver_shares
    ADD CONSTRAINT uq_fleet_driver_shares_pair UNIQUE (fleet_id, driver_id);


--
-- Name: payments uq_payments_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT uq_payments_idempotency_key UNIQUE (idempotency_key);


--
-- Name: payout_accounts uq_payout_accounts_owner; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT uq_payout_accounts_owner UNIQUE (owner_type, owner_id);


--
-- Name: payouts uq_payouts_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT uq_payouts_idempotency_key UNIQUE (idempotency_key);


--
-- Name: service_zone_versions uq_service_zone_versions_zone_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zone_versions
    ADD CONSTRAINT uq_service_zone_versions_zone_version UNIQUE (zone_id, version);


--
-- Name: service_zones uq_service_zones_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zones
    ADD CONSTRAINT uq_service_zones_code UNIQUE (code);


--
-- Name: social_identities uq_social_identities_provider_subject; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_identities
    ADD CONSTRAINT uq_social_identities_provider_subject UNIQUE (provider, provider_subject, subject_type);


--
-- Name: wallet_transactions uq_wallet_transactions_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT uq_wallet_transactions_idempotency_key UNIQUE (idempotency_key);


--
-- Name: wallets uq_wallets_owner; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT uq_wallets_owner UNIQUE (owner_type, owner_id);


--
-- Name: webhook_events uq_webhook_events_provider_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT uq_webhook_events_provider_event UNIQUE (provider, event_id);


--
-- Name: users users_mobile_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_mobile_unique UNIQUE (mobile);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: idx_addresses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_user ON public.addresses USING btree (user_id);


--
-- Name: idx_admin_actions_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_admin ON public.admin_actions USING btree (admin_id, created_at DESC NULLS LAST);


--
-- Name: idx_admin_actions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_created ON public.admin_actions USING btree (created_at DESC NULLS LAST, id DESC);


--
-- Name: idx_admin_actions_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_subject ON public.admin_actions USING btree (subject_type, subject_id, created_at DESC NULLS LAST);


--
-- Name: idx_admin_notes_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notes_subject ON public.admin_notes USING btree (subject_type, subject_id, created_at DESC NULLS LAST);


--
-- Name: idx_admin_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_status ON public.admin_users USING btree (status);


--
-- Name: idx_alerts_feed_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_feed_open ON public.alerts USING btree (fleet_id, created_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (resolved_at IS NULL);


--
-- Name: idx_alerts_fleet_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_fleet_open ON public.alerts USING btree (fleet_id, created_at DESC NULLS LAST);


--
-- Name: idx_analytics_events_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_booking ON public.analytics_events USING btree (booking_id);


--
-- Name: idx_analytics_events_name_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_name_time ON public.analytics_events USING btree (name, occurred_at);


--
-- Name: idx_banners_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banners_live ON public.banners USING btree (audience, sort_order) WHERE is_active;


--
-- Name: idx_booking_location_path_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_location_path_booking ON public.booking_location_path USING btree (booking_id, recorded_at);


--
-- Name: idx_booking_messages_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_messages_booking ON public.booking_messages USING btree (booking_id, created_at);


--
-- Name: idx_booking_status_history_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_status_history_booking ON public.booking_status_history USING btree (booking_id, created_at);


--
-- Name: idx_bookings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_created_at ON public.bookings USING btree (created_at DESC NULLS LAST);


--
-- Name: idx_bookings_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_driver ON public.bookings USING btree (driver_id);


--
-- Name: idx_bookings_driver_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_driver_active ON public.bookings USING btree (driver_id) WHERE (status = ANY (ARRAY['assigned'::public.booking_status, 'en_route'::public.booking_status, 'arrived'::public.booking_status, 'in_progress'::public.booking_status]));


--
-- Name: idx_bookings_driver_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_driver_feed ON public.bookings USING btree (driver_id, created_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (driver_id IS NOT NULL);


--
-- Name: idx_bookings_driver_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_driver_outcome ON public.bookings USING btree (driver_id, updated_at DESC NULLS LAST) WHERE (driver_id IS NOT NULL);


--
-- Name: idx_bookings_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_fleet ON public.bookings USING btree (fleet_id);


--
-- Name: idx_bookings_fleet_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_fleet_feed ON public.bookings USING btree (fleet_id, created_at DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: idx_bookings_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_paid_at ON public.bookings USING btree (paid_at DESC NULLS LAST) WHERE (status = 'paid'::public.booking_status);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_bookings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user ON public.bookings USING btree (user_id);


--
-- Name: idx_bookings_user_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user_feed ON public.bookings USING btree (user_id, created_at DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: idx_bookings_zone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_zone_created ON public.bookings USING btree (zone_id, created_at DESC NULLS LAST);


--
-- Name: idx_commission_history_band; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_history_band ON public.commission_config_history USING btree (band, created_at DESC NULLS LAST);


--
-- Name: idx_commission_proposals_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_proposals_status_created ON public.commission_proposals USING btree (status, created_at DESC NULLS LAST);


--
-- Name: idx_compliance_documents_active_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_documents_active_expiry ON public.compliance_documents USING btree (expires_at) WHERE ((status <> 'expired'::public.compliance_status) AND (expires_at IS NOT NULL));


--
-- Name: idx_compliance_documents_truck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_documents_truck ON public.compliance_documents USING btree (truck_id);


--
-- Name: idx_consent_records_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_subject ON public.consent_records USING btree (subject_type, subject_id);


--
-- Name: idx_consent_records_subject_policy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_subject_policy ON public.consent_records USING btree (subject_id, subject_type, policy_type, consented_at DESC);


--
-- Name: idx_content_pages_kind_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_pages_kind_order ON public.content_pages USING btree (kind, sort_order);


--
-- Name: idx_coupon_redemptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_redemptions_user ON public.coupon_redemptions USING btree (coupon_id, user_id);


--
-- Name: idx_deletion_requests_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deletion_requests_subject ON public.deletion_requests USING btree (subject_type, subject_id);


--
-- Name: idx_devices_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_subject ON public.devices USING btree (subject_type, subject_id);


--
-- Name: idx_dispatch_attempts_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_attempts_booking ON public.dispatch_attempts USING btree (booking_id, wave);


--
-- Name: idx_dispatch_attempts_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_attempts_driver ON public.dispatch_attempts USING btree (driver_id, offered_at DESC NULLS LAST);


--
-- Name: idx_dispatch_wave_logs_booking_wave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_wave_logs_booking_wave ON public.dispatch_wave_logs USING btree (booking_id, wave);


--
-- Name: idx_dispatch_wave_logs_ran_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_wave_logs_ran_at ON public.dispatch_wave_logs USING btree (ran_at);


--
-- Name: idx_dispute_evidence_dispute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispute_evidence_dispute ON public.dispute_evidence USING btree (dispute_id, created_at);


--
-- Name: idx_disputes_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_booking ON public.disputes USING btree (booking_id);


--
-- Name: idx_disputes_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_status_created ON public.disputes USING btree (status, created_at DESC NULLS LAST);


--
-- Name: idx_driver_document_versions_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_document_versions_driver ON public.driver_document_versions USING btree (driver_id, created_at DESC NULLS LAST);


--
-- Name: idx_driver_documents_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_documents_driver ON public.driver_documents USING btree (driver_id);


--
-- Name: idx_drivers_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_fleet ON public.drivers USING btree (fleet_id);


--
-- Name: idx_drivers_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_geo ON public.drivers USING gist (current_location);


--
-- Name: idx_drivers_mobile_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_mobile_trgm ON public.drivers USING gin (mobile public.gin_trgm_ops);


--
-- Name: idx_drivers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_name_trgm ON public.drivers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_drivers_online_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_online_geo ON public.drivers USING gist (current_location) WHERE (is_online AND (kyc_status = 'approved'::public.kyc_status) AND (current_location IS NOT NULL));


--
-- Name: idx_drivers_services; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_services ON public.drivers USING gin (services);


--
-- Name: idx_drivers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_status ON public.drivers USING btree (kyc_status, is_online);


--
-- Name: idx_drivers_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_zone ON public.drivers USING btree (current_zone_id) WHERE (is_online AND (current_zone_id IS NOT NULL));


--
-- Name: idx_earnings_daily_fleet_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_daily_fleet_day ON public.earnings_daily USING btree (fleet_id, day DESC NULLS LAST);


--
-- Name: idx_emergency_contacts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emergency_contacts_user ON public.emergency_contacts USING btree (user_id);


--
-- Name: idx_erasure_jobs_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erasure_jobs_request ON public.erasure_jobs USING btree (request_id);


--
-- Name: idx_erasure_jobs_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erasure_jobs_subject ON public.erasure_jobs USING btree (subject_type, subject_id);


--
-- Name: idx_fleet_driver_shares_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_driver_shares_fleet ON public.fleet_driver_shares USING btree (fleet_id);


--
-- Name: idx_fleet_owner_credentials_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_owner_credentials_email ON public.fleet_owner_credentials USING btree (email);


--
-- Name: idx_fleet_trucks_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_trucks_fleet ON public.fleet_trucks USING btree (fleet_id);


--
-- Name: idx_fleet_trucks_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_trucks_geo ON public.fleet_trucks USING gist (current_location);


--
-- Name: idx_fleet_trucks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_trucks_status ON public.fleet_trucks USING btree (fleet_id, status);


--
-- Name: idx_fleets_business_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleets_business_name_trgm ON public.fleets USING gin (business_name public.gin_trgm_ops);


--
-- Name: idx_fleets_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleets_owner ON public.fleets USING btree (owner_id);


--
-- Name: idx_fleets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleets_status ON public.fleets USING btree (status);


--
-- Name: idx_impersonation_sessions_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_sessions_subject ON public.impersonation_sessions USING btree (subject_type, subject_id, started_at DESC NULLS LAST);


--
-- Name: idx_login_challenges_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_challenges_subject ON public.login_challenges USING btree (subject_type, subject_id, expires_at);


--
-- Name: idx_notification_deliveries_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_event ON public.notification_deliveries USING btree (event_id);


--
-- Name: idx_notification_deliveries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_status ON public.notification_deliveries USING btree (status, created_at);


--
-- Name: idx_notification_deliveries_stranded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_stranded ON public.notification_deliveries USING btree (created_at) WHERE (status = 'queued'::text);


--
-- Name: idx_notification_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_created ON public.notification_events USING btree (created_at DESC NULLS LAST);


--
-- Name: idx_notification_events_unfanned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_unfanned ON public.notification_events USING btree (created_at) WHERE (fanned_out_at IS NULL);


--
-- Name: idx_notifications_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_subject ON public.notifications USING btree (subject_type, subject_id, created_at DESC NULLS LAST);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (subject_type, subject_id) WHERE (read_at IS NULL);


--
-- Name: idx_otp_verifications_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_verifications_lookup ON public.otp_verifications USING btree (phone, purpose, expires_at);


--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_id);


--
-- Name: idx_payments_sweep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_sweep ON public.payments USING btree (updated_at) WHERE (status = ANY (ARRAY['pending'::public.payment_status, 'authorized'::public.payment_status]));


--
-- Name: idx_payout_accounts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_accounts_status ON public.payout_accounts USING btree (status);


--
-- Name: idx_payouts_approval_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_approval_queue ON public.payouts USING btree (requested_at) WHERE (approval_state = 'pending_approval'::text);


--
-- Name: idx_payouts_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_owner ON public.payouts USING btree (owner_type, owner_id, requested_at);


--
-- Name: idx_payouts_owner_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_owner_feed ON public.payouts USING btree (owner_type, owner_id, requested_at DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: idx_pricing_rules_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_rules_lookup ON public.pricing_rules USING btree (rule_kind, vehicle_class, max_km);


--
-- Name: idx_quotes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_status ON public.quotes USING btree (status, requested_at);


--
-- Name: idx_quotes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_user ON public.quotes USING btree (user_id, requested_at DESC NULLS LAST);


--
-- Name: idx_ratings_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_driver ON public.ratings USING btree (driver_id, created_at DESC NULLS LAST) WHERE (direction = 'customer_to_driver'::text);


--
-- Name: idx_referral_redemptions_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_redemptions_referrer ON public.referral_redemptions USING btree (referrer_user_id, created_at DESC NULLS LAST);


--
-- Name: idx_refresh_tokens_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_family ON public.refresh_tokens USING btree (family_id);


--
-- Name: idx_refresh_tokens_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_subject ON public.refresh_tokens USING btree (subject_id, realm);


--
-- Name: idx_refunds_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_booking ON public.refunds USING btree (booking_id);


--
-- Name: idx_refunds_dispute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_dispute ON public.refunds USING btree (dispute_id) WHERE (dispute_id IS NOT NULL);


--
-- Name: idx_saved_vehicles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_vehicles_user ON public.saved_vehicles USING btree (user_id);


--
-- Name: idx_service_zone_versions_zone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_zone_versions_zone_created ON public.service_zone_versions USING btree (zone_id, created_at DESC NULLS LAST);


--
-- Name: idx_service_zones_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_zones_geo ON public.service_zones USING gist (area);


--
-- Name: idx_services_active_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_active_order ON public.services USING btree (is_active, display_order);


--
-- Name: idx_social_identities_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_identities_subject ON public.social_identities USING btree (subject_type, subject_id);


--
-- Name: idx_sos_alert_contacts_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alert_contacts_alert ON public.sos_alert_contacts USING btree (alert_id);


--
-- Name: idx_sos_alert_events_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alert_events_alert ON public.sos_alert_events USING btree (alert_id, created_at);


--
-- Name: idx_sos_alerts_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alerts_status_created ON public.sos_alerts USING btree (status, created_at DESC NULLS LAST);


--
-- Name: idx_sos_alerts_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_alerts_subject ON public.sos_alerts USING btree (subject_type, subject_id, created_at DESC NULLS LAST);


--
-- Name: idx_support_ticket_events_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_events_ticket ON public.support_ticket_events USING btree (ticket_id, created_at);


--
-- Name: idx_support_ticket_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_messages_ticket ON public.support_ticket_messages USING btree (ticket_id, created_at);


--
-- Name: idx_support_tickets_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_assigned ON public.support_tickets USING btree (assigned_admin_id);


--
-- Name: idx_support_tickets_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_requester ON public.support_tickets USING btree (requester_type, requester_id, created_at DESC NULLS LAST);


--
-- Name: idx_support_tickets_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status_created ON public.support_tickets USING btree (status, created_at DESC NULLS LAST);


--
-- Name: idx_suspension_requests_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suspension_requests_status_created ON public.suspension_requests USING btree (status, created_at DESC NULLS LAST);


--
-- Name: idx_truck_imports_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_truck_imports_fleet ON public.truck_imports USING btree (fleet_id, created_at DESC NULLS LAST);


--
-- Name: idx_users_mobile_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_mobile_trgm ON public.users USING gin (mobile public.gin_trgm_ops);


--
-- Name: idx_users_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_name_trgm ON public.users USING gin (name public.gin_trgm_ops);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: idx_wallet_transactions_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_transactions_ref ON public.wallet_transactions USING btree (ref_id);


--
-- Name: idx_wallet_transactions_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_transactions_wallet ON public.wallet_transactions USING btree (wallet_id, created_at);


--
-- Name: idx_wallet_transactions_wallet_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_transactions_wallet_feed ON public.wallet_transactions USING btree (wallet_id, created_at DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: uq_admin_recovery_codes_admin_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_admin_recovery_codes_admin_hash ON public.admin_recovery_codes USING btree (admin_id, code_hash);


--
-- Name: uq_alerts_open_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_alerts_open_subject ON public.alerts USING btree (fleet_id, type, subject_id) WHERE (resolved_at IS NULL);


--
-- Name: uq_bookings_one_active_per_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bookings_one_active_per_driver ON public.bookings USING btree (driver_id) WHERE ((driver_id IS NOT NULL) AND (status = ANY (ARRAY['assigned'::public.booking_status, 'en_route'::public.booking_status, 'arrived'::public.booking_status, 'in_progress'::public.booking_status])));


--
-- Name: uq_bookings_one_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bookings_one_active_per_user ON public.bookings USING btree (user_id) WHERE (status = ANY (ARRAY['searching'::public.booking_status, 'assigned'::public.booking_status, 'en_route'::public.booking_status, 'arrived'::public.booking_status, 'in_progress'::public.booking_status]));


--
-- Name: uq_bookings_share_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bookings_share_token ON public.bookings USING btree (share_token) WHERE (share_token IS NOT NULL);


--
-- Name: uq_commission_proposals_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_commission_proposals_open ON public.commission_proposals USING btree (band) WHERE (status = 'open'::text);


--
-- Name: uq_content_pages_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_content_pages_slug ON public.content_pages USING btree (slug);


--
-- Name: uq_coupon_redemptions_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_coupon_redemptions_booking ON public.coupon_redemptions USING btree (booking_id);


--
-- Name: uq_coupons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_coupons_code ON public.coupons USING btree (upper(code));


--
-- Name: uq_deletion_requests_one_open_per_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_deletion_requests_one_open_per_subject ON public.deletion_requests USING btree (subject_type, subject_id) WHERE (status = ANY (ARRAY['requested'::text, 'on_hold'::text, 'approved'::text, 'executing'::text]));


--
-- Name: uq_devices_push_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_devices_push_token ON public.devices USING btree (push_token) WHERE ((push_token IS NOT NULL) AND (revoked_at IS NULL));


--
-- Name: uq_devices_subject_installation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_devices_subject_installation ON public.devices USING btree (subject_type, subject_id, installation_id);


--
-- Name: uq_dispatch_wave_logs_wave_ran; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dispatch_wave_logs_wave_ran ON public.dispatch_wave_logs USING btree (booking_id, wave, ran_at);


--
-- Name: uq_disputes_open_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_disputes_open_per_booking ON public.disputes USING btree (booking_id) WHERE (status <> 'resolved'::text);


--
-- Name: uq_drivers_assigned_truck; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_drivers_assigned_truck ON public.drivers USING btree (assigned_truck_id) WHERE (assigned_truck_id IS NOT NULL);


--
-- Name: uq_fleet_trucks_fleet_plate; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fleet_trucks_fleet_plate ON public.fleet_trucks USING btree (fleet_id, plate);


--
-- Name: uq_notification_deliveries_push; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_deliveries_push ON public.notification_deliveries USING btree (event_id, recipient_key, channel, device_id) WHERE (device_id IS NOT NULL);


--
-- Name: uq_notification_deliveries_single; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_deliveries_single ON public.notification_deliveries USING btree (event_id, recipient_key, channel) WHERE (device_id IS NULL);


--
-- Name: uq_notification_events_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_events_dedupe ON public.notification_events USING btree (event, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: uq_payments_gateway_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_gateway_ref ON public.payments USING btree (gateway_ref) WHERE (gateway_ref IS NOT NULL);


--
-- Name: uq_payments_one_captured_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_one_captured_per_booking ON public.payments USING btree (booking_id) WHERE ((status = 'captured'::public.payment_status) AND (purpose = 'booking'::text));


--
-- Name: uq_payments_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_order_ref ON public.payments USING btree (gateway_order_ref) WHERE (gateway_order_ref IS NOT NULL);


--
-- Name: uq_payouts_one_open_per_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payouts_one_open_per_owner ON public.payouts USING btree (owner_type, owner_id) WHERE (status = ANY (ARRAY['requested'::public.payout_status, 'processing'::public.payout_status]));


--
-- Name: uq_payouts_route_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payouts_route_ref ON public.payouts USING btree (route_ref) WHERE (route_ref IS NOT NULL);


--
-- Name: uq_pricing_rules_distance_band; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pricing_rules_distance_band ON public.pricing_rules USING btree (rule_kind, vehicle_class, max_km) WHERE (is_active AND (rule_kind = ANY (ARRAY['slab'::public.pricing_rule_kind, 'long_distance'::public.pricing_rule_kind])));


--
-- Name: uq_pricing_rules_roadside; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pricing_rules_roadside ON public.pricing_rules USING btree (service_type) WHERE (is_active AND (rule_kind = 'roadside'::public.pricing_rule_kind));


--
-- Name: uq_ratings_booking_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ratings_booking_direction ON public.ratings USING btree (booking_id, direction);


--
-- Name: uq_referral_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_referral_codes_code ON public.referral_codes USING btree (upper(code));


--
-- Name: uq_referral_redemptions_referee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_referral_redemptions_referee ON public.referral_redemptions USING btree (referee_user_id);


--
-- Name: uq_refunds_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_refunds_idempotency_key ON public.refunds USING btree (idempotency_key);


--
-- Name: uq_retention_policies_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_retention_policies_key ON public.retention_policies USING btree (policy_key);


--
-- Name: uq_services_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_services_slug ON public.services USING btree (slug);


--
-- Name: uq_sos_alerts_open_per_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sos_alerts_open_per_subject ON public.sos_alerts USING btree (subject_type, subject_id) WHERE (status = ANY (ARRAY['triggered'::text, 'acknowledged'::text]));


--
-- Name: uq_support_tickets_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_support_tickets_reference ON public.support_tickets USING btree (reference);


--
-- Name: uq_suspension_requests_open_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_suspension_requests_open_subject ON public.suspension_requests USING btree (subject_type, subject_id) WHERE (status = 'open'::text);


--
-- Name: admin_users trg_admin_authz_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_admin_authz_version BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.bump_admin_authz_version();


--
-- Name: addresses addresses_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: admin_actions admin_actions_admin_id_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_admin_id_admin_users_id_fk FOREIGN KEY (admin_id) REFERENCES public.admin_users(id);


--
-- Name: admin_notes admin_notes_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notes
    ADD CONSTRAINT admin_notes_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id);


--
-- Name: admin_recovery_codes admin_recovery_codes_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_recovery_codes
    ADD CONSTRAINT admin_recovery_codes_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id) ON DELETE CASCADE;


--
-- Name: admin_users admin_users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id);


--
-- Name: admin_users admin_users_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.admin_users(id);


--
-- Name: alerts alerts_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: analytics_zone_daily analytics_zone_daily_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_zone_daily
    ADD CONSTRAINT analytics_zone_daily_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.service_zones(id);


--
-- Name: banners banners_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id);


--
-- Name: booking_location_path booking_location_path_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_location_path
    ADD CONSTRAINT booking_location_path_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_messages booking_messages_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_status_history booking_status_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.admin_users(id);


--
-- Name: booking_status_history booking_status_history_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id);


--
-- Name: bookings bookings_driver_id_drivers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_driver_id_drivers_id_fk FOREIGN KEY (driver_id) REFERENCES public.drivers(id);


--
-- Name: bookings bookings_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id);


--
-- Name: bookings bookings_truck_id_fleet_trucks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_truck_id_fleet_trucks_id_fk FOREIGN KEY (truck_id) REFERENCES public.fleet_trucks(id);


--
-- Name: bookings bookings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bookings bookings_zone_id_service_zones_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_zone_id_service_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.service_zones(id);


--
-- Name: commission_config_history commission_config_history_changed_by_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_config_history
    ADD CONSTRAINT commission_config_history_changed_by_admin_users_id_fk FOREIGN KEY (changed_by) REFERENCES public.admin_users(id);


--
-- Name: commission_config commission_config_updated_by_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_config
    ADD CONSTRAINT commission_config_updated_by_admin_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.admin_users(id);


--
-- Name: commission_guardrail commission_guardrail_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_guardrail
    ADD CONSTRAINT commission_guardrail_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_users(id);


--
-- Name: commission_proposals commission_proposals_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_proposals
    ADD CONSTRAINT commission_proposals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.admin_users(id);


--
-- Name: commission_proposals commission_proposals_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_proposals
    ADD CONSTRAINT commission_proposals_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.admin_users(id);


--
-- Name: compliance_documents compliance_documents_truck_id_fleet_trucks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_documents
    ADD CONSTRAINT compliance_documents_truck_id_fleet_trucks_id_fk FOREIGN KEY (truck_id) REFERENCES public.fleet_trucks(id) ON DELETE CASCADE;


--
-- Name: content_pages content_pages_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pages
    ADD CONSTRAINT content_pages_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_users(id);


--
-- Name: coupon_redemptions coupon_redemptions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: coupon_redemptions coupon_redemptions_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id);


--
-- Name: coupon_redemptions coupon_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: deletion_requests deletion_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.admin_users(id);


--
-- Name: dispatch_attempts dispatch_attempts_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_attempts
    ADD CONSTRAINT dispatch_attempts_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: dispatch_attempts dispatch_attempts_driver_id_drivers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_attempts
    ADD CONSTRAINT dispatch_attempts_driver_id_drivers_id_fk FOREIGN KEY (driver_id) REFERENCES public.drivers(id);


--
-- Name: dispatch_wave_logs dispatch_wave_logs_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_wave_logs
    ADD CONSTRAINT dispatch_wave_logs_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: dispute_evidence dispute_evidence_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(id) ON DELETE CASCADE;


--
-- Name: disputes disputes_assigned_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_assigned_admin_id_fkey FOREIGN KEY (assigned_admin_id) REFERENCES public.admin_users(id);


--
-- Name: disputes disputes_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: disputes disputes_refund_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_refund_id_fkey FOREIGN KEY (refund_id) REFERENCES public.refunds(id);


--
-- Name: disputes disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.admin_users(id);


--
-- Name: driver_document_versions driver_document_versions_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_document_versions
    ADD CONSTRAINT driver_document_versions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: driver_document_versions driver_document_versions_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_document_versions
    ADD CONSTRAINT driver_document_versions_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.admin_users(id);


--
-- Name: driver_documents driver_documents_driver_id_drivers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_driver_id_drivers_id_fk FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: driver_documents driver_documents_verified_by_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_verified_by_admin_users_id_fk FOREIGN KEY (verified_by) REFERENCES public.admin_users(id);


--
-- Name: driver_zone_restrictions driver_zone_restrictions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_zone_restrictions
    ADD CONSTRAINT driver_zone_restrictions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id);


--
-- Name: driver_zone_restrictions driver_zone_restrictions_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_zone_restrictions
    ADD CONSTRAINT driver_zone_restrictions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: driver_zone_restrictions driver_zone_restrictions_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_zone_restrictions
    ADD CONSTRAINT driver_zone_restrictions_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.service_zones(id) ON DELETE CASCADE;


--
-- Name: drivers drivers_approved_by_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_approved_by_admin_users_id_fk FOREIGN KEY (approved_by) REFERENCES public.admin_users(id);


--
-- Name: drivers drivers_assigned_truck_id_fleet_trucks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_assigned_truck_id_fleet_trucks_id_fk FOREIGN KEY (assigned_truck_id) REFERENCES public.fleet_trucks(id) ON DELETE SET NULL;


--
-- Name: drivers drivers_current_zone_id_service_zones_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_current_zone_id_service_zones_id_fk FOREIGN KEY (current_zone_id) REFERENCES public.service_zones(id) ON DELETE SET NULL;


--
-- Name: drivers drivers_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE SET NULL;


--
-- Name: drivers drivers_pending_suspension_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pending_suspension_by_fkey FOREIGN KEY (pending_suspension_by) REFERENCES public.admin_users(id);


--
-- Name: drivers drivers_suspended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.admin_users(id);


--
-- Name: earnings_daily earnings_daily_driver_id_drivers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_daily
    ADD CONSTRAINT earnings_daily_driver_id_drivers_id_fk FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: earnings_daily earnings_daily_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_daily
    ADD CONSTRAINT earnings_daily_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- Name: emergency_contacts emergency_contacts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_contacts
    ADD CONSTRAINT emergency_contacts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: erasure_jobs erasure_jobs_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_jobs
    ADD CONSTRAINT erasure_jobs_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.deletion_requests(id);


--
-- Name: fleet_driver_shares fleet_driver_shares_driver_id_drivers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_driver_shares
    ADD CONSTRAINT fleet_driver_shares_driver_id_drivers_id_fk FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: fleet_driver_shares fleet_driver_shares_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_driver_shares
    ADD CONSTRAINT fleet_driver_shares_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- Name: fleet_owner_credentials fleet_owner_credentials_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_owner_credentials
    ADD CONSTRAINT fleet_owner_credentials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: fleet_trucks fleet_trucks_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_trucks
    ADD CONSTRAINT fleet_trucks_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- Name: fleets fleets_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleets
    ADD CONSTRAINT fleets_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: fleets fleets_suspended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleets
    ADD CONSTRAINT fleets_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.admin_users(id);


--
-- Name: impersonation_sessions impersonation_sessions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id);


--
-- Name: notification_deliveries notification_deliveries_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL;


--
-- Name: notification_deliveries notification_deliveries_event_id_notification_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_event_id_notification_events_id_fk FOREIGN KEY (event_id) REFERENCES public.notification_events(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_event_id_notification_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_event_id_notification_events_id_fk FOREIGN KEY (event_id) REFERENCES public.notification_events(id) ON DELETE CASCADE;


--
-- Name: payments payments_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: payouts payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admin_users(id);


--
-- Name: quotes quotes_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: quotes quotes_quoted_by_admin_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_quoted_by_admin_users_id_fk FOREIGN KEY (quoted_by) REFERENCES public.admin_users(id);


--
-- Name: quotes quotes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ratings ratings_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_codes referral_codes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_redemptions referral_redemptions_referee_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_referee_user_id_users_id_fk FOREIGN KEY (referee_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_redemptions referral_redemptions_referrer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_referrer_user_id_users_id_fk FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_redemptions referral_redemptions_rewarded_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_rewarded_booking_id_bookings_id_fk FOREIGN KEY (rewarded_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: refunds refunds_booking_id_bookings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_booking_id_bookings_id_fk FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: refunds refunds_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(id);


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: retention_policies retention_policies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_users(id);


--
-- Name: saved_vehicles saved_vehicles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_vehicles
    ADD CONSTRAINT saved_vehicles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: service_zone_versions service_zone_versions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zone_versions
    ADD CONSTRAINT service_zone_versions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.admin_users(id);


--
-- Name: service_zone_versions service_zone_versions_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zone_versions
    ADD CONSTRAINT service_zone_versions_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.service_zones(id) ON DELETE CASCADE;


--
-- Name: service_zones service_zones_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_zones
    ADD CONSTRAINT service_zones_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_users(id);


--
-- Name: sos_alert_contacts sos_alert_contacts_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alert_contacts
    ADD CONSTRAINT sos_alert_contacts_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.sos_alerts(id) ON DELETE CASCADE;


--
-- Name: sos_alert_events sos_alert_events_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alert_events
    ADD CONSTRAINT sos_alert_events_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.sos_alerts(id) ON DELETE CASCADE;


--
-- Name: sos_alerts sos_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.admin_users(id);


--
-- Name: sos_alerts sos_alerts_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: sos_alerts sos_alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.admin_users(id);


--
-- Name: support_ticket_events support_ticket_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_events
    ADD CONSTRAINT support_ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_ticket_messages support_ticket_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_assigned_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_assigned_admin_id_fkey FOREIGN KEY (assigned_admin_id) REFERENCES public.admin_users(id);


--
-- Name: support_tickets support_tickets_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: suspension_requests suspension_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspension_requests
    ADD CONSTRAINT suspension_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.admin_users(id);


--
-- Name: suspension_requests suspension_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspension_requests
    ADD CONSTRAINT suspension_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.admin_users(id);


--
-- Name: truck_imports truck_imports_fleet_id_fleets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.truck_imports
    ADD CONSTRAINT truck_imports_fleet_id_fleets_id_fk FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- Name: users users_suspended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.admin_users(id);


--
-- Name: wallet_transactions wallet_transactions_wallet_id_wallets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wallet_id_wallets_id_fk FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

