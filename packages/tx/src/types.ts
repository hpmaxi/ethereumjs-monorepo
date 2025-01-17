import { BN, AddressLike, BNLike, BufferLike, PrefixedHexString } from 'ethereumjs-util'
import Common from '@ethereumjs/common'
import { default as Transaction } from './legacyTransaction'
import { default as AccessListEIP2930Transaction } from './eip2930Transaction'

/**
 * The options for initializing a Transaction.
 */
export interface TxOptions {
  /**
   * A Common object defining the chain and hardfork for the transaction.
   *
   * Object will be internally copied so that tx behavior don't incidentally
   * change on future HF changes.
   *
   * Default: `Common` object set to `mainnet` and the default hardfork as defined in the `Common` class.
   *
   * Current default hardfork: `istanbul`
   */
  common?: Common
  /**
   * A transaction object by default gets frozen along initialization. This gives you
   * strong additional security guarantees on the consistency of the tx parameters.
   *
   * If you need to deactivate the tx freeze - e.g. because you want to subclass tx and
   * add aditional properties - it is strongly encouraged that you do the freeze yourself
   * within your code instead.
   *
   * Default: true
   */
  freeze?: boolean
}

/*
 * Access List types
 */

export type AccessListItem = {
  address: PrefixedHexString
  storageKeys: PrefixedHexString[]
}

/*
 * An Access List as a tuple of [address: Buffer, storageKeys: Buffer[]]
 */
export type AccessListBufferItem = [Buffer, Buffer[]]
export type AccessListBuffer = AccessListBufferItem[]
export type AccessList = AccessListItem[]

export function isAccessListBuffer(
  input: AccessListBuffer | AccessList
): input is AccessListBuffer {
  if (input.length === 0) {
    return true
  }
  const firstItem = input[0]
  if (Array.isArray(firstItem)) {
    return true
  }
  return false
}

export function isAccessList(input: AccessListBuffer | AccessList): input is AccessList {
  return !isAccessListBuffer(input) // This is exactly the same method, except the output is negated.
}

export type TypedTransaction = Transaction | AccessListEIP2930Transaction

export type TxData = {
  /**
   * The transaction's nonce.
   */
  nonce?: BNLike

  /**
   * The transaction's gas price.
   */
  gasPrice?: BNLike

  /**
   * The transaction's gas limit.
   */
  gasLimit?: BNLike

  /**
   * The transaction's the address is sent to.
   */
  to?: AddressLike

  /**
   * The amount of Ether sent.
   */
  value?: BNLike

  /**
   * This will contain the data of the message or the init of a contract.
   */
  data?: BufferLike

  /**
   * EC recovery ID.
   */
  v?: BNLike

  /**
   * EC signature parameter.
   */
  r?: BNLike

  /**
   * EC signature parameter.
   */
  s?: BNLike
}

/**
 * An object with an optional field with each of the transaction's values.
 */
export interface AccessListEIP2930TxData extends TxData {
  /**
   * The transaction's chain ID
   */
  chainId?: BNLike

  /**
   * The access list which contains the addresses/storage slots which the transaction wishes to access
   */
  accessList?: AccessListBuffer | AccessList

  /**
   * The transaction type
   */

  type?: BNLike
}

/**
 * Buffer values array for EIP2930 transaction
 */
export type AccessListEIP2930ValuesArray = [
  Buffer,
  Buffer,
  Buffer,
  Buffer,
  Buffer,
  Buffer,
  Buffer,
  AccessListBuffer,
  Buffer?,
  Buffer?,
  Buffer?
]

type JsonAccessListItem = { address: string; storageKeys: string[] }

/**
 * An object with all of the transaction's values represented as strings.
 */
export interface JsonTx {
  nonce?: string
  gasPrice?: string
  gasLimit?: string
  to?: string
  data?: string
  v?: string
  r?: string
  s?: string
  value?: string
  chainId?: string
  accessList?: JsonAccessListItem[]
  type?: string
}

/**
 * A const defining secp256k1n/2
 */
export const N_DIV_2 = new BN(
  '7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0',
  16
)
