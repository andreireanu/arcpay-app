import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { cancelOffer } from '../../solana/instructions/cancelOffer'

export async function cancelCounterOffer(
  connection: Connection,
  wallet: AnchorWallet,
  ephemeralId: string,
): Promise<string> {
  return cancelOffer(connection, wallet, ephemeralId)
}
