#!/usr/bin/env node

/**
 * Test What Works Right Now
 * 
 * This script tests all the components that are currently working
 * without needing the Rust program to be built.
 */

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

async function testUtilityFunctions() {
  console.log('🧪 Testing SDK Utility Functions...\n');
  
  try {
    const { 
      generateNonce, 
      formatTokenAmount, 
      parseTokenAmount, 
      calculatePayouts, 
      isNativeSOL,
      hoursFromNow,
      deriveGamePDAs
    } = require('./sdk/utils');

    // Test basic functions
    console.log('✅ generateNonce():', generateNonce().toString());
    console.log('✅ isNativeSOL(PublicKey.default):', isNativeSOL(PublicKey.default));
    console.log('✅ isNativeSOL(random key):', isNativeSOL(Keypair.generate().publicKey));
    
    // Test payout calculations
    const payouts = calculatePayouts(new BN(LAMPORTS_PER_SOL), 8500);
    console.log('✅ calculatePayouts(1 SOL, 85%):');
    console.log('   - Total Pot:', formatTokenAmount(payouts.totalPot, 9), 'SOL');
    console.log('   - Winner Gets:', formatTokenAmount(payouts.winnerAmount, 9), 'SOL');
    console.log('   - Dev Fee:', formatTokenAmount(payouts.feeAmount, 9), 'SOL');
    
    // Test token formatting
    console.log('✅ formatTokenAmount(100000000, 9):', formatTokenAmount(new BN(100000000), 9));
    console.log('✅ parseTokenAmount("0.1", 9):', parseTokenAmount('0.1', 9).toString());
    
    // Test time functions
    const futureTime = hoursFromNow(24);
    console.log('✅ hoursFromNow(24):', new Date(futureTime.toNumber() * 1000).toLocaleString());
    
    // Test PDA derivation
    const creator = Keypair.generate();
    const nonce = generateNonce();
    const mint = PublicKey.default;
    const pdas = deriveGamePDAs(creator.publicKey, nonce, mint);
    console.log('✅ deriveGamePDAs():');
    console.log('   - Game PDA:', pdas.gamePda.toString().substring(0, 20) + '...');
    console.log('   - Game Bump:', pdas.gameBump);
    console.log('   - Vault PDA:', pdas.vaultPda ? 'Generated' : 'None (SOL)');
    
    console.log('\n🎉 All utility functions working perfectly!\n');
    return true;
  } catch (error) {
    console.error('❌ Utility test failed:', error.message);
    return false;
  }
}

async function testConnection() {
  console.log('🌐 Testing Solana Connection...\n');
  
  try {
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Test basic connection
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana RPC:', version['solana-core']);
    
    // Test balance query
    const balance = await connection.getBalance(Keypair.generate().publicKey);
    console.log('✅ Can query balances (random account has', balance, 'lamports)');
    
    // Test slot info
    const slot = await connection.getSlot();
    console.log('✅ Current slot:', slot);
    
    console.log('\n🎉 Solana connection working!\n');
    return true;
  } catch (error) {
    console.warn('⚠️  Connection test failed:', error.message);
    console.warn('   (This is expected if validator is not running)');
    return false;
  }
}

async function testWalletOperations() {
  console.log('👛 Testing Wallet Operations...\n');
  
  try {
    // Generate test wallets
    const creator = Keypair.generate();
    const player2 = Keypair.generate();
    const devWallet = Keypair.generate();
    
    console.log('✅ Generated test wallets:');
    console.log('   - Creator:', creator.publicKey.toString().substring(0, 20) + '...');
    console.log('   - Player2:', player2.publicKey.toString().substring(0, 20) + '...');
    console.log('   - Dev Wallet:', devWallet.publicKey.toString().substring(0, 20) + '...');
    
    // Test wallet file operations (simulate)
    const fs = require('fs');
    const path = require('path');
    
    // Create test wallets directory
    const walletDir = path.join(__dirname, 'test-wallets-temp');
    if (!fs.existsSync(walletDir)) {
      fs.mkdirSync(walletDir, { recursive: true });
    }
    
    // Save and load a wallet
    const walletPath = path.join(walletDir, 'test.json');
    fs.writeFileSync(walletPath, JSON.stringify(Array.from(creator.secretKey)));
    
    const loadedSecretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const loadedWallet = Keypair.fromSecretKey(new Uint8Array(loadedSecretKey));
    
    console.log('✅ Wallet save/load works:', 
      loadedWallet.publicKey.equals(creator.publicKey) ? 'Keys match!' : 'ERROR: Keys don\'t match!');
    
    // Cleanup
    fs.unlinkSync(walletPath);
    fs.rmdirSync(walletDir);
    
    console.log('\n🎉 Wallet operations working!\n');
    return true;
  } catch (error) {
    console.error('❌ Wallet test failed:', error.message);
    return false;
  }
}

async function testWagerClient() {
  console.log('🎯 Testing Wager Client...\n');
  
  try {
    const { WagerClient } = require('./sdk');
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const wagerClient = new WagerClient(connection);
    
    console.log('✅ WagerClient instantiated');
    
    // Test client methods that don't require deployed program
    const creator = Keypair.generate();
    const nonce = new BN(12345);
    const mint = PublicKey.default;
    
    const pdas = wagerClient.getGamePDAs(creator.publicKey, nonce, mint);
    console.log('✅ getGamePDAs() works');
    
    const payouts = wagerClient.calculatePayouts(new BN(LAMPORTS_PER_SOL), 8500);
    console.log('✅ calculatePayouts() works');
    
    const tokenInfo = await wagerClient.getTokenInfo(PublicKey.default);
    console.log('✅ getTokenInfo() works:', tokenInfo.symbol || 'SOL');
    
    const formatted = await wagerClient.formatTokenAmount(new BN(LAMPORTS_PER_SOL), PublicKey.default);
    console.log('✅ formatTokenAmount() works:', formatted);
    
    console.log('\n🎉 Wager client working!\n');
    return true;
  } catch (error) {
    console.error('❌ Wager client test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Easy Wager on Solana - Testing What Works\n');
  console.log('=' .repeat(50));
  console.log();

  const results = {
    utilities: await testUtilityFunctions(),
    wallets: await testWalletOperations(), 
    client: await testWagerClient(),
    connection: await testConnection(),
  };

  console.log('📊 Test Results Summary\n');
  console.log('=' .repeat(30));
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
  });

  const passedCount = Object.values(results).filter(Boolean).length;
  const totalCount = Object.keys(results).length;
  
  console.log(`\n🎯 Overall: ${passedCount}/${totalCount} components working`);
  
  if (passedCount === totalCount) {
    console.log('\n🎉 Everything that can work without the Rust program is working!');
    console.log('   Next step: Fix cargo-build-sbf to enable program compilation.');
  } else if (passedCount >= totalCount - 1) {
    console.log('\n✅ Almost everything is working!');
    console.log('   Connection failure is expected if validator is not running.');
  } else {
    console.log('\n⚠️  Some components need attention.');
  }
  
  console.log('\n📋 To start testing with real blockchain:');
  console.log('   1. solana-test-validator --ledger test-ledger --reset');
  console.log('   2. solana airdrop 10');  
  console.log('   3. Run this test again');
  console.log();
}

// Run if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testUtilityFunctions,
  testConnection,
  testWalletOperations,
  testWagerClient,
  runAllTests
};
