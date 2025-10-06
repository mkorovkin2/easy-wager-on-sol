use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod state;
mod instructions;
mod error;

use state::*;
use instructions::*;
use error::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod easy_wager_on_sol {
    use super::*;

    pub fn create_game(
        ctx: Context<CreateGame>,
        mint: Pubkey,
        wager: u64,
        payout_bps: u16,
        expiry_ts: i64,
        resolver_pubkey: Option<Pubkey>,
        nonce: u64,
    ) -> Result<()> {
        instructions::create_game::handler(ctx, mint, wager, payout_bps, expiry_ts, resolver_pubkey, nonce)
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        instructions::join_game::handler(ctx)
    }

    pub fn resolve_game(ctx: Context<ResolveGame>, winner: Pubkey) -> Result<()> {
        instructions::resolve_game::handler(ctx, winner)
    }

    pub fn cancel_if_expired(ctx: Context<CancelGame>) -> Result<()> {
        instructions::cancel_game::handler(ctx)
    }

    pub fn update_resolver(ctx: Context<UpdateResolver>, new_resolver: Pubkey) -> Result<()> {
        instructions::update_resolver::handler(ctx, new_resolver)
    }
}
