const pool = require("../db");
const { HttpError } = require("../utils/httpError");

// to find the asset id using asset code
async function getAssetId(client, assetCode) {
  const r = await client.query(
    `SELECT asset_id FROM public.asset_types
     WHERE asset_code = $1 AND is_active = TRUE`,
    [assetCode]
  );
  if (r.rowCount === 0) throw new HttpError(400, "Invalid or inactive assetCode");
  return r.rows[0].asset_id;
}

/**
 * Resolve Treasury system_id.
 */
async function getTreasurySystemId(client) {
  const r = await client.query(
    `SELECT system_id FROM public.system_accounts
     WHERE system_name = 'TREASURY' AND is_active = TRUE`
  );
  if (r.rowCount === 0) throw new HttpError(500, "TREASURY system account not found");
  return r.rows[0].system_id;
}

// find the wallet id using user id and asset id
async function getUserWalletId(client, userId, assetId) {
  const r = await client.query(
    `SELECT wallet_id FROM public.wallets
     WHERE owner_type = 'user' AND user_id = $1 AND asset_id = $2`,
    [userId, assetId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "User wallet not found for this asset");
  return r.rows[0].wallet_id;
}

/**
 * Resolve wallet_id for treasury + asset.
 */
async function getTreasuryWalletId(client, systemId, assetId) {
  const r = await client.query(
    `SELECT wallet_id FROM public.wallets
     WHERE owner_type = 'system' AND system_id = $1 AND asset_id = $2`,
    [systemId, assetId]
  );
  if (r.rowCount === 0) throw new HttpError(500, "Treasury wallet not found for this asset");
  return r.rows[0].wallet_id;
}

/**
 * This prevents race conditions on balances.
 */
async function lockWalletRows(client, walletIdA, walletIdB) {
  const walletIds = [walletIdA, walletIdB].sort(); // deterministic lock order
  const r = await client.query(
    `SELECT wallet_id, balance
     FROM public.wallets
     WHERE wallet_id = ANY($1::uuid[])
     ORDER BY wallet_id
     FOR UPDATE`,
    [walletIds]
  );
  if (r.rowCount !== 2) throw new HttpError(500, "Failed to lock wallets");
  return r.rows;
}

/**
 * Create txn row (idempotency anchor). If already exists, return existing txn.
 */
async function createOrGetTxn(client, payload) {
  const {
    txnType, assetId, amount, fromWalletId, toWalletId, idempotencyKey, metadata
  } = payload;

  try {
    // so current transaction status will be pending
    const ins = await client.query(
      `INSERT INTO public.transactions
       (txn_type, txn_status, asset_id, amount, from_wallet_id, to_wallet_id, idempotency_key, metadata)
       VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7)
       RETURNING txn_id, txn_status, txn_type, amount, asset_id, from_wallet_id, to_wallet_id, idempotency_key, created_at`,
      [txnType, assetId, amount, fromWalletId, toWalletId, idempotencyKey, metadata || null]
    );
    return { mode: "new", txn: ins.rows[0] };
  } catch (e) {
    // Unique violation => idempotency replay
    if (e && e.code === "23505") {
      const ex = await client.query(
        `SELECT txn_id, txn_status, txn_type, amount, asset_id, from_wallet_id, to_wallet_id, idempotency_key, created_at
         FROM public.transactions
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      if (ex.rowCount === 0) throw e;
      return { mode: "existing", txn: ex.rows[0] };
    }
    throw e;
  }
}

/**
 * Post (apply) a transaction: update balances + ledger entries + txn_status=success
 * All inside ONE DB transaction.
 */
async function postTransaction(client, txnId, fromWalletId, toWalletId, amount) {
  //(Race condition prevention) lock both wallets
  const locked = await lockWalletRows(client, fromWalletId, toWalletId);

  const fromRow = locked.find(x => x.wallet_id === fromWalletId);
  const toRow = locked.find(x => x.wallet_id === toWalletId);

  // Debit must be possible without negative (SPEND path uses this check)
  if (BigInt(fromRow.balance) < BigInt(amount)) {
    // Mark txn failed but DO NOT change balances.
    await client.query(
      `UPDATE public.transactions SET txn_status='failed', updated_at=NOW() WHERE txn_id=$1`,
      [txnId]
    );
    return { status: "failed", reason: "INSUFFICIENT_FUNDS" };
  }

  // Apply balance updates (still under lock)
  await client.query(
    `UPDATE public.wallets
     SET balance = balance - $1, updated_at = NOW()
     WHERE wallet_id = $2`,
    [amount, fromWalletId]
  );
  await client.query(
    `UPDATE public.wallets
     SET balance = balance + $1, updated_at = NOW()
     WHERE wallet_id = $2`,
    [amount, toWalletId]
  );

  // Read updated balances (needed for ledger current_balance)
  const b = await client.query(
    `SELECT wallet_id, balance
     FROM public.wallets
     WHERE wallet_id = ANY($1::uuid[])`,
    [[fromWalletId, toWalletId]]
  );

  const fromBal = b.rows.find(x => x.wallet_id === fromWalletId)?.balance;
  const toBal = b.rows.find(x => x.wallet_id === toWalletId)?.balance;

  // Insert double-entry ledger rows
  await client.query(
    `INSERT INTO public.ledger_entries (txn_id, wallet_id, entry_type, amount, current_balance)
     VALUES
       ($1, $2, 'debit',  $3, $4),
       ($1, $5, 'credit', $3, $6)`,
    [txnId, fromWalletId, amount, fromBal, toWalletId, toBal]
  );

  // Mark transaction success
  await client.query(
    `UPDATE public.transactions
     SET txn_status='success', updated_at=NOW()
     WHERE txn_id=$1`,
    [txnId]
  );

  return {
    status: "success",
    from_balance: fromBal,
    to_balance: toBal,
  };
}


async function executeTransfer({ txnType, userId, assetCode, amount, idempotencyKey, metadata }) {
  if (!idempotencyKey) 
    throw new HttpError(400, "Idempotency-Key header is required");
  if (!userId) 
    throw new HttpError(400, "userId is required");
  if (!assetCode) 
    throw new HttpError(400, "assetCode is required");
  if (!Number.isInteger(amount) || amount <= 0) 
    throw new HttpError(400, "amount must be a positive integer");

  const client = await pool.connect();

  try {
    const userCheck = await client.query(
      `SELECT user_id FROM public.users WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
    if (userCheck.rowCount === 0) throw new HttpError(404, "User not found or inactive");

    const normalizedAssetCode = String(assetCode).trim().toUpperCase();
    const assetCheck = await client.query(
      `SELECT asset_id FROM public.asset_types WHERE asset_code = $1 AND is_active = TRUE`,
      [normalizedAssetCode]
    );
    if (assetCheck.rowCount === 0) throw new HttpError(400, `Invalid assetCode: ${normalizedAssetCode}`);

    await client.query("BEGIN");

    const assetId = assetCheck.rows[0].asset_id;
    const treasurySystemId = await getTreasurySystemId(client);

    const userWalletId = await getUserWalletId(client, userId, assetId);
    const treasuryWalletId = await getTreasuryWalletId(client, treasurySystemId, assetId);

    const fromWalletId = txnType === "spend" ? userWalletId : treasuryWalletId;
    const toWalletId = txnType === "spend" ? treasuryWalletId : userWalletId;

    // lock wallets BEFORE inserting transaction (prevents FK/lock-order deadlocks)
    await lockWalletRows(client, fromWalletId, toWalletId);

    const { mode, txn } = await createOrGetTxn(client, {
      txnType,
      assetId,
      amount,
      fromWalletId,
      toWalletId,
      idempotencyKey,
      metadata,
    });

    if (mode === "existing") {
      if (txn.txn_status === "success") {
        const bal = await client.query(`SELECT balance FROM public.wallets WHERE wallet_id=$1`, [userWalletId]);
        await client.query("COMMIT");
        return { replay: true, txn_id: txn.txn_id, txn_status: txn.txn_status, user_balance: bal.rows[0].balance };
      }

      if (txn.txn_status === "failed") {
        await client.query("COMMIT");
        return { replay: true, txn_id: txn.txn_id, txn_status: txn.txn_status };
      }

      await client.query("COMMIT");
      throw new HttpError(409, "Transaction is still pending for this idempotency key");
    }

    const result = await postTransaction(client, txn.txn_id, fromWalletId, toWalletId, amount, { skipLock: true });

    const bal = await client.query(`SELECT balance FROM public.wallets WHERE wallet_id=$1`, [userWalletId]);

    await client.query("COMMIT");

    if (result.status === "failed") {
      return { replay: false, txn_id: txn.txn_id, txn_status: "failed", reason: result.reason, user_balance: bal.rows[0].balance };
    }

    return { replay: false, txn_id: txn.txn_id, txn_status: "success", user_balance: bal.rows[0].balance };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

//Balance read

async function getUserBalance({ userId, assetCode }) {
  const client = await pool.connect();
  try {
    if (!userId) throw new HttpError(400, "userId is required");

    if (assetCode) {
      const asset = await client.query(
        `SELECT asset_id FROM public.asset_types WHERE asset_code=$1 AND is_active=TRUE`,
        [assetCode]
      );
      if (asset.rowCount === 0) throw new HttpError(400, "Invalid assetCode");

      const r = await client.query(
        `SELECT w.balance, a.asset_code, a.asset_name
         FROM public.wallets w
         JOIN public.asset_types a ON a.asset_id = w.asset_id
         WHERE w.owner_type='user' AND w.user_id=$1 AND w.asset_id=$2`,
        [userId, asset.rows[0].asset_id]
      );
      if (r.rowCount === 0) throw new HttpError(404, "Wallet not found for this asset");
      return r.rows[0];
    }

    const all = await client.query(
      `SELECT a.asset_code, a.asset_name, w.balance
       FROM public.wallets w
       JOIN public.asset_types a ON a.asset_id = w.asset_id
       WHERE w.owner_type='user' AND w.user_id=$1
       ORDER BY a.asset_code`,
      [userId]
    );
    return all.rows;
  } finally {
    client.release();
  }
}

// Transaction history
async function getUserTransactions({ userId, limit = 20, offset = 0 }) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT t.txn_id, t.txn_type, t.txn_status, t.amount, a.asset_code, t.created_at, t.metadata
       FROM public.transactions t
       JOIN public.wallets w_from ON w_from.wallet_id = t.from_wallet_id
       JOIN public.wallets w_to   ON w_to.wallet_id   = t.to_wallet_id
       JOIN public.asset_types a  ON a.asset_id = t.asset_id
       WHERE (w_from.owner_type='user' AND w_from.user_id=$1)
          OR (w_to.owner_type='user' AND w_to.user_id=$1)
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return r.rows;
  } finally {
    client.release();
  }
}

module.exports = {
  executeTransfer,
  getUserBalance,
  getUserTransactions
};
