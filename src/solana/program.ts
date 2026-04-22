import { Program, AnchorProvider, type Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import { config } from '../config/env'
import idl from './idl/arcpay_solana.json'

export const PROGRAM_ID = new PublicKey(config.solana.programId)

export function getProgram(connection: Connection, wallet: AnchorWallet) {
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  return new Program(idl as unknown as Idl, provider)
}
