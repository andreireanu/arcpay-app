import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { getProgram, PROGRAM_ID } from '../program'
import { getRegistrationAuth } from '../../supabase/authorize'

export async function register(
  connection: Connection,
  wallet: AnchorWallet,
): Promise<string> {
  const { signature, expiry, backendPublicKey, uuidBytes } = await getRegistrationAuth(
    wallet.publicKey.toBase58(),
  )

  // Build the 56-byte message matching what the backend signed: wallet(32) || uuid(16) || expiry(8)
  const expiryBytes = new Uint8Array(8)
  new DataView(expiryBytes.buffer).setBigInt64(0, BigInt(expiry), true)
  const message = new Uint8Array(56)
  message.set(wallet.publicKey.toBytes(), 0)
  message.set(uuidBytes, 32)
  message.set(expiryBytes, 48)

  // ix[0]: ed25519 precompile — runtime verifies signature before register runs
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(backendPublicKey).toBytes(),
    message,
    signature,
  })

  // Config PDA: seeds = [b"config"]
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID,
  )

  // ix[1]: register instruction
  const program = getProgram(connection, wallet)
  const registerIx = await program.methods
    .register(new BN(expiry), Array.from(uuidBytes))
    .accounts({
      user: wallet.publicKey,
      config: configPda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction()

  const latestBlockhash = await connection.getLatestBlockhash()
  const tx = new Transaction()
  tx.add(ed25519Ix)
  tx.add(registerIx)
  tx.recentBlockhash = latestBlockhash.blockhash
  tx.feePayer = wallet.publicKey

  const signed = await wallet.signTransaction(tx)
  const txSignature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  })
  await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash }, 'confirmed')
  return txSignature
}
