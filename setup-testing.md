# Testing Setup Guide for Easy Wager on Solana

This guide will help you set up and test the wager system with real Solana wallets.

## Prerequisites

### 1. Install Solana CLI
```bash
# Option 1: Direct install (macOS/Linux)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"

# Option 2: If curl fails, download manually
# Go to https://github.com/solana-labs/solana/releases/latest
# Download the appropriate binary for your system

# Option 3: Using package managers
# macOS with Homebrew:
brew install solana

# Update your PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

### 2. Install Rust (if not already installed)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup component add rustfmt
rustup update
```

### 3. Install Anchor CLI
```bash
# Install avm (Anchor Version Manager)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install Anchor
avm install latest
avm use latest
```

## Testing Environment Setup

### 1. Configure Solana for Local Testing
```bash
# Set to localnet for testing
solana config set --url localhost

# Create a test wallet (or use existing)
solana-keygen new --outfile ~/.config/solana/test-wallet.json --no-bip39-passphrase

# Set as default wallet
solana config set --keypair ~/.config/solana/test-wallet.json

# Check configuration
solana config get
```

### 2. Start Local Validator
```bash
# Start local validator with necessary programs
solana-test-validator \
  --ledger test-ledger \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s ~/.local/share/solana/install/active_release/bin/spl_token_metadata.so \
  --reset
```

### 3. Fund Test Accounts
```bash
# In a new terminal, fund your test wallet
solana airdrop 10

# Check balance
solana balance
```

## Build and Deploy

### 1. Build the Program
```bash
anchor build
```

### 2. Deploy to Local Validator
```bash
anchor deploy
```

### 3. Update Program ID
After deployment, update the program ID in:
- `Anchor.toml`
- `programs/easy_wager_on_sol/src/lib.rs` (declare_id!)
- `sdk/utils.ts` (WAGER_PROGRAM_ID)

## Running Tests

### 1. Basic Test Run
```bash
npm test
```

### 2. Run with Coverage
```bash
npm run test:coverage
```

### 3. Run Specific Test File
```bash
npx mocha tests/wager.test.ts --timeout 60000
```

## Manual Testing with Real Wallets

See the examples in `tests/manual-wallet-test.ts` for step-by-step wallet testing.
