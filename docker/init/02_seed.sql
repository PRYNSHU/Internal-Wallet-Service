
-- asset types
INSERT INTO public.asset_types (asset_code, asset_name, is_active)
VALUES
  ('GOLD',    'Gold Coins',     TRUE),
  ('DIAMOND', 'Diamonds',       TRUE),
  ('POINTS',  'Loyalty Points', TRUE)
ON CONFLICT (asset_code) DO NOTHING;

-- system account
INSERT INTO public.system_accounts (system_name, is_active)
VALUES ('TREASURY', TRUE)
ON CONFLICT (system_name) DO NOTHING;

-- Users creation
INSERT INTO public.users (user_id, full_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Demo one', TRUE),
  ('22222222-2222-2222-2222-222222222222', 'Demo two',  TRUE)
ON CONFLICT (user_id) DO NOTHING;

-- Wallets creation (Treasury + users for each asset)
INSERT INTO public.wallets (owner_type, system_id, asset_id, balance)
SELECT
  'system'::public.wallet_owner_enum,
  sa.system_id,
  at.asset_id,
  1000000000
FROM public.system_accounts sa
JOIN public.asset_types at ON at.asset_code IN ('GOLD','DIAMOND','POINTS')
WHERE sa.system_name = 'TREASURY'
ON CONFLICT (owner_type, user_id, system_id, asset_id) DO NOTHING;

-- Create User wallets
INSERT INTO public.wallets (owner_type, user_id, asset_id, balance)
SELECT
  'user'::public.wallet_owner_enum,
  u.user_id,
  at.asset_id,
  CASE at.asset_code
    WHEN 'GOLD' THEN 100
    WHEN 'DIAMOND' THEN 10
    WHEN 'POINTS' THEN 500
    ELSE 0
  END
FROM public.users u
JOIN public.asset_types at ON at.asset_code IN ('GOLD','DIAMOND','POINTS')
WHERE u.user_id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (owner_type, user_id, system_id, asset_id) DO NOTHING;

INSERT INTO public.wallets (owner_type, user_id, asset_id, balance)
SELECT
  'user'::public.wallet_owner_enum,
  u.user_id,
  at.asset_id,
  CASE at.asset_code
    WHEN 'GOLD' THEN 500
    WHEN 'DIAMOND' THEN 5
    WHEN 'POINTS' THEN 200
    ELSE 0
  END
FROM public.users u
JOIN public.asset_types at ON at.asset_code IN ('GOLD','DIAMOND','POINTS')
WHERE u.user_id = '22222222-2222-2222-2222-222222222222'
ON CONFLICT (owner_type, user_id, system_id, asset_id) DO NOTHING;
