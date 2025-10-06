# Easy Wager on Solana

A secure, reusable two-player wager application built on Solana using Anchor. Players can wager SOL or any SPL token in an escrow system with configurable payouts to winners and developers.

## Features

- **Secure Escrow**: Funds are held in Program Derived Accounts (PDAs), not custodial wallets
- **Multi-Token Support**: Works with native SOL and any SPL token
- **Configurable Payouts**: Customizable percentage split between winner and developer
- **Multiple Resolution Methods**: Trusted resolver, commit-reveal, or VRF integration
- **Expiration Handling**: Automatic refunds for expired games
- **TypeScript SDK**: Complete client library for easy integration
- **Event Emissions**: All actions emit events for easy indexing

## Architecture

### On-Chain Program (Rust/Anchor)
- **Game State Management**: Tracks all game states and transitions
- **PDA Escrow**: Funds held in program-derived accounts for security
- **Token Agnostic**: Supports both native SOL and SPL tokens
- **Validation**: Comprehensive input validation and state checks

### TypeScript SDK
- **WagerClient**: High-level client for all operations
- **Type Safety**: Full TypeScript types and interfaces
- **Helper Utilities**: Token formatting, PDA derivation, etc.
- **Error Handling**: Comprehensive error types and messages

## Quick Start

### Prerequisites

- Rust and Anchor CLI
- Node.js and npm/yarn
- Solana CLI tools

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd easy-wager-on-sol

# Install dependencies
npm install

# Build the program
anchor build

# Run tests (requires local validator)
anchor test
```

### Basic Usage

```typescript
import { WagerClient, hoursFromNow } from './sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Initialize client
const connection = new Connection('https://api.devnet.solana.com');
const wagerClient = new WagerClient(connection);

// Create a new game
const creator = Keypair.generate(); // Your keypair
const devWallet = new PublicKey('...'); // Developer fee recipient

const { signature, gamePda } = await wagerClient.createGame(creator, {
  mint: PublicKey.default, // Native SOL
  wager: new BN(1000000000), // 1 SOL in lamports
  payoutBps: 8500, // 85% to winner, 15% to dev
  expiryTs: hoursFromNow(24), // 24 hours from now
  devWallet: devWallet,
  resolverPubkey: creator.publicKey, // Creator resolves
});

// Player2 joins the game
const player2 = Keypair.generate();
await wagerClient.joinGame(player2, gamePda);

// Resolve the game (creator decides winner)
const winner = player2.publicKey; // Player2 wins
const { payouts } = await wagerClient.resolveGame(creator, gamePda, winner);

console.log(`Winner gets: ${payouts.winnerAmount} lamports`);
console.log(`Dev fee: ${payouts.feeAmount} lamports`);
```

### SPL Token Games

```typescript
// Create a game with USDC
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const { gamePda } = await wagerClient.createGame(creator, {
  mint: usdcMint,
  wager: new BN(1000000), // 1 USDC (6 decimals)
  payoutBps: 9000, // 90% to winner, 10% to dev
  expiryTs: hoursFromNow(48),
  devWallet: devWallet,
});
```

## Game Flow

### 1. Create Game
- Creator specifies token, wager amount, payout percentage, and expiry
- Game PDA and vault PDA are derived deterministically
- Game state set to `Open`

### 2. Join Game
- Second player joins by matching the wager amount
- Funds transferred to escrow (vault PDA for SPL tokens, game PDA for SOL)
- Game state changes to `Ready`

### 3. Resolve Game
- Authorized resolver declares the winner
- Funds distributed: winner gets their percentage, dev gets remainder
- Game state changes to `Paid`

### 4. Cancel/Expire
- If game expires without resolution, funds are refunded
- Creator can cancel open games that have expired
- Game state changes to `Canceled`

## API Reference

### WagerClient

#### Constructor
```typescript
new WagerClient(connection: Connection, config?: WagerClientConfig)
```

#### Methods

##### `createGame(creator: Signer, args: CreateGameArgs)`
Creates a new wager game.

**Parameters:**
- `creator`: The game creator's keypair
- `args`: Game configuration object

**Returns:** `{ signature: string, gamePda: PublicKey }`

##### `joinGame(player2: Signer, gamePda: PublicKey)`
Join an existing game as the second player.

##### `resolveGame(resolver: Signer, gamePda: PublicKey, winner: PublicKey)`
Resolve a game by declaring the winner.

##### `cancelIfExpired(authority: Signer, gamePda: PublicKey)`
Cancel an expired game and refund players.

##### `getGame(gamePda: PublicKey)`
Fetch game account data.

##### `getGamesByCreator(creator: PublicKey)`
Get all games created by a specific address.

##### `getOpenGames()` / `getReadyGames()`
Get games in specific states.

### Types

#### `CreateGameArgs`
```typescript
{
  mint: PublicKey;           // Token mint (PublicKey.default for SOL)
  wager: BN;                 // Wager amount in smallest units
  payoutBps: number;         // Winner payout (0-9999 basis points)
  expiryTs: BN;              // Unix timestamp expiry
  devWallet: PublicKey;      // Developer fee recipient
  resolverPubkey?: PublicKey; // Optional resolver (defaults to creator)
  nonce?: BN;                // Optional nonce for PDA derivation
}
```

#### `GameState`
```typescript
enum GameState {
  Open = 0,      // Waiting for second player
  Ready = 1,     // Both players joined, awaiting resolution
  Paid = 2,      // Winner has been paid
  Canceled = 3,  // Game canceled
  Expired = 4,   // Game expired without resolution
}
```

## Security Considerations

### PDA Escrow Pattern
- Funds held in program-owned accounts, not custodial wallets
- No single private key can access all funds
- Atomic operations ensure consistency

### Validation
- All inputs validated on-chain
- State transitions strictly enforced
- Overflow protection on all math operations

### Access Control
- Only authorized resolvers can declare winners
- Only creators can update resolvers (before deposits)
- Time-based expiration prevents indefinite locks

## Testing

The project includes comprehensive tests covering:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

### Test Coverage
- Native SOL and SPL token games
- Full game lifecycle (create → join → resolve)
- Error cases and edge conditions
- Expiration and cancellation flows
- Client convenience methods

## Deployment

### Local Development
```bash
# Start local validator
solana-test-validator

# Deploy program
anchor deploy
```

### Devnet/Mainnet
```bash
# Set cluster
solana config set --url devnet

# Deploy with upgrade authority
anchor deploy --provider.cluster devnet
```

## Integration Examples

### React Integration
```typescript
import { WagerClient } from 'easy-wager-on-sol';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

function GameCreator() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const wagerClient = new WagerClient(connection);

  const createGame = async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    
    const { gamePda } = await wagerClient.createGameWithDefaults(
      wallet, // Wallet adapter provides signing interface
      new BN(1000000000) // 1 SOL
    );
    
    console.log('Game created:', gamePda.toString());
  };

  return (
    <button onClick={createGame}>
      Create Game
    </button>
  );
}
```

### Game Indexing
```typescript
// Listen for game events
connection.onLogs(
  wagerClient.programId,
  (logs, context) => {
    // Parse logs for GameCreated, GameJoined, GameResolved events
    console.log('Game event:', logs);
  },
  'confirmed'
);
```

## Advanced Features

### Commit-Reveal Resolution
For trustless resolution without a third-party resolver:

```rust
// Players commit to their choice with a hash
pub fn commit_choice(ctx: Context<CommitChoice>, commitment: [u8; 32]) -> Result<()> {
    // Store commitment hash
}

// Later, reveal the choice to determine winner
pub fn reveal_choice(ctx: Context<RevealChoice>, choice: u8, nonce: [u8; 32]) -> Result<()> {
    // Verify commitment matches hash(choice + nonce)
    // Determine winner based on revealed choices
}
```

### VRF Integration
For games of pure chance using Switchboard VRF:

```rust
use switchboard_v2::VrfAccountData;

pub fn resolve_with_vrf(ctx: Context<ResolveWithVrf>) -> Result<()> {
    let vrf = VrfAccountData::new(ctx.accounts.vrf.load()?)?;
    let random_value = vrf.get_result()?;
    
    // Use random value to determine winner
    let winner = if random_value[0] % 2 == 0 {
        ctx.accounts.game.player1
    } else {
        ctx.accounts.game.player2
    };
    
    // Proceed with payout logic
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

- **Documentation**: Check the `/docs` folder for detailed guides
- **Issues**: Report bugs and feature requests on GitHub
- **Community**: Join our Discord/Telegram for discussions

---

Built with ❤️ for the Solana ecosystem