# 🧪 Testing Guide - Easy Wager on Solana

This guide will walk you through testing the wager system with real Solana wallets step by step.

## 🚀 Quick Start (Automated)

The fastest way to test everything:

```bash
# Option 1: Full automated test suite
npm run test:full

# Option 2: Just wallet tests (if validator already running)
npm run test:wallet
```

## 📋 Manual Setup (If you prefer step-by-step)

### 1. Install Prerequisites

**Install Solana CLI:**
```bash
# macOS/Linux
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
```

**Install Rust & Anchor:**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Verify
anchor --version
```

### 2. Start Local Validator

```bash
# Start local Solana validator
npm run dev

# Or manually:
solana-test-validator --ledger test-ledger --reset
```

Keep this terminal open! The validator needs to stay running.

### 3. Setup Solana Configuration (New Terminal)

```bash
# Set to localhost
solana config set --url localhost

# Create test wallet
solana-keygen new --outfile ~/.config/solana/test-wallet.json --no-bip39-passphrase

# Set as default
solana config set --keypair ~/.config/solana/test-wallet.json

# Fund wallet
solana airdrop 10

# Check balance
solana balance
```

### 4. Build & Deploy Program

```bash
# Build
anchor build

# Deploy
anchor deploy
```

### 5. Run Tests

```bash
# Run wallet tests
npm run test:wallet

# Or run examples
npm run test:examples

# Or run unit tests
npm run test:unit
```

## 🎯 What the Tests Do

### Wallet Test (`npm run test:wallet`)

The wallet test creates real Solana keypairs and demonstrates:

1. **Wallet Setup**: Creates 4 test wallets (creator, player2, resolver, dev_wallet)
2. **Funding**: Airdrops SOL to test wallets  
3. **Token Creation**: Creates a test SPL token and mints to players
4. **SOL Wager Flow**:
   - Creator creates a 0.1 SOL wager game (85% winner, 15% dev fee)
   - Player2 joins by depositing 0.1 SOL
   - Resolver declares Player2 as winner
   - Funds distributed automatically
5. **SPL Token Wager Flow**:
   - Creator creates a 10-token wager (90% winner, 10% dev fee)
   - Player2 joins with matching tokens
   - Creator wins this time
   - Tokens distributed
6. **Game Management**: Queries games by state and creator

### Example Output:
```
🔐 Setting up test wallets...

✨ Created new creator wallet: 8x1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7q8R9s0T1u
✨ Created new player2 wallet: 9y2b3C4d5E6f7G8h9I0j1K2l3M4n5O6p7Q8r9S0t1U2v
✨ Created new resolver wallet: 1z3c4D5e6F7g8H9i0J1k2L3m4N5o6P7q8R9s0T1u2V3w
✨ Created new dev_wallet wallet: 2a4d5E6f7G8h9I0j1K2l3M4n5O6p7Q8r9S0t1U2v3W4x

💰 Funding test wallets...

✅ creator balance: 5 SOL
✅ player2 balance: 5 SOL
✅ resolver balance: 1 SOL
✅ dev_wallet balance: 0.5 SOL

🪙 Creating test SPL token...

✅ Test token created: ABcD1eFgH2iJkL3mNoPqR4sTuV5wXyZ6...
✅ Minted 1000 tokens to creator and player2

🎲 Testing Native SOL Wager...

1. Creating SOL wager game...
✅ Game created!
   Transaction: 3x4y5Z6a7B8c9D0e1F2g3H4i5J6k7L8m9N0o1P2q3R4s5T6u7V8w9X0y1Z2a3B4c
   Game PDA: 4y5Z6a7B8c9D0e1F2g3H4i5J6k7L8m9N0o1P2q3R4s5T6u7V8w9X0y1Z2a3B4c5D
   State: Open
   Wager: 0.1 SOL

2. Player2 joining the game...
✅ Player2 joined!
   Transaction: 5z6A7b8C9d0E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8W9x0Y1z2A3b4C5d6E
   New State: Ready

3. Resolving the game (player2 wins)...
✅ Game resolved!
   Transaction: 6a7B8c9D0e1F2g3H4i5J6k7L8m9N0o1P2q3R4s5T6u7V8w9X0y1Z2a3B4c5D6e7F
   Winner amount: 0.17 SOL
   Dev fee: 0.03 SOL
   Winner balance change: 0.07 SOL (after gas)
   Dev balance change: 0.03 SOL

🎉 All tests completed successfully!
```

## 🛠️ Test Options

### Different Test Types:

```bash
# Full automated suite (builds, deploys, runs everything)
npm run test:full

# Just wallet tests (assumes validator running)
npm run test:wallet

# Unit tests with Mocha framework
npm run test:unit

# Run usage examples
npm run test:examples

# Clean everything and start fresh
npm run clean
```

### Test on Different Networks:

**Local (Recommended for testing):**
```bash
solana config set --url localhost
npm run test:wallet
```

**Devnet (For integration testing):**
```bash
solana config set --url devnet
# You'll need to fund wallets manually or use faucets
npm run test:wallet
```

## 📁 Test Wallet Management

Test wallets are automatically saved in `test-wallets/` directory:
- `creator.json`
- `player2.json` 
- `resolver.json`
- `dev_wallet.json`

You can reuse these wallets across test runs. To start fresh:
```bash
rm -rf test-wallets/
```

## 🔧 Troubleshooting

**"Validator not running"**
```bash
# Start validator in separate terminal
solana-test-validator --ledger test-ledger --reset
```

**"Program not deployed"**
```bash
anchor build
anchor deploy
```

**"Insufficient funds"**
```bash
solana airdrop 10
```

**"Connection refused"**
```bash
# Make sure validator is running and config is set
solana config set --url localhost
solana cluster-version
```

**"Anchor not found"**
```bash
# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

## 📊 Understanding Test Results

### Successful SOL Wager:
- **Total Pot**: 2 × wager amount (0.2 SOL)
- **Winner Gets**: 85% of pot (0.17 SOL) 
- **Dev Fee**: 15% of pot (0.03 SOL)
- **Net Winner Gain**: ~0.07 SOL (after deducting original wager + gas)

### Successful SPL Token Wager:
- **Total Pot**: 2 × wager amount (20 tokens)
- **Winner Gets**: 90% of pot (18 tokens)
- **Dev Fee**: 10% of pot (2 tokens)
- **Net Winner Gain**: 8 tokens (after deducting original wager)

## 🎮 Next Steps

After testing successfully, you can:

1. **Integrate into your app**: Use the SDK in your frontend
2. **Deploy to devnet**: Test with real users
3. **Add custom resolution logic**: Implement commit-reveal or VRF
4. **Build a UI**: Create a web interface for players

Check out the `examples/` directory for more integration examples!

## 🆘 Need Help?

If tests fail or you encounter issues:
1. Check the validator is running: `solana cluster-version`
2. Verify program is deployed: `solana program show <PROGRAM_ID>`
3. Check wallet balances: `solana balance`
4. Look at the test output for specific error messages

The test suite is designed to be robust and provide clear error messages to help you debug any issues.
