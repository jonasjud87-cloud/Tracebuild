-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: ÖREB Fürstentum Liechtenstein (FL)
--
-- 1. protect_project_identity: Kantonsliste um 'FL' ergänzt, sonst 1:1 aus 20261106000001_geoportal.sql.
--    Der Trigger projects_protect_identity bleibt bestehen und ruft die ersetzte Funktion auf.
-- 2. Importfilter FL: Import gestoppt (doc_types []) bis Freigabe Jonas nach Probeimport Vaduz.
--    oereblex.llv.li steht nur hier, nicht im Code-Standard: Ohne diese Zeile lehnt der Code jeden
--    .li-Host ab, es startet also auch ohne Migration kein FL-Import.
-- 3. norms.country: 'CH' | 'LI'; NULL = gilt in allen Ländern.
--    Einmaliger Bestand: ALLE bestehenden Normen mit jurisdiction_type national, cantonal oder municipal
--    (ausser Kanton FL bzw. jurisdiction_canton FL) → 'CH', auch bestehende SIA-/VKF-Normen auf Ebene Bund.
--    NULL bleibt nur für Org-Normen (und andere Typen) sowie für künftige Uploads «Alle Länder»; eine
--    Bundesnorm, die auch in FL gelten soll, ist danach von Hand auf NULL zu setzen.
--    Nur beim Anlegen der Spalte, damit ein zweiter Lauf später angelegte FL- oder NULL-Normen nicht umschreibt.
--    Ohne diese Migration liest der Code die Spalte nicht und behandelt jede Norm wie bisher.
--
-- Index- und Constraint-Namen dürfen egrid, lv95_, bfs_number, zone_, bauzone und parcel_number nicht
-- enthalten: Die API erkennt fehlende Spalten am Fehlertext.
-- Rechte: keine neue Tabelle, keine neuen GRANTs. Die Funktion bleibt SECURITY INVOKER (prüft current_user).
--
-- Rein additiv, mehrfach ausführbar. NICHT automatisch ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '3s';

-- ── 1. Projektidentität: FL als gültiger Standort ───────────────────────────
CREATE OR REPLACE FUNCTION public.protect_project_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.egrid := NULL; NEW.bfs_number := NULL; NEW.lv95_e := NULL; NEW.lv95_n := NULL;
  ELSE
    NEW.egrid := OLD.egrid; NEW.bfs_number := OLD.bfs_number; NEW.lv95_e := OLD.lv95_e; NEW.lv95_n := OLD.lv95_n;
  END IF;
  IF COALESCE(NEW.location->>'canton', '') <> '' AND NEW.location->>'canton' NOT IN (
    'AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE',
    'NW','OW','SG','SH','SO','SZ','TG','TI','UR','VD','VS','ZG','ZH','FL'
  ) THEN
    RAISE EXCEPTION 'Ungültiger Kanton' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Importfilter FL: gestoppt bis Freigabe ───────────────────────────────
INSERT INTO public.oereb_import_filters (scope, rules, note) VALUES
  ('FL',
   '{"doc_types":[],"allowed_hosts_add":["oereblex.llv.li"],"neutral_themes_add":["fl.Nutzungsplanung"],"ocr_themes_add":["fl.Nutzungsplanung"]}',
   'Liechtenstein: Import gestoppt bis Freigabe Jonas')
ON CONFLICT (scope) DO NOTHING;

-- ── 3. Länderspalte an norms ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'norms' AND column_name = 'country'
  ) THEN
    ALTER TABLE public.norms ADD COLUMN IF NOT EXISTS country text;
    -- Bestand: bisher gab es nur Schweizer Recht. FL-Kanton und FL-Gemeinden ausgenommen, falls schon da.
    UPDATE public.norms SET country = 'CH'
    WHERE jurisdiction_type IN ('national', 'cantonal', 'municipal')
      AND NOT (jurisdiction_type = 'cantonal' AND jurisdiction_name = 'FL')
      AND COALESCE(jurisdiction_canton, '') <> 'FL';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'norms_country_check' AND conrelid = 'public.norms'::regclass
  ) THEN
    ALTER TABLE public.norms ADD CONSTRAINT norms_country_check CHECK (country IS NULL OR country IN ('CH', 'LI'));
  END IF;
END $$;

COMMENT ON COLUMN public.norms.country IS
  'Land der Norm: CH oder LI. NULL = gilt in allen Ländern. Projekte mit Kanton FL gelten als LI, alle anderen als CH.';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

-- Rückbau (von Hand, erst nach Rücksprung des Codes; vorher FL-Projekte auf einen Kanton oder leer setzen):
-- ALTER TABLE public.norms DROP CONSTRAINT IF EXISTS norms_country_check;
-- ALTER TABLE public.norms DROP COLUMN IF EXISTS country;
-- DELETE FROM public.oereb_import_filters WHERE scope = 'FL';
-- protect_project_identity: Funktion aus 20261106000001_geoportal.sql erneut einspielen (Liste ohne 'FL').
-- NOTIFY pgrst, 'reload schema';
