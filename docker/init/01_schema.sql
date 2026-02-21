CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE public.wallet_owner_enum AS ENUM ('user', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.txn_type_enum AS ENUM ('topup', 'bonus', 'spend');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.txn_status_enum AS ENUM ('pending', 'success', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.entry_type_enum AS ENUM ('debit', 'credit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Assets
CREATE TABLE IF NOT EXISTS public.asset_types (
  asset_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code          VARCHAR(30) NOT NULL UNIQUE,
  asset_name          VARCHAR(80) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS public.users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     VARCHAR(150) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- System accounts like TREASURY, REVENUE, PROMO_POOL etc.
CREATE TABLE IF NOT EXISTS public.system_accounts (
  system_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name  VARCHAR(150) NOT NULL UNIQUE,             
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Wallets (balance per owner per asset)
CREATE TABLE IF NOT EXISTS public.wallets (
  wallet_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_type    public.wallet_owner_enum NOT NULL,
  user_id       UUID NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  system_id     UUID NULL REFERENCES public.system_accounts(system_id) ON DELETE CASCADE,

  asset_id      UUID NOT NULL REFERENCES public.asset_types(asset_id),
  balance       BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT wallets_balance_chk CHECK (balance >= 0),
  CONSTRAINT wallets_owner_chk CHECK (
    (owner_type = 'user'   AND user_id IS NOT NULL AND system_id IS NULL) OR
    (owner_type = 'system' AND system_id IS NOT NULL AND user_id IS NULL)
  ),
  CONSTRAINT wallets_unique_owner_asset
  UNIQUE (owner_type, user_id, system_id, asset_id)
);

-- Transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  txn_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type          public.txn_type_enum NOT NULL,
  txn_status        public.txn_status_enum NOT NULL DEFAULT 'pending',
  
  asset_id          UUID NOT NULL REFERENCES public.asset_types(asset_id),
  amount            BIGINT NOT NULL,
  
  from_wallet_id    UUID NOT NULL REFERENCES public.wallets(wallet_id),
  to_wallet_id      UUID NOT NULL REFERENCES public.wallets(wallet_id),
  idempotency_key   VARCHAR(120) NOT NULL UNIQUE,
  
  metadata          JSONB NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT txn_amount_chk CHECK (amount > 0),
  CONSTRAINT txn_wallets_different_chk CHECK (from_wallet_id <> to_wallet_id)
);

-- Ledger entries for each transaction (multiple entries per txn for debit and credit)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  entry_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id         UUID NOT NULL REFERENCES public.transactions(txn_id) ON DELETE CASCADE,

  wallet_id      UUID NOT NULL REFERENCES public.wallets(wallet_id),
  entry_type     public.entry_type_enum NOT NULL,
  amount         BIGINT NOT NULL,
  current_balance BIGINT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT ledger_amount_chk CHECK (amount > 0)
);
