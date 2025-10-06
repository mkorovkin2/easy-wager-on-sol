use anchor_lang::prelude::*;

#[error_code]
pub enum WagerError {
    #[msg("Game has already started or ended")]
    GameNotOpen,

    #[msg("Game has not started yet")]
    GameNotReady,

    #[msg("Game has already been resolved")]
    GameAlreadyResolved,

    #[msg("Game has not expired yet")]
    GameNotExpired,

    #[msg("Invalid payout basis points (must be between 1 and 9999)")]
    InvalidPayoutBps,

    #[msg("Invalid wager amount (must be greater than 0)")]
    InvalidWagerAmount,

    #[msg("Expiry time must be in the future")]
    InvalidExpiryTime,

    #[msg("Only the resolver can resolve this game")]
    UnauthorizedResolver,

    #[msg("Only the creator can perform this action")]
    UnauthorizedCreator,

    #[msg("Winner must be one of the two players")]
    InvalidWinner,

    #[msg("Game is full, cannot join")]
    GameFull,

    #[msg("Cannot join your own game")]
    CannotJoinOwnGame,

    #[msg("Token mint mismatch")]
    TokenMintMismatch,

    #[msg("Insufficient wager amount")]
    InsufficientWager,

    #[msg("Dev wallet cannot be zero")]
    InvalidDevWallet,

    #[msg("Cannot update resolver after deposits have been made")]
    CannotUpdateResolverAfterDeposits,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Game state transition not allowed")]
    InvalidStateTransition,
}
