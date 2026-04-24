import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { getProgram, PROGRAM_ID } from '../program'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  return new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
}

export async function createListing(
  connection: Connection,
  wallet: AnchorWallet,
  priceLamports: number,
  offerId: string,
): Promise<string> {
  const program = getProgram(connection, wallet)

  // Derive seller_profile PDA: seeds = [b"user", seller]
  const [sellerProfilePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user'), wallet.publicKey.toBytes()],
    PROGRAM_ID,
  )

  // Fetch listing_count to derive the listing PDA
  const sellerProfile = await program.account.userProfile.fetch(sellerProfilePda)
  const listingCount = sellerProfile.listingCount as BN

  // Derive listing PDA: seeds = [b"listing", seller, listing_count (8 bytes LE)]
  const [listingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('listing'), wallet.publicKey.toBytes(), listingCount.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID,
  )

  const uuidBytes = uuidToBytes(offerId)

  const ix = await program.methods
    .createListing(new BN(priceLamports), Array.from(uuidBytes))
    .accounts({
      seller: wallet.publicKey,
      sellerProfile: sellerProfilePda,
      listing: listingPda,
    })
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
