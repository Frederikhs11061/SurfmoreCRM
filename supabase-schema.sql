-- =============================================
-- Surfmore CRM - Supabase Schema
-- Kør dette i Supabase SQL Editor
-- =============================================
--
-- UNDERKATEGORI-LOGIK (håndteres ved import i CRMApp.js):
-- category-kolonnen gemmer den samlede streng:
--   - Hvis underkategori findes i sheet: "Kategori (Underkategori)" f.eks. "Højskole (Maritim profil)"
--   - Hvis ingen underkategori: kun "Kategori" f.eks. "Butik & Webshop"
-- Kontaktperson og andre valgfrie kolonner: NULL hvis kolonnen ikke findes i kildedata.
-- =============================================

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Butik & Webshop',
  country TEXT NOT NULL DEFAULT 'Danmark',
  email TEXT,
  phone TEXT,
  city TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'not_contacted',
  contact_person TEXT,
  notes TEXT,
  sale_info TEXT,
  product TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outreaches table (related to leads)
CREATE TABLE IF NOT EXISTS outreaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  date DATE,
  by TEXT NOT NULL DEFAULT 'Jeppe',
  note TEXT,
  sale_info TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS outreaches_lead_id_idx ON outreaches(lead_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cold_outreach', -- cold_outreach | follow_up | re_engage | partner_intro | offer
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'da',        -- da | en
  from_email TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  category_tags TEXT[] DEFAULT '{}',          -- f.eks. ['Skoler & Klubber (Kajakklub)','Butik & Webshop']
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
