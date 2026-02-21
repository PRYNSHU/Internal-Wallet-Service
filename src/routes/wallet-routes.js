const express = require("express");
const { topup, bonus, spend, balance, transactions } = require("../controllers/wallet-controller");

const router = express.Router();

// Routes for wallet operations
router.post("/topup", topup);
router.post("/bonus", bonus);
router.post("/spend", spend);

// Routes for fetching balance and transactions
router.get("/:userId/balance", balance);
router.get("/:userId/transactions", transactions);

module.exports = router;
