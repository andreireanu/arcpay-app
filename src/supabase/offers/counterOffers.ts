import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { submitOffer } from '../../solana/instructions/offer'

export async function submitCounterOffer(
  connection: Connection,
  wallet: AnchorWallet,
  offerId: string,
  amountLamports: number,
): Promise<string> {
  return submitOffer(connection, wallet, offerId, amountLamports)
}
