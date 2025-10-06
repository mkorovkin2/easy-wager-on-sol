/**
 * Basic Usage Example for Easy Wager on Solana
 * 
 * This example demonstrates the complete flow of creating,
 * joining, and resolving a wager game.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  WagerClient,
  GameState,
  hoursFromNow,
  formatTokenAmount,
  generateNonce,
} from '../sdk';

async function basicWagerExample() {
  console.log('🎲 Easy Wager on Solana - Basic Example\n');

  // Setup connection (use devnet for testing)
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wagerClient = new WagerClient(connection);

  // Generate test accounts
  const creator = Keypair.generate();
  const player2 = Keypair.generate();
  const devWallet = Keypair.generate();

  console.log('👥 Generated accounts:');
  console.log('Creator:', creator.publicKey.toString());
  console.log('Player2:', player2.publicKey.toString());
  console.log('Dev Wallet:', devWallet.publicKey.toString());
  console.log();

  // For testing, you'd need to fund these accounts
  // In real usage, these would be existing funded accounts
  
  try {
    // 1. Create a new game
    console.log('🆕 Creating a new wager game...');
    
    const wagerAmount = new BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
    const { signature: createSig, gamePda } = await wagerClient.createGame(creator, {
      mint: PublicKey.default, // Native SOL
      wager: wagerAmount,
      payoutBps: 8500, // 85% to winner, 15% to dev
      expiryTs: hoursFromNow(24), // 24 hours from now
      devWallet: devWallet.publicKey,
      resolverPubkey: creator.publicKey, // Creator resolves
      nonce: generateNonce(),
    });

    console.log('✅ Game created!');
    console.log('Transaction:', createSig);
    console.log('Game PDA:', gamePda.toString());
    console.log();

    // 2. Check game details
    const gameAccount = await wagerClient.getGame(gamePda);
    console.log('🎮 Game Details:');
    console.log('State:', GameState[gameAccount.state]);
    console.log('Wager Amount:', await formatTokenAmount(gameAccount.wager, gameAccount.mint));
    console.log('Payout to Winner:', gameAccount.payoutBps / 100, '%');
    console.log('Is Native SOL:', gameAccount.isNativeSOL());
    console.log('Can Join:', gameAccount.canJoin());
    console.log();

    // 3. Player2 joins the game
    console.log('🤝 Player2 joining the game...');
    
    const { signature: joinSig } = await wagerClient.joinGame(player2, gamePda);
    
    console.log('✅ Player2 joined!');
    console.log('Transaction:', joinSig);
    console.log();

    // 4. Check updated game state
    const readyGame = await wagerClient.getGame(gamePda);
    console.log('🎮 Updated Game State:');
    console.log('State:', GameState[readyGame.state]);
    console.log('Player2:', readyGame.player2.toString());
    console.log('Can Resolve:', readyGame.canResolve());
    console.log();

    // 5. Calculate expected payouts
    const expectedPayouts = wagerClient.calculatePayouts(wagerAmount, 8500);
    console.log('💰 Expected Payouts:');
    console.log('Total Pot:', await formatTokenAmount(expectedPayouts.totalPot, PublicKey.default));
    console.log('Winner Amount:', await formatTokenAmount(expectedPayouts.winnerAmount, PublicKey.default));
    console.log('Dev Fee:', await formatTokenAmount(expectedPayouts.feeAmount, PublicKey.default));
    console.log();

    // 6. Resolve the game (let's say player2 wins)
    console.log('🏆 Resolving the game...');
    
    const winner = player2.publicKey;
    const { signature: resolveSig, payouts } = await wagerClient.resolveGame(
      creator, // Creator is the resolver
      gamePda,
      winner
    );

    console.log('✅ Game resolved!');
    console.log('Transaction:', resolveSig);
    console.log('Winner:', winner.toString());
    console.log();

    // 7. Verify final game state
    const finalGame = await wagerClient.getGame(gamePda);
    console.log('🎯 Final Game State:');
    console.log('State:', GameState[finalGame.state]);
    console.log('Actual Winner Amount:', await formatTokenAmount(payouts.winnerAmount, PublicKey.default));
    console.log('Actual Dev Fee:', await formatTokenAmount(payouts.feeAmount, PublicKey.default));
    console.log();

    console.log('🎉 Wager completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * SPL Token Wager Example
 */
async function splTokenWagerExample() {
  console.log('\n🪙 SPL Token Wager Example\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wagerClient = new WagerClient(connection);

  // Example with USDC (Devnet mint)
  const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // Devnet USDC

  const creator = Keypair.generate();
  const player2 = Keypair.generate();
  const devWallet = Keypair.generate();

  try {
    console.log('🆕 Creating USDC wager game...');

    const { gamePda } = await wagerClient.createGame(creator, {
      mint: usdcMint,
      wager: new BN(1000000), // 1 USDC (6 decimals)
      payoutBps: 9000, // 90% to winner, 10% to dev
      expiryTs: hoursFromNow(48),
      devWallet: devWallet.publicKey,
      resolverPubkey: creator.publicKey,
    });

    console.log('✅ USDC game created:', gamePda.toString());

    // Get token info
    const tokenInfo = await wagerClient.getTokenInfo(usdcMint);
    console.log('Token decimals:', tokenInfo.decimals);
    console.log('Is native:', tokenInfo.isNative);

    // The rest of the flow would be the same as the SOL example
    // but with SPL token transfers instead of native SOL

  } catch (error) {
    console.error('❌ SPL Token Error:', error);
  }
}

/**
 * Game Management Example
 */
async function gameManagementExample() {
  console.log('\n📊 Game Management Example\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wagerClient = new WagerClient(connection);

  const creator = Keypair.generate();

  try {
    // Get all games by creator
    console.log('🔍 Fetching games by creator...');
    const creatorGames = await wagerClient.getGamesByCreator(creator.publicKey);
    console.log('Games created:', creatorGames.length);

    // Get open games
    console.log('🔓 Fetching open games...');
    const openGames = await wagerClient.getOpenGames();
    console.log('Open games available:', openGames.length);

    // Get ready games
    console.log('⚡ Fetching ready games...');
    const readyGames = await wagerClient.getReadyGames();
    console.log('Games ready for resolution:', readyGames.length);

    // Example of using convenience method
    console.log('🎲 Creating game with defaults...');
    const { gamePda, gameAccount } = await wagerClient.createGameWithDefaults(
      creator,
      new BN(0.05 * LAMPORTS_PER_SOL) // 0.05 SOL
    );

    console.log('Game created with defaults:');
    console.log('- PDA:', gamePda.toString());
    console.log('- Payout BPS:', gameAccount.payoutBps);
    console.log('- Dev Wallet:', gameAccount.devWallet.toString());

  } catch (error) {
    console.error('❌ Management Error:', error);
  }
}

// Run examples
if (require.main === module) {
  (async () => {
    await basicWagerExample();
    await splTokenWagerExample();
    await gameManagementExample();
  })().catch(console.error);
}

export {
  basicWagerExample,
  splTokenWagerExample,
  gameManagementExample,
};
