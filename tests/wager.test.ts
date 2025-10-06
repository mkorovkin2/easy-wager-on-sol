import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  clusterApiUrl,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';

import {
  WagerClient,
  GameState,
  CreateGameArgs,
  WagerError,
  generateNonce,
  hoursFromNow,
  isNativeSOL,
  calculatePayouts,
  formatTokenAmount,
  parseTokenAmount,
} from '../sdk';

describe('Wager System Tests', () => {
  let connection: Connection;
  let wagerClient: WagerClient;
  let creator: Keypair;
  let player2: Keypair;
  let resolver: Keypair;
  let devWallet: Keypair;
  let testToken: PublicKey;
  
  // Test configuration
  const WAGER_AMOUNT = new BN(LAMPORTS_PER_SOL); // 1 SOL
  const PAYOUT_BPS = 8500; // 85% to winner, 15% to dev
  
  before(async () => {
    // Use local cluster for testing - change to devnet/testnet as needed
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    wagerClient = new WagerClient(connection);
    
    // Generate test keypairs
    creator = Keypair.generate();
    player2 = Keypair.generate();
    resolver = Keypair.generate();
    devWallet = Keypair.generate();
    
    // Fund accounts for testing
    await Promise.all([
      connection.requestAirdrop(creator.publicKey, 10 * LAMPORTS_PER_SOL),
      connection.requestAirdrop(player2.publicKey, 10 * LAMPORTS_PER_SOL),
      connection.requestAirdrop(resolver.publicKey, 2 * LAMPORTS_PER_SOL),
      connection.requestAirdrop(devWallet.publicKey, LAMPORTS_PER_SOL),
    ]);
    
    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create a test SPL token
    testToken = await createMint(
      connection,
      creator,
      creator.publicKey,
      null,
      9 // 9 decimals
    );
    
    // Mint tokens to creator and player2
    const creatorTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      creator,
      testToken,
      creator.publicKey
    );
    
    const player2TokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      creator,
      testToken,
      player2.publicKey
    );
    
    await mintTo(
      connection,
      creator,
      testToken,
      creatorTokenAccount.address,
      creator,
      1000 * LAMPORTS_PER_SOL
    );
    
    await mintTo(
      connection,
      creator,
      testToken,
      player2TokenAccount.address,
      creator,
      1000 * LAMPORTS_PER_SOL
    );
  });
  
  describe('Utility Functions', () => {
    it('should identify native SOL correctly', () => {
      expect(isNativeSOL(PublicKey.default)).to.be.true;
      expect(isNativeSOL(testToken)).to.be.false;
    });
    
    it('should calculate payouts correctly', () => {
      const { winnerAmount, feeAmount, totalPot } = calculatePayouts(WAGER_AMOUNT, PAYOUT_BPS);
      
      expect(totalPot.toString()).to.equal(WAGER_AMOUNT.muln(2).toString());
      expect(winnerAmount.toString()).to.equal(totalPot.muln(8500).divn(10000).toString());
      expect(feeAmount.toString()).to.equal(totalPot.sub(winnerAmount).toString());
      expect(winnerAmount.add(feeAmount).toString()).to.equal(totalPot.toString());
    });
    
    it('should format and parse token amounts correctly', () => {
      const amount = new BN(1234567890); // 1.23456789 tokens
      const formatted = formatTokenAmount(amount, 9);
      expect(formatted).to.equal('1.23456789');
      
      const parsed = parseTokenAmount('1.23456789', 9);
      expect(parsed.toString()).to.equal(amount.toString());
    });
  });
  
  describe('Native SOL Wager', () => {
    let gamePda: PublicKey;
    let gameArgs: CreateGameArgs;
    
    beforeEach(() => {
      gameArgs = {
        mint: PublicKey.default, // Native SOL
        wager: WAGER_AMOUNT,
        payoutBps: PAYOUT_BPS,
        expiryTs: hoursFromNow(24),
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
    });
    
    it('should create a native SOL game', async function() {
      this.timeout(30000);
      
      const result = await wagerClient.createGame(creator, gameArgs);
      gamePda = result.gamePda;
      
      expect(result.signature).to.be.a('string');
      expect(result.gamePda).to.be.instanceOf(PublicKey);
      
      // Verify game account
      const gameAccount = await wagerClient.getGame(gamePda);
      expect(gameAccount.creator.toString()).to.equal(creator.publicKey.toString());
      expect(gameAccount.mint.toString()).to.equal(PublicKey.default.toString());
      expect(gameAccount.wager.toString()).to.equal(WAGER_AMOUNT.toString());
      expect(gameAccount.payoutBps).to.equal(PAYOUT_BPS);
      expect(gameAccount.state).to.equal(GameState.Open);
      expect(gameAccount.isNativeSOL()).to.be.true;
      expect(gameAccount.canJoin()).to.be.true;
      expect(gameAccount.canResolve()).to.be.false;
    });
    
    it('should allow player2 to join the game', async function() {
      this.timeout(30000);
      
      if (!gamePda) {
        // Create game first
        const result = await wagerClient.createGame(creator, gameArgs);
        gamePda = result.gamePda;
      }
      
      const result = await wagerClient.joinGame(player2, gamePda);
      expect(result.signature).to.be.a('string');
      
      // Verify game state changed
      const gameAccount = await wagerClient.getGame(gamePda);
      expect(gameAccount.state).to.equal(GameState.Ready);
      expect(gameAccount.player2.toString()).to.equal(player2.publicKey.toString());
      expect(gameAccount.canJoin()).to.be.false;
      expect(gameAccount.canResolve()).to.be.true;
    });
    
    it('should resolve the game and distribute payouts', async function() {
      this.timeout(30000);
      
      if (!gamePda) {
        // Create and join game first
        const createResult = await wagerClient.createGame(creator, gameArgs);
        gamePda = createResult.gamePda;
        await wagerClient.joinGame(player2, gamePda);
      }
      
      // Get balances before resolution
      const winnerBalanceBefore = await connection.getBalance(player2.publicKey);
      const devWalletBalanceBefore = await connection.getBalance(devWallet.publicKey);
      
      // Resolve game with player2 as winner
      const result = await wagerClient.resolveGame(resolver, gamePda, player2.publicKey);
      expect(result.signature).to.be.a('string');
      
      // Verify payouts match calculation
      const expectedPayouts = calculatePayouts(WAGER_AMOUNT, PAYOUT_BPS);
      expect(result.payouts.winnerAmount.toString()).to.equal(expectedPayouts.winnerAmount.toString());
      expect(result.payouts.feeAmount.toString()).to.equal(expectedPayouts.feeAmount.toString());
      
      // Verify game state
      const gameAccount = await wagerClient.getGame(gamePda);
      expect(gameAccount.state).to.equal(GameState.Paid);
      
      // Verify balances changed (approximately, accounting for transaction fees)
      const winnerBalanceAfter = await connection.getBalance(player2.publicKey);
      const devWalletBalanceAfter = await connection.getBalance(devWallet.publicKey);
      
      const winnerGain = winnerBalanceAfter - winnerBalanceBefore;
      const devWalletGain = devWalletBalanceAfter - devWalletBalanceBefore;
      
      // Allow for small transaction fee variance
      expect(winnerGain).to.be.approximately(expectedPayouts.winnerAmount.toNumber(), 10000);
      expect(devWalletGain).to.be.approximately(expectedPayouts.feeAmount.toNumber(), 10000);
    });
  });
  
  describe('SPL Token Wager', () => {
    let gamePda: PublicKey;
    let gameArgs: CreateGameArgs;
    
    beforeEach(() => {
      gameArgs = {
        mint: testToken,
        wager: WAGER_AMOUNT,
        payoutBps: PAYOUT_BPS,
        expiryTs: hoursFromNow(24),
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
    });
    
    it('should create an SPL token game', async function() {
      this.timeout(30000);
      
      const result = await wagerClient.createGame(creator, gameArgs);
      gamePda = result.gamePda;
      
      expect(result.signature).to.be.a('string');
      expect(result.gamePda).to.be.instanceOf(PublicKey);
      
      // Verify game account
      const gameAccount = await wagerClient.getGame(gamePda);
      expect(gameAccount.creator.toString()).to.equal(creator.publicKey.toString());
      expect(gameAccount.mint.toString()).to.equal(testToken.toString());
      expect(gameAccount.wager.toString()).to.equal(WAGER_AMOUNT.toString());
      expect(gameAccount.isNativeSOL()).to.be.false;
    });
    
    it('should handle full SPL token game flow', async function() {
      this.timeout(60000);
      
      // Create game
      const createResult = await wagerClient.createGame(creator, gameArgs);
      gamePda = createResult.gamePda;
      
      // Join game
      await wagerClient.joinGame(player2, gamePda);
      
      // Resolve game
      const resolveResult = await wagerClient.resolveGame(resolver, gamePda, player2.publicKey);
      
      // Verify final state
      const gameAccount = await wagerClient.getGame(gamePda);
      expect(gameAccount.state).to.equal(GameState.Paid);
      
      // Verify payouts
      const expectedPayouts = calculatePayouts(WAGER_AMOUNT, PAYOUT_BPS);
      expect(resolveResult.payouts.winnerAmount.toString()).to.equal(expectedPayouts.winnerAmount.toString());
    });
  });
  
  describe('Game Management', () => {
    it('should fetch games by creator', async function() {
      this.timeout(30000);
      
      const games = await wagerClient.getGamesByCreator(creator.publicKey);
      expect(games).to.be.an('array');
      // Should have games from previous tests
      expect(games.length).to.be.greaterThan(0);
    });
    
    it('should fetch open games', async function() {
      this.timeout(30000);
      
      // Create a new open game
      const gameArgs: CreateGameArgs = {
        mint: PublicKey.default,
        wager: WAGER_AMOUNT.divn(10), // Smaller wager
        payoutBps: PAYOUT_BPS,
        expiryTs: hoursFromNow(48),
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
      
      const result = await wagerClient.createGame(creator, gameArgs);
      
      const openGames = await wagerClient.getOpenGames();
      expect(openGames).to.be.an('array');
      
      const createdGame = openGames.find(game => game.creator.equals(creator.publicKey));
      expect(createdGame).to.not.be.undefined;
      expect(createdGame!.state).to.equal(GameState.Open);
    });
    
    it('should cancel an expired game', async function() {
      this.timeout(30000);
      
      // Create a game that expires quickly
      const gameArgs: CreateGameArgs = {
        mint: PublicKey.default,
        wager: WAGER_AMOUNT.divn(10),
        payoutBps: PAYOUT_BPS,
        expiryTs: new BN(Math.floor(Date.now() / 1000) - 1), // Already expired
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
      
      const createResult = await wagerClient.createGame(creator, gameArgs);
      
      // Should be able to cancel immediately since it's expired
      const cancelResult = await wagerClient.cancelIfExpired(creator, createResult.gamePda);
      expect(cancelResult.signature).to.be.a('string');
      
      // Verify game state
      const gameAccount = await wagerClient.getGame(createResult.gamePda);
      expect(gameAccount.state).to.equal(GameState.Canceled);
    });
  });
  
  describe('Error Cases', () => {
    it('should reject invalid payout basis points', async () => {
      const invalidGameArgs = {
        ...({
          mint: PublicKey.default,
          wager: WAGER_AMOUNT,
          payoutBps: 10000, // Invalid: must be < 10000
          expiryTs: hoursFromNow(24),
          devWallet: devWallet.publicKey,
          resolverPubkey: resolver.publicKey,
          nonce: generateNonce(),
        } as CreateGameArgs),
      };
      
      try {
        await wagerClient.createGame(creator, invalidGameArgs);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Payout basis points');
      }
    });
    
    it('should reject joining own game', async function() {
      this.timeout(30000);
      
      const gameArgs: CreateGameArgs = {
        mint: PublicKey.default,
        wager: WAGER_AMOUNT.divn(10),
        payoutBps: PAYOUT_BPS,
        expiryTs: hoursFromNow(24),
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
      
      const result = await wagerClient.createGame(creator, gameArgs);
      
      try {
        await wagerClient.joinGame(creator, result.gamePda); // Same person trying to join
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Cannot join your own game');
      }
    });
    
    it('should reject resolving with invalid winner', async function() {
      this.timeout(30000);
      
      // Create and join a game
      const gameArgs: CreateGameArgs = {
        mint: PublicKey.default,
        wager: WAGER_AMOUNT.divn(10),
        payoutBps: PAYOUT_BPS,
        expiryTs: hoursFromNow(24),
        devWallet: devWallet.publicKey,
        resolverPubkey: resolver.publicKey,
        nonce: generateNonce(),
      };
      
      const createResult = await wagerClient.createGame(creator, gameArgs);
      await wagerClient.joinGame(player2, createResult.gamePda);
      
      // Try to resolve with someone who isn't a player
      const randomKeypair = Keypair.generate();
      
      try {
        await wagerClient.resolveGame(resolver, createResult.gamePda, randomKeypair.publicKey);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Winner must be one of the two players');
      }
    });
  });
  
  describe('Client Convenience Methods', () => {
    it('should create game with defaults', async function() {
      this.timeout(30000);
      
      const result = await wagerClient.createGameWithDefaults(
        creator,
        WAGER_AMOUNT.divn(10)
      );
      
      expect(result.signature).to.be.a('string');
      expect(result.gamePda).to.be.instanceOf(PublicKey);
      expect(result.gameAccount.payoutBps).to.equal(8500); // Default
      expect(result.gameAccount.devWallet.toString()).to.equal(creator.publicKey.toString()); // Default
    });
    
    it('should format token amounts for display', async () => {
      const formatted = await wagerClient.formatTokenAmount(WAGER_AMOUNT, PublicKey.default);
      expect(formatted).to.equal('1'); // 1 SOL
    });
    
    it('should parse token amounts from strings', async () => {
      const parsed = await wagerClient.parseTokenAmount('1.5', PublicKey.default);
      expect(parsed.toString()).to.equal(new BN(1.5 * LAMPORTS_PER_SOL).toString());
    });
  });
  
  after(() => {
    // Cleanup can be added here if needed
    console.log('Tests completed successfully!');
  });
});
