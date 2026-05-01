-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.categories (
  cat_id text NOT NULL,
  name text NOT NULL,
  description text,
  target_stock integer NOT NULL DEFAULT 4,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  life_safety boolean NOT NULL DEFAULT false,
  behaviour text NOT NULL DEFAULT 'signable'::text CHECK (behaviour = ANY (ARRAY['signable'::text, 'sized_pool'::text, 'monitored_only'::text, 'fuel'::text, 'catalogue'::text])),
  budget_owner text,
  sized_pool_style text CHECK (sized_pool_style IS NULL OR (sized_pool_style = ANY (ARRAY['individual'::text, 'bucket'::text]))),
  nfc_tag text UNIQUE,
  qr_code text UNIQUE,
  CONSTRAINT categories_pkey PRIMARY KEY (cat_id)
);
CREATE TABLE public.fuel_log (
  fuel_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  vehicle_gear_id integer,
  vehicle_name text NOT NULL,
  litres_added numeric NOT NULL,
  pump_gauge_reading numeric NOT NULL,
  instructor text NOT NULL,
  time timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fuel_log_pkey PRIMARY KEY (fuel_id),
  CONSTRAINT fuel_log_vehicle_gear_id_fkey FOREIGN KEY (vehicle_gear_id) REFERENCES public.gear(gear_id)
);
CREATE TABLE public.gear (
  gear_id integer NOT NULL DEFAULT nextval('gear_gear_id_seq'::regclass),
  item text NOT NULL,
  category_id text,
  status text NOT NULL DEFAULT 'Green'::text CHECK (status = ANY (ARRAY['Red'::text, 'Orange'::text, 'Yellow'::text, 'YellowRepair'::text, 'Green'::text])),
  expiry date,
  number_of_uses integer NOT NULL DEFAULT 0,
  usage_limit integer DEFAULT 200,
  signed_in_out text NOT NULL DEFAULT 'IN'::text CHECK (signed_in_out = ANY (ARRAY['IN'::text, 'OUT'::text])),
  notes text,
  location text,
  nfc_tag text UNIQUE,
  qr_code text UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  physical_serial text,
  size text,
  is_pool_bucket boolean NOT NULL DEFAULT false,
  pool_count integer,
  pool_capacity integer,
  set_size integer CHECK (set_size IS NULL OR set_size > 0),
  CONSTRAINT gear_pkey PRIMARY KEY (gear_id),
  CONSTRAINT gear_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(cat_id)
);
CREATE TABLE public.list_gear (
  id integer NOT NULL DEFAULT nextval('list_gear_id_seq'::regclass),
  list_id text NOT NULL,
  gear_id integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT list_gear_pkey PRIMARY KEY (id),
  CONSTRAINT list_gear_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(list_id),
  CONSTRAINT list_gear_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.gear(gear_id)
);
CREATE TABLE public.lists (
  list_id text NOT NULL,
  name text NOT NULL,
  description text,
  nfc_tag text UNIQUE,
  qr_code text UNIQUE,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  behaviour text CHECK (behaviour IS NULL OR (behaviour = ANY (ARRAY['signable'::text, 'sized_pool'::text, 'monitored_only'::text, 'fuel'::text, 'catalogue'::text]))),
  CONSTRAINT lists_pkey PRIMARY KEY (list_id)
);
CREATE TABLE public.locations (
  loc_id text NOT NULL,
  name text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT locations_pkey PRIMARY KEY (loc_id)
);
CREATE TABLE public.prev_purchases (
  prev_id integer NOT NULL DEFAULT nextval('prev_purchases_prev_id_seq'::regclass),
  item text NOT NULL,
  purchase_type text NOT NULL CHECK (purchase_type = ANY (ARRAY['operational'::text, 'grant'::text])),
  final_cost numeric,
  purchase_date date,
  supplier text,
  new_gear_id text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prev_purchases_pkey PRIMARY KEY (prev_id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'instructor'::text CHECK (role = ANY (ARRAY['instructor'::text, 'manager'::text])),
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'inactive'::text])),
  joined_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.repairs (
  repair_id text NOT NULL,
  gear_id integer,
  item text NOT NULL,
  report_id integer,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'retired'::text])),
  assigned_to text,
  notes text,
  date_reported date NOT NULL DEFAULT CURRENT_DATE,
  date_completed date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT repairs_pkey PRIMARY KEY (repair_id),
  CONSTRAINT repairs_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.gear(gear_id),
  CONSTRAINT repairs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(report_id)
);
CREATE TABLE public.reports (
  report_id integer NOT NULL DEFAULT nextval('reports_report_id_seq'::regclass),
  item text NOT NULL,
  gear_id integer,
  status text NOT NULL CHECK (status = ANY (ARRAY['Red'::text, 'Orange'::text, 'Yellow'::text, 'YellowRepair'::text, 'Green'::text])),
  notes text,
  instructor text NOT NULL,
  time_reported timestamp with time zone NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamp with time zone,
  CONSTRAINT reports_pkey PRIMARY KEY (report_id),
  CONSTRAINT reports_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.gear(gear_id)
);
CREATE TABLE public.retired (
  gear_id integer NOT NULL,
  item text NOT NULL,
  category_id text,
  status text NOT NULL DEFAULT 'Red'::text,
  expiry date,
  number_of_uses integer,
  usage_limit integer,
  notes text,
  location text,
  nfc_tag text,
  qr_code text,
  retired_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT retired_pkey PRIMARY KEY (gear_id)
);
CREATE TABLE public.usage (
  usage_id integer NOT NULL DEFAULT nextval('usage_usage_id_seq'::regclass),
  item text NOT NULL,
  gear_id integer,
  list_id text,
  signed_in_out text NOT NULL CHECK (signed_in_out = ANY (ARRAY['IN'::text, 'OUT'::text])),
  time_out timestamp with time zone,
  time_in timestamp with time zone,
  instructor text NOT NULL,
  use_number_on_item integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT usage_pkey PRIMARY KEY (usage_id),
  CONSTRAINT usage_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.gear(gear_id),
  CONSTRAINT usage_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(list_id)
);
CREATE TABLE public.workflow (
  wf_id integer NOT NULL DEFAULT nextval('workflow_wf_id_seq'::regclass),
  cat_id text,
  item text NOT NULL,
  gear_id integer,
  status text NOT NULL DEFAULT 'Green'::text CHECK (status = ANY (ARRAY['Red'::text, 'Orange'::text, 'Yellow'::text, 'Green'::text])),
  priority integer NOT NULL DEFAULT 4 CHECK (priority >= 1 AND priority <= 4),
  purchase_type text NOT NULL DEFAULT 'operational'::text CHECK (purchase_type = ANY (ARRAY['operational'::text, 'grant'::text])),
  workflow_stage text NOT NULL DEFAULT 'pending'::text CHECK (workflow_stage = ANY (ARRAY['pending'::text, 'quoted'::text, 'grant_applied'::text, 'grant_approved'::text, 'ordered'::text, 'arrived'::text, 'entered'::text])),
  estimated_cost numeric,
  quote_amount numeric,
  quote_supplier text,
  grant_name text,
  grant_applied_date date,
  grant_approved_date date,
  order_date date,
  arrived_date date,
  notes text,
  allocated_to text DEFAULT 'unallocated'::text CHECK (allocated_to = ANY (ARRAY['budget'::text, 'grant'::text, 'unallocated'::text])),
  allocation_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  actual_cost numeric,
  CONSTRAINT workflow_pkey PRIMARY KEY (wf_id),
  CONSTRAINT workflow_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.gear(gear_id),
  CONSTRAINT workflow_cat_id_fkey FOREIGN KEY (cat_id) REFERENCES public.categories(cat_id)
);
