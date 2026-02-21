const { executeTransfer, getUserBalance, getUserTransactions } = require("../services/wallet-service");

function getIdempotencyKey(req) {
  return req.header("Idempotency-Key") || req.header("idempotency-key") || null;
}

async function topup(req, res, next) {
  try {
    const { userId, assetCode, amount, metadata } = req.body;
    console.log('topup executed...');
    const result = await executeTransfer({
      txnType: "topup",
      userId,
      assetCode,
      amount,
      idempotencyKey: getIdempotencyKey(req),
      metadata: metadata || { source: "payment" }
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) { next(e); }
}

async function bonus(req, res, next) {
  try {
    const { userId, assetCode, amount, reason } = req.body;
    const result = await executeTransfer({
      txnType: "bonus",
      userId,
      assetCode,
      amount,
      idempotencyKey: getIdempotencyKey(req),
      metadata: { reason: reason || "bonus" }
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) { next(e); }
}

async function spend(req, res, next) {
  try {
    const { userId, assetCode, amount, itemId } = req.body;
    const result = await executeTransfer({
      txnType: "spend",
      userId,
      assetCode,
      amount,
      idempotencyKey: getIdempotencyKey(req),
      metadata: { itemId: itemId || null }
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) { next(e); }
}

async function balance(req, res, next) {
  try {
    const { userId } = req.params;
    const { asset } = req.query;
    const data = await getUserBalance({ userId, assetCode: asset });
    return res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
}

async function transactions(req, res, next) {
  try {
    const { userId } = req.params;
    const limit = Number(req.query.limit || 20);
    const offset = Number(req.query.offset || 0);
    const data = await getUserTransactions({ userId, limit, offset });
    return res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
}

module.exports = { topup, bonus, spend, balance, transactions };
