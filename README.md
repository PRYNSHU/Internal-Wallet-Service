# Internal Wallet Service (Assignment)

It is a production-style wallet service for a high-traffic app (gaming / loyalty points).  
It tracks user balances for multiple asset types (e.g., **GOLD**, **DIAMOND**, **POINTS**) and ensures correctness under concurrency and retries.

---
## Project features

- Tracks **virtual credits** (closed-loop, in-app only)
- Supports 3 transactional flows:
  1. **Top-up (Purchase)**: Treasury → User
  2. **Bonus/Incentive**: Treasury → User
  3. **Spend (Purchase inside app)**: User → Treasury
- Guarantees:
  - Balances never go negative
  - No partial updates (all-or-nothing)
  - Tested under high traffic (concurrency control)
  - Retry-safe via idempotency keys
---

## Tech Stack (and why)

- **Node.js (JavaScript) + Express**
  - Simple, readable, fast to review and test; ideal for REST APIs.
- **PostgreSQL**
  - ACID transactions + row-level locking makes it reliable under concurrency.
- **Docker + Docker Compose**
  - One-command setup for API + DB; reproducible environment for evaluators.

---

## Features Implemented

### Core requirements
- **Asset Types**
  - Example assets: `GOLD`, `DIAMOND`, `POINTS`.
- **System Account**
  - `TREASURY` system wallet acts as source/destination of credits.
- **User Accounts**
  - At least two users with initial balances (seeded).
- **RESTful Endpoints**
  - Top-up, bonus, spend
  - Get balance
  - List users with balances
  - Transaction history

### Bonus points 🌟
- **Ledger-based architecture (double-entry ledger)**
  - Each transaction writes debit & credit ledger entries for auditability.
- **Containerization**
  - Dockerfile + docker-compose for automatic setup.
- **Deadlock avoidance**
  - Wallet rows are locked in deterministic order to reduce lock cycles under load.

---
## How to run (step-by-step)

### Prerequisites
- Docker + Docker Compose installed

### 1 Clone the repository
```bash
git clone https://github.com/PRYNSHU/Internal-Wallet-Service.git
cd Internal-Wallet-Service
```

To reset the DB as Seed.sql file already added, it will run automatically
```bash
docker compose down -v
```

Finally run this one
```bash
docker compose up --build
```

- postman .json file is also provided in the repo please import and test everything.
---

## API List (Quick Reference)

Base URL (local): `http://localhost:3000`

### Health
- `GET /health`

### Wallet (Core flows)
- `POST /api/v1/wallet/topup`  
- `POST /api/v1/wallet/bonus`  
- `POST /api/v1/wallet/spend`  
> Mutation endpoints require header: `Idempotency-Key: <unique-key>`

### Wallet (Read)
- `GET /api/v1/wallet/:userId/balance?asset=GOLD` (single asset)  
- `GET /api/v1/wallet/:userId/balance` (all assets)

### Transactions (History)
- `GET /api/v1/wallet/:userId/transactions?limit=20&offset=0`

