import { Buffer } from 'buffer/'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { getProgram } from '../program'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function sellerCancelOffer(
  connection: Connection,
  wallet: AnchorWallet,
  offerId: string,
): Promise<string> {
  const uuidBytes = uuidToBytes(offerId)
  const program = getProgram(connection, wallet)

  const ix = await program.methods
    .sellerCancelOffer(Array.from(uuidBytes))
    .accounts({ seller: wallet.publicKey })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(ix)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
