/**
 * Manual Wallet Testing Script
 * 
 * This script demonstrates how to test the wager system with real Solana wallets.
 * It creates test wallets, funds them, and runs through the complete wager flow.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

import {
  WagerClient,
  GameState,
  hoursFromNow,
  generateNonce,
} from '../sdk';

// Configuration
const CLUSTER = 'localnet'; // Change to 'devnet' for devnet testing
const RPC_URL = CLUSTER === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl('devnet');

class WalletTester {
  private connection: Connection;
  private wagerClient: WagerClient;
  private testWallets: { [key: string]: Keypair } = {};

  constructor() {
    this.connection = new Connection(RPC_URL, 'confirmed');
    this.wagerClient = new WagerClient(this.connection);
  }

  /**
   * Create or load test wallets
   */
  async setupWallets(): Promise<void> {
    console.log('🔐 Setting up test wallets...\n');

    const walletNames = ['creator', 'player2', 'resolver', 'dev_wallet'];

    for (const name of walletNames) {
      const walletPath = path.join(__dirname, `../test-wallets/${name}.json`);
      
      try {
        // Try to load existing wallet
        if (fs.existsSync(walletPath)) {
          const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
          this.testWallets[name] = Keypair.fromSecretKey(new Uint8Array(secretKey));
          console.log(`📂 Loaded existing ${name} wallet:`, this.testWallets[name].publicKey.toString());
        } else {
          // Create new wallet
          this.testWallets[name] = Keypair.generate();
          
          // Create directory if it doesn't exist
          const dir = path.dirname(walletPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          // Save wallet
          fs.writeFileSync(
            walletPath,
            JSON.stringify(Array.from(this.testWallets[name].secretKey))
          );
          console.log(`✨ Created new ${name} wallet:`, this.testWallets[name].publicKey.toString());
        }
      } catch (error) {
        console.error(`❌ Error setting up ${name} wallet:`, error);
        // Fallback to in-memory wallet
        this.testWallets[name] = Keypair.generate();
        console.log(`🔄 Using in-memory ${name} wallet:`, this.testWallets[name].publicKey.toString());
      }
    }

    console.log();
  }

  /**
   * Fund test wallets with SOL
   */
  async fundWallets(): Promise<void> {
    console.log('💰 Funding test wallets...\n');

    const fundingAmounts = {
      creator: 5 * LAMPORTS_PER_SOL,
      player2: 5 * LAMPORTS_PER_SOL,
      resolver: 1 * LAMPORTS_PER_SOL,
      dev_wallet: 0.5 * LAMPORTS_PER_SOL,
    };

    for (const [name, amount] of Object.entries(fundingAmounts)) {
      try {
        if (CLUSTER === 'localnet') {
          // For local testing, airdrop SOL
          const signature = await this.connection.requestAirdrop(
            this.testWallets[name].publicKey,
            amount
          );
          await this.connection.confirmTransaction(signature);
        } else {
          // For devnet, you'd need to use a faucet or fund manually
          console.log(`🚰 For devnet testing, please fund ${name} manually:`);
          console.log(`   Address: ${this.testWallets[name].publicKey.toString()}`);
          console.log(`   Amount needed: ${amount / LAMPORTS_PER_SOL} SOL`);
        }

        // Check balance
        const balance = await this.connection.getBalance(this.testWallets[name].publicKey);
        console.log(`✅ ${name} balance: ${balance / LAMPORTS_PER_SOL} SOL`);
      } catch (error) {
        console.error(`❌ Error funding ${name}:`, error);
      }
    }

    console.log();
  }

  /**
   * Create a test SPL token for testing
   */
  async createTestToken(): Promise<PublicKey> {
    console.log('🪙 Creating test SPL token...\n');

    try {
      const testToken = await createMint(
        this.connection,
        this.testWallets.creator,
        this.testWallets.creator.publicKey,
        null,
        6 // 6 decimals like USDC
      );

      console.log('✅ Test token created:', testToken.toString());

      // Mint tokens to creator and player2
      const creatorTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.testWallets.creator,
        testToken,
        this.testWallets.creator.publicKey
      );

      const player2TokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.testWallets.creator,
        testToken,
        this.testWallets.player2.publicKey
      );

      // Mint 1000 tokens to each
      await mintTo(
        this.connection,
        this.testWallets.creator,
        testToken,
        creatorTokenAccount.address,
        this.testWallets.creator,
        1000 * 10**6 // 1000 tokens with 6 decimals
      );

      await mintTo(
        this.connection,
        this.testWallets.creator,
        testToken,
        player2TokenAccount.address,
        this.testWallets.creator,
        1000 * 10**6
      );

      console.log('✅ Minted 1000 tokens to creator and player2');
      console.log();

      return testToken;
    } catch (error) {
      console.error('❌ Error creating test token:', error);
      throw error;
    }
  }

  /**
   * Test Native SOL Wager
   */
  async testSOLWager(): Promise<void> {
    console.log('🎲 Testing Native SOL Wager...\n');

    try {
      const wagerAmount = new BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
      
      // 1. Create game
      console.log('1. Creating SOL wager game...');
      const { signature: createSig, gamePda } = await this.wagerClient.createGame(
        this.testWallets.creator,
        {
          mint: PublicKey.default, // Native SOL
          wager: wagerAmount,
          payoutBps: 8500, // 85% to winner, 15% to dev
          expiryTs: hoursFromNow(24),
          devWallet: this.testWallets.dev_wallet.publicKey,
          resolverPubkey: this.testWallets.resolver.publicKey,
          nonce: generateNonce(),
        }
      );

      console.log('✅ Game created!');
      console.log('   Transaction:', createSig);
      console.log('   Game PDA:', gamePda.toString());

      // 2. Check game details
      const gameAccount = await this.wagerClient.getGame(gamePda);
      console.log('   State:', GameState[gameAccount.state]);
      console.log('   Wager:', gameAccount.wager.toNumber() / LAMPORTS_PER_SOL, 'SOL');
      console.log();

      // 3. Player2 joins
      console.log('2. Player2 joining the game...');
      const { signature: joinSig } = await this.wagerClient.joinGame(
        this.testWallets.player2,
        gamePda
      );

      console.log('✅ Player2 joined!');
      console.log('   Transaction:', joinSig);
      
      // Check updated state
      const readyGame = await this.wagerClient.getGame(gamePda);
      console.log('   New State:', GameState[readyGame.state]);
      console.log();

      // 4. Get balances before resolution
      const winnerBalanceBefore = await this.connection.getBalance(this.testWallets.player2.publicKey);
      const devBalanceBefore = await this.connection.getBalance(this.testWallets.dev_wallet.publicKey);

      // 5. Resolve game (player2 wins)
      console.log('3. Resolving the game (player2 wins)...');
      const { signature: resolveSig, payouts } = await this.wagerClient.resolveGame(
        this.testWallets.resolver,
        gamePda,
        this.testWallets.player2.publicKey
      );

      console.log('✅ Game resolved!');
      console.log('   Transaction:', resolveSig);
      console.log('   Winner amount:', payouts.winnerAmount.toNumber() / LAMPORTS_PER_SOL, 'SOL');
      console.log('   Dev fee:', payouts.feeAmount.toNumber() / LAMPORTS_PER_SOL, 'SOL');

      // 6. Verify balances
      const winnerBalanceAfter = await this.connection.getBalance(this.testWallets.player2.publicKey);
      const devBalanceAfter = await this.connection.getBalance(this.testWallets.dev_wallet.publicKey);

      console.log('   Winner balance change:', (winnerBalanceAfter - winnerBalanceBefore) / LAMPORTS_PER_SOL, 'SOL');
      console.log('   Dev balance change:', (devBalanceAfter - devBalanceBefore) / LAMPORTS_PER_SOL, 'SOL');
      console.log();

    } catch (error) {
      console.error('❌ SOL Wager test failed:', error);
      throw error;
    }
  }

  /**
   * Test SPL Token Wager
   */
  async testSPLWager(tokenMint: PublicKey): Promise<void> {
    console.log('🪙 Testing SPL Token Wager...\n');

    try {
      const wagerAmount = new BN(10 * 10**6); // 10 tokens (6 decimals)

      // 1. Create SPL token game
      console.log('1. Creating SPL token wager game...');
      const { signature: createSig, gamePda } = await this.wagerClient.createGame(
        this.testWallets.creator,
        {
          mint: tokenMint,
          wager: wagerAmount,
          payoutBps: 9000, // 90% to winner, 10% to dev
          expiryTs: hoursFromNow(48),
          devWallet: this.testWallets.dev_wallet.publicKey,
          resolverPubkey: this.testWallets.resolver.publicKey,
          nonce: generateNonce(),
        }
      );

      console.log('✅ SPL token game created!');
      console.log('   Transaction:', createSig);
      console.log('   Game PDA:', gamePda.toString());
      console.log();

      // 2. Player2 joins
      console.log('2. Player2 joining SPL token game...');
      const { signature: joinSig } = await this.wagerClient.joinGame(
        this.testWallets.player2,
        gamePda
      );

      console.log('✅ Player2 joined SPL game!');
      console.log('   Transaction:', joinSig);
      console.log();

      // 3. Resolve game (creator wins this time)
      console.log('3. Resolving SPL game (creator wins)...');
      const { signature: resolveSig, payouts } = await this.wagerClient.resolveGame(
        this.testWallets.resolver,
        gamePda,
        this.testWallets.creator.publicKey
      );

      console.log('✅ SPL game resolved!');
      console.log('   Transaction:', resolveSig);
      console.log('   Winner amount:', payouts.winnerAmount.toNumber() / 10**6, 'tokens');
      console.log('   Dev fee:', payouts.feeAmount.toNumber() / 10**6, 'tokens');
      console.log();

    } catch (error) {
      console.error('❌ SPL Token wager test failed:', error);
      throw error;
    }
  }

  /**
   * Test game management functions
   */
  async testGameManagement(): Promise<void> {
    console.log('📊 Testing Game Management...\n');

    try {
      // Get games by creator
      const creatorGames = await this.wagerClient.getGamesByCreator(
        this.testWallets.creator.publicKey
      );
      console.log('✅ Games by creator:', creatorGames.length);

      // Get open games
      const openGames = await this.wagerClient.getOpenGames();
      console.log('✅ Open games:', openGames.length);

      // Get ready games
      const readyGames = await this.wagerClient.getReadyGames();
      console.log('✅ Ready games:', readyGames.length);

      console.log();
    } catch (error) {
      console.error('❌ Game management test failed:', error);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Comprehensive Wager System Test\n');
    console.log('='.repeat(50));
    console.log();

    try {
      // Setup
      await this.setupWallets();
      await this.fundWallets();
      
      // Wait a moment for funding to settle
      console.log('⏳ Waiting for transactions to settle...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Create test token
      const testToken = await this.createTestToken();

      // Run tests
      await this.testSOLWager();
      await this.testSPLWager(testToken);
      await this.testGameManagement();

      console.log('🎉 All tests completed successfully!');
      console.log('='.repeat(50));

    } catch (error) {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new WalletTester();
  tester.runAllTests().catch(console.error);
}

export { WalletTester };
