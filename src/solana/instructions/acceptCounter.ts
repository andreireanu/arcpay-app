import { Buffer } from 'buffer/'
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { getProgram, PROGRAM_ID } from '../program'
import { getAcceptCounterAuth } from '../../supabase/sol/acceptCounterAuthorize'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function acceptCounter(
  connection: Connection,
  wallet: AnchorWallet,
  counterOfferIds: string[],
): Promise<string> {
  const auth = await getAcceptCounterAuth(counterOfferIds, wallet.publicKey.toBase58())

  const sellerBytes = wallet.publicKey.toBytes()
  const uuidBytes = uuidToBytes(auth.ephemeralUuid)
  const sellerAmountBytes = new Uint8Array(8)
  const feeAmountBytes = new Uint8Array(8)
  const expiryBytes = new Uint8Array(8)
  new DataView(sellerAmountBytes.buffer).setBigUint64(0, BigInt(auth.sellerAmount), true)
  new DataView(feeAmountBytes.buffer).setBigUint64(0, BigInt(auth.feeAmount), true)
  new DataView(expiryBytes.buffer).setBigInt64(0, BigInt(auth.expiry), true)

  // Message layout: seller(32) | uuid(16) | seller_amount(8 LE) | fee_amount(8 LE) | expiry(8 LE)
  const message = new Uint8Array(72)
  message.set(sellerBytes, 0)
  message.set(uuidBytes, 32)
  message.set(sellerAmountBytes, 48)
  message.set(feeAmountBytes, 56)
  message.set(expiryBytes, 64)

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(auth.backendPublicKey).toBytes(),
    message,
    signature: Uint8Array.from(atob(auth.signature), (c) => c.charCodeAt(0)),
  })

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)

  const program = getProgram(connection, wallet)
  const acceptIx = await program.methods
    .acceptOffer(Array.from(uuidBytes), new BN(auth.sellerAmount), new BN(auth.feeAmount), new BN(auth.expiry))
    .accounts({
      seller: wallet.publicKey,
      config: configPda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(ed25519Ix)
  tx.add(acceptIx)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
