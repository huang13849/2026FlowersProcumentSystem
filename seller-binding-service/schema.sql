CREATE TABLE IF NOT EXISTS seller_shops (
  id                 BIGSERIAL PRIMARY KEY,
  shop_key           TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  source_project     TEXT NOT NULL,
  source_label       TEXT,
  peony_org_id       BIGINT,
  mongo_supplier_id  TEXT,
  zitadel_org_id     TEXT,
  contact_name       TEXT,
  contact_phone      TEXT,
  address            TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_shops_source ON seller_shops(source_project);
CREATE INDEX IF NOT EXISTS idx_seller_shops_peony_org ON seller_shops(peony_org_id);
CREATE INDEX IF NOT EXISTS idx_seller_shops_mongo_sup ON seller_shops(mongo_supplier_id);

CREATE TABLE IF NOT EXISTS seller_user_bindings (
  id                 BIGSERIAL PRIMARY KEY,
  shop_id            BIGINT NOT NULL REFERENCES seller_shops(id) ON DELETE CASCADE,
  phone              TEXT NOT NULL,
  zitadel_user_id    TEXT,
  role               TEXT NOT NULL DEFAULT 'staff',
  source_project     TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_seller_user_bindings_phone ON seller_user_bindings(phone);
CREATE INDEX IF NOT EXISTS idx_seller_user_bindings_zid   ON seller_user_bindings(zitadel_user_id);

CREATE TABLE IF NOT EXISTS seller_product_links (
  id                 BIGSERIAL PRIMARY KEY,
  shop_id            BIGINT NOT NULL REFERENCES seller_shops(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL,
  source_project     TEXT NOT NULL,
  source_label       TEXT,
  created_by_phone   TEXT,
  listed_at          TIMESTAMPTZ,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id)
);
CREATE INDEX IF NOT EXISTS idx_seller_product_links_shop  ON seller_product_links(shop_id);
CREATE INDEX IF NOT EXISTS idx_seller_product_links_phone ON seller_product_links(created_by_phone);
CREATE INDEX IF NOT EXISTS idx_seller_product_links_src   ON seller_product_links(source_project);
