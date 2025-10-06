use anchor_lang::prelude::*;
use crate::{state::*, error::WagerError};

#[derive(Accounts)]
#[instruction(new_resolver: Pubkey)]
pub struct UpdateResolver<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.creator.as_ref(), game.nonce.to_le_bytes().as_ref()],
        bump = game.bump,
        has_one = creator @ WagerError::UnauthorizedCreator
    )]
    pub game: Account<'info, Game>,
}

pub fn handler(ctx: Context<UpdateResolver>, new_resolver: Pubkey) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Only allow updating resolver while game is still open (no deposits yet)
    require!(
        matches!(game.state, GameState::Open),
        WagerError::CannotUpdateResolverAfterDeposits
    );

    require!(new_resolver != Pubkey::default(), WagerError::UnauthorizedResolver);

    game.resolver = new_resolver;

    Ok(())
}
