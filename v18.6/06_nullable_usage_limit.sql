-- ─────────────────────────────────────────────────────────────────────────
-- v18.1.3 — make gear.usage_limit nullable
-- "No usage limit" is a legitimate state (fuel items, vehicles, monitored
-- gear) but the column was NOT NULL DEFAULT 200, forcing a meaningless
-- placeholder for items without a real limit. Now NULL means "untracked".
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.gear ALTER COLUMN usage_limit DROP NOT NULL;

COMMENT ON COLUMN public.gear.usage_limit IS
  'Number of uses before the item must be retired/inspected. NULL = no limit (e.g. vehicles, fuel, catalogue items). 0 = untracked. Positive = real limit.';
