import { Buffer } from 'buffer/'
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { getProgram, PROGRAM_ID } from '../program'
import { getOfferAuth } from '../../supabase/authorize/offerAuthorize'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function submitOffer(
  connection: Connection,
  wallet: AnchorWallet,
  offerId: string,
  amountLamports: number,
): Promise<string> {
  const auth = await getOfferAuth(offerId, wallet.publicKey.toBase58(), amountLamports)

  const buyerBytes = wallet.publicKey.toBytes()
  const sellerPubkey = new PublicKey(auth.sellerWallet)
  const uuidBytes = uuidToBytes(auth.ephemeralUuid)
  const amountBytes = new Uint8Array(8)
  const expiryBytes = new Uint8Array(8)
  new DataView(amountBytes.buffer).setBigUint64(0, BigInt(amountLamports), true)
  new DataView(expiryBytes.buffer).setBigInt64(0, BigInt(auth.expiry), true)

  // Message layout matching auth_offer.rs:
  // buyer(32) | seller(32) | uuid(16) | amount(8 LE) | expiry(8 LE)
  const message = new Uint8Array(96)
  message.set(buyerBytes, 0)
  message.set(sellerPubkey.toBytes(), 32)
  message.set(uuidBytes, 64)
  message.set(amountBytes, 80)
  message.set(expiryBytes, 88)

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(auth.backendPublicKey).toBytes(),
    message,
    signature: Uint8Array.from(atob(auth.signature), (c) => c.charCodeAt(0)),
  })

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)
  const [offerRecordPda] = PublicKey.findProgramAddressSync([Buffer.from('offer'), uuidBytes], PROGRAM_ID)

  const program = getProgram(connection, wallet)
  const offerIx = await program.methods
    .offer(Array.from(uuidBytes), new BN(amountLamports), new BN(auth.expiry))
    .accounts({
      buyer: wallet.publicKey,
      seller: sellerPubkey,
      config: configPda,
      offerRecord: offerRecordPda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(ed25519Ix)
  tx.add(offerIx)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
