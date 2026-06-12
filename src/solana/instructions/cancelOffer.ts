import { Buffer } from 'buffer/'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { getProgram, PROGRAM_ID } from '../program'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

// Permissionless: escrow lives in the offer record itself, so `close = buyer`
// returns amount + rent in one sweep. No seller/vault accounts involved.
export async function cancelOffer(
  connection: Connection,
  wallet: AnchorWallet,
  ephemeralId: string,
): Promise<string> {
  const uuidBytes = uuidToBytes(ephemeralId)

  const [offerRecordPda] = PublicKey.findProgramAddressSync([Buffer.from('offer'), uuidBytes], PROGRAM_ID)

  const program = getProgram(connection, wallet)
  const cancelIx = await program.methods
    .buyerCancelOffer(Array.from(uuidBytes))
    .accounts({
      buyer: wallet.publicKey,
      offerRecord: offerRecordPda,
    })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(cancelIx)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
