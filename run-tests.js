#!/usr/bin/env node

/**
 * Simple test runner for the Wager system
 * This script helps you run tests step by step
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class TestRunner {
  constructor() {
    this.processes = [];
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      console.log(`🔧 Running: ${command}`);
      
      const child = exec(command, options, (error, stdout, stderr) => {
        if (error && !options.ignoreErrors) {
          console.error(`❌ Command failed: ${command}`);
          console.error(stderr);
          reject(error);
        } else {
          if (stdout) console.log(stdout);
          if (stderr && !options.ignoreErrors) console.warn(stderr);
          resolve(stdout);
        }
      });

      this.processes.push(child);
    });
  }

  async checkSolanaInstalled() {
    try {
      await this.runCommand('solana --version', { ignoreErrors: true });
      return true;
    } catch {
      return false;
    }
  }

  async checkValidatorRunning() {
    try {
      await this.runCommand('solana cluster-version', { ignoreErrors: true });
      return true;
    } catch {
      return false;
    }
  }

  async startLocalValidator() {
    console.log('🚀 Starting local Solana validator...');
    
    // Check if test-ledger exists and remove it for fresh start
    if (fs.existsSync('test-ledger')) {
      console.log('🗑️  Cleaning up old test ledger...');
      await this.runCommand('rm -rf test-ledger');
    }

    // Start validator in background
    const validator = spawn('solana-test-validator', ['--ledger', 'test-ledger', '--reset'], {
      stdio: 'pipe',
      detached: true
    });

    validator.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('RPC URL:') || output.includes('JSON RPC URL:')) {
        console.log('✅ Validator started successfully!');
      }
    });

    validator.stderr.on('data', (data) => {
      const error = data.toString();
      if (!error.includes('WARN') && !error.includes('INFO')) {
        console.warn('⚠️ Validator warning:', error);
      }
    });

    this.processes.push(validator);

    // Wait for validator to start
    console.log('⏳ Waiting for validator to start...');
    await this.delay(5000);

    // Check if it's running
    let retries = 10;
    while (retries > 0) {
      try {
        await this.runCommand('solana cluster-version', { ignoreErrors: true });
        break;
      } catch {
        retries--;
        if (retries === 0) {
          throw new Error('Validator failed to start');
        }
        console.log(`⏳ Waiting for validator... (${retries} retries left)`);
        await this.delay(2000);
      }
    }
  }

  async setupSolanaConfig() {
    console.log('⚙️  Setting up Solana configuration...');
    
    // Set cluster to localhost
    await this.runCommand('solana config set --url localhost');
    
    // Create or check for test wallet
    const walletPath = path.join(process.env.HOME, '.config/solana/test-wallet.json');
    if (!fs.existsSync(walletPath)) {
      console.log('🔐 Creating test wallet...');
      await this.runCommand(`solana-keygen new --outfile ${walletPath} --no-bip39-passphrase --force`);
    }
    
    // Set as default wallet
    await this.runCommand(`solana config set --keypair ${walletPath}`);
    
    // Airdrop some SOL
    console.log('💰 Airdropping SOL to test wallet...');
    try {
      await this.runCommand('solana airdrop 10');
    } catch (error) {
      console.warn('⚠️ Airdrop failed, but continuing...');
    }
    
    // Show config
    await this.runCommand('solana config get');
  }

  async buildAndDeploy() {
    console.log('🔨 Building the program...');
    
    try {
      await this.runCommand('anchor build');
      console.log('✅ Program built successfully!');
    } catch (error) {
      console.error('❌ Build failed. Make sure Anchor is installed:');
      console.error('   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force');
      console.error('   avm install latest && avm use latest');
      throw error;
    }

    console.log('🚀 Deploying the program...');
    await this.runCommand('anchor deploy');
    console.log('✅ Program deployed successfully!');
  }

  async runWalletTests() {
    console.log('🧪 Running wallet tests...');
    
    // Run the manual wallet test
    await this.runCommand('npx ts-node tests/manual-wallet-test.ts');
  }

  async runMochaTests() {
    console.log('🧪 Running Mocha tests...');
    
    // Run the mocha test suite
    await this.runCommand('npm test');
  }

  cleanup() {
    console.log('🧹 Cleaning up processes...');
    this.processes.forEach(proc => {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    });
  }

  async runFullTestSuite() {
    console.log('🎯 Easy Wager on Solana - Full Test Suite');
    console.log('='.repeat(50));
    console.log();

    try {
      // Check prerequisites
      console.log('📋 Checking prerequisites...');
      
      const solanaInstalled = await this.checkSolanaInstalled();
      if (!solanaInstalled) {
        console.error('❌ Solana CLI not found. Please install it first:');
        console.error('   sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"');
        console.error('   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"');
        process.exit(1);
      }

      // Check if validator is already running
      const validatorRunning = await this.checkValidatorRunning();
      if (!validatorRunning) {
        await this.startLocalValidator();
      } else {
        console.log('✅ Validator already running!');
      }

      // Setup Solana configuration
      await this.setupSolanaConfig();

      // Build and deploy
      await this.buildAndDeploy();

      // Run tests
      console.log('\n🧪 Starting test execution...');
      console.log('=' .repeat(30));
      
      // Option 1: Manual wallet tests
      console.log('\n1️⃣ Running manual wallet tests...');
      await this.runWalletTests();

      // Option 2: Mocha test suite (if you want to run it too)
      // console.log('\n2️⃣ Running Mocha test suite...');
      // await this.runMochaTests();

      console.log('\n🎉 All tests completed successfully!');
      console.log('='.repeat(50));

    } catch (error) {
      console.error('\n💥 Test suite failed:', error.message);
      process.exit(1);
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  testRunner.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received terminate signal, cleaning up...');
  testRunner.cleanup();
  process.exit(0);
});

// Main execution
const testRunner = new TestRunner();

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Easy Wager on Solana - Test Runner');
  console.log('');
  console.log('Usage: node run-tests.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h          Show this help message');
  console.log('  --wallet-only       Run only wallet tests (skip validator setup)');
  console.log('  --no-deploy         Skip build and deploy steps');
  console.log('');
  console.log('Examples:');
  console.log('  node run-tests.js                    # Full test suite');
  console.log('  node run-tests.js --wallet-only      # Just wallet tests');
  console.log('  npm run test:wallet                   # Same as above');
  process.exit(0);
}

if (args.includes('--wallet-only')) {
  testRunner.runWalletTests().catch(console.error);
} else {
  testRunner.runFullTestSuite().catch(console.error);
}
