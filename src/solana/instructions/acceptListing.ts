import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { getProgram } from '../program'

export async function acceptListing(
  connection: Connection,
  wallet: AnchorWallet,
  listingPda: string,
): Promise<string> {
  const program = getProgram(connection, wallet)
  const listing = new PublicKey(listingPda)

  // seller is resolved automatically by Anchor from the listing account (relations: ["listing"])
  const ix = await program.methods
    .acceptListing()
    .accounts({ buyer: wallet.publicKey, listing })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(ix)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
