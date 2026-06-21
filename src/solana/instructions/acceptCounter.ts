import { Buffer } from 'buffer/'
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { getProgram, PROGRAM_ID } from '../program'
import { getAcceptCounterAuth } from '../../supabase/authorize/acceptCounterAuthorize'

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
  const expiryBytes = new Uint8Array(8)
  new DataView(expiryBytes.buffer).setBigInt64(0, BigInt(auth.expiry), true)

  // Message layout matching auth_accept_offer.rs: seller(32) | uuid(16) | expiry(8 LE)
  // The accept is a consent-only event — no amounts: settlement is driven by
  // the backend per offer record.
  const message = new Uint8Array(56)
  message.set(sellerBytes, 0)
  message.set(uuidBytes, 32)
  message.set(expiryBytes, 48)

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(auth.backendPublicKey).toBytes(),
    message,
    signature: Uint8Array.from(atob(auth.signature), (c) => c.charCodeAt(0)),
  })

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)

  const program = getProgram(connection, wallet)
  const acceptIx = await program.methods
    .acceptOffer(Array.from(uuidBytes), new BN(auth.expiry))
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
