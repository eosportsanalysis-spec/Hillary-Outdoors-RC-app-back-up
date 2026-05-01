-- ─────────────────────────────────────────────────────────────────────────
-- v18.1.2 — add nfc_tag / qr_code columns to categories
-- Lets you tag an entire sized-pool category with one QR or NFC tag.
-- Scanning the tag opens the SizedPoolScreen for that category.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS nfc_tag text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS qr_code text;

-- Each tag must be unique across all categories so scans resolve to one cat.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_nfc_tag_key') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_nfc_tag_key UNIQUE (nfc_tag);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_qr_code_key') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_qr_code_key UNIQUE (qr_code);
  END IF;
END $$;

COMMENT ON COLUMN public.categories.nfc_tag  IS 'Optional NFC tag for the whole category (sized_pool: scan opens pool grid; signable: scan opens type-pick).';
COMMENT ON COLUMN public.categories.qr_code  IS 'Optional QR code for the whole category — same routing as nfc_tag.';
