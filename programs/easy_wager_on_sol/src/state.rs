use anchor_lang::prelude::*;

#[account]
pub struct Game {
    pub creator: Pubkey,          // 32 bytes
    pub player1: Pubkey,          // 32 bytes
    pub player2: Pubkey,          // 32 bytes - zero until joined
    pub resolver: Pubkey,         // 32 bytes - optional if commit-reveal/VRF
    pub dev_wallet: Pubkey,       // 32 bytes - receives fees
    pub mint: Pubkey,             // 32 bytes - spl mint or native SOL marker
    pub wager: u64,               // 8 bytes - in smallest units
    pub payout_bps: u16,          // 2 bytes - Y * 100 (e.g., 8500 = 85% to winner)
    pub state: GameState,         // 1 byte
    pub expiry_ts: i64,           // 8 bytes
    pub nonce: u64,               // 8 bytes
    pub bump: u8,                 // 1 byte
    pub vault_bump: u8,           // 1 byte
}

impl Game {
    pub const LEN: usize = 8 + // discriminator
        32 + // creator
        32 + // player1
        32 + // player2
        32 + // resolver
        32 + // dev_wallet
        32 + // mint
        8 +  // wager
        2 +  // payout_bps
        1 +  // state
        8 +  // expiry_ts
        8 +  // nonce
        1 +  // bump
        1;   // vault_bump

    pub fn is_native_sol(&self) -> bool {
        self.mint == Pubkey::default()
    }

    pub fn calculate_payouts(&self) -> (u64, u64) {
        let pot = self.wager.checked_mul(2).unwrap();
        let winner_amount = pot
            .checked_mul(self.payout_bps as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let fee_amount = pot.checked_sub(winner_amount).unwrap();
        (winner_amount, fee_amount)
    }

    pub fn is_expired(&self, clock: &Clock) -> bool {
        clock.unix_timestamp >= self.expiry_ts
    }

    pub fn can_cancel(&self, clock: &Clock) -> bool {
        matches!(self.state, GameState::Open) && self.is_expired(clock)
    }

    pub fn can_join(&self) -> bool {
        matches!(self.state, GameState::Open) && self.player2 == Pubkey::default()
    }

    pub fn can_resolve(&self) -> bool {
        matches!(self.state, GameState::Ready)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GameState {
    Open,      // Waiting for second player
    Ready,     // Both players deposited, awaiting resolution
    Paid,      // Winner paid out
    Canceled,  // Canceled due to expiry or other reason
    Expired,   // Expired without resolution
}

// Events for indexing
#[event]
pub struct GameCreated {
    pub game: Pubkey,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub wager: u64,
    pub payout_bps: u16,
    pub expiry_ts: i64,
}

#[event]
pub struct GameJoined {
    pub game: Pubkey,
    pub player1: Pubkey,
    pub player2: Pubkey,
}

#[event]
pub struct GameResolved {
    pub game: Pubkey,
    pub winner: Pubkey,
    pub winner_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct GameCanceled {
    pub game: Pubkey,
    pub reason: String,
}
