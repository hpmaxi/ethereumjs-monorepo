import { BN, bnToHex, bnToRlp, ecrecover, keccak256, rlp, toBuffer } from 'ethereumjs-util'
import { BaseTransaction } from './baseTransaction'
import {
  AccessList,
  AccessListBuffer,
  FeeMarketEIP1559TxData,
  FeeMarketEIP1559ValuesArray,
  JsonTx,
  N_DIV_2,
  TxOptions,
} from './types'
import { AccessLists } from './util'

const TRANSACTION_TYPE = 2
const TRANSACTION_TYPE_BUFFER = Buffer.from(TRANSACTION_TYPE.toString(16).padStart(2, '0'), 'hex')

export default class FeeMarketEIP1559Transaction extends BaseTransaction<FeeMarketEIP1559Transaction> {
  public readonly chainId: BN
  public readonly accessList: AccessListBuffer
  public readonly AccessListJSON: AccessList
  public readonly maxInclusionFeePerGas: BN
  public readonly maxFeePerGas: BN

  get transactionType(): number {
    return TRANSACTION_TYPE
  }

  /**
   * EIP-2930 alias for `r`
   */
  get senderR() {
    return this.r
  }

  /**
   * EIP-2930 alias for `s`
   */
  get senderS() {
    return this.s
  }

  /**
   * EIP-2930 alias for `v`
   */
  get yParity() {
    return this.v
  }

  public static fromTxData(txData: FeeMarketEIP1559TxData, opts: TxOptions = {}) {
    return new FeeMarketEIP1559Transaction(txData, opts)
  }

  /**
   * Instantiate a transaction from the serialized tx.
   *
   * Note: this means that the Buffer should start with 0x01.
   */
  public static fromSerializedTx(serialized: Buffer, opts: TxOptions = {}) {
    if (!serialized.slice(0, 1).equals(TRANSACTION_TYPE_BUFFER)) {
      throw new Error(
        `Invalid serialized tx input: not an EIP-1559 transaction (wrong tx type, expected: ${TRANSACTION_TYPE}, received: ${serialized
          .slice(0, 1)
          .toString('hex')}`
      )
    }

    const values = rlp.decode(serialized.slice(1))

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized tx input: must be array')
    }

    return FeeMarketEIP1559Transaction.fromValuesArray(values as any, opts)
  }

  /**
   * Instantiate a transaction from the serialized tx.
   * (alias of `fromSerializedTx()`)
   *
   * Note: This means that the Buffer should start with 0x01.
   *
   * @deprecated this constructor alias is deprecated and will be removed
   * in favor of the `fromSerializedTx()` constructor
   */
  public static fromRlpSerializedTx(serialized: Buffer, opts: TxOptions = {}) {
    return FeeMarketEIP1559Transaction.fromSerializedTx(serialized, opts)
  }

  /**
   * Create a transaction from a values array.
   *
   * The format is:
   * chainId, nonce, maxInclusionFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList, signatureYParity, signatureR, signatureS
   */
  public static fromValuesArray(values: FeeMarketEIP1559ValuesArray, opts: TxOptions = {}) {
    if (values.length !== 9 && values.length !== 12) {
      throw new Error(
        'Invalid EIP-1559 transaction. Only expecting 9 values (for unsigned tx) or 12 values (for signed tx).'
      )
    }

    const [
      chainId,
      nonce,
      maxInclusionFeePerGas,
      maxFeePerGas,
      gasLimit,
      to,
      value,
      data,
      accessList,
      v,
      r,
      s,
    ] = values

    const emptyAccessList: AccessList = []

    return new FeeMarketEIP1559Transaction(
      {
        chainId: new BN(chainId),
        nonce,
        maxInclusionFeePerGas,
        maxFeePerGas,
        gasLimit,
        to,
        value,
        data,
        accessList: accessList ?? emptyAccessList,
        v: v !== undefined ? new BN(v) : undefined, // EIP2930 supports v's with value 0 (empty Buffer)
        r,
        s,
      },
      opts
    )
  }

  public constructor(txData: FeeMarketEIP1559TxData, opts: TxOptions = {}) {
    const { chainId, accessList, maxFeePerGas, maxInclusionFeePerGas } = txData

    super({ ...txData, type: TRANSACTION_TYPE }, opts)

    if (!this.common.isActivatedEIP(1559)) {
      throw new Error('EIP-1559 not enabled on Common')
    }

    // Populate the access list fields
    const accessListData = AccessLists.getAccessListData(accessList ?? [])
    this.accessList = accessListData.accessList
    this.AccessListJSON = accessListData.AccessListJSON
    // Verify the access list format.
    AccessLists.verifyAccessList(this.accessList)

    this.chainId = chainId ? new BN(toBuffer(chainId)) : new BN(this.common.chainId())
    this.maxFeePerGas = new BN(toBuffer(maxFeePerGas === '' ? '0x' : maxFeePerGas))
    this.maxInclusionFeePerGas = new BN(
      toBuffer(maxInclusionFeePerGas === '' ? '0x' : maxInclusionFeePerGas)
    )

    this._validateCannotExceedMaxInteger({
      maxFeePerGas: this.maxFeePerGas,
      maxInclusionFeePerGas: this.maxInclusionFeePerGas,
    })

    if (!this.chainId.eq(new BN(this.common.chainId().toString()))) {
      throw new Error('The chain ID does not match the chain ID of Common')
    }

    if (this.v && !this.v.eqn(0) && !this.v.eqn(1)) {
      throw new Error('The y-parity of the transaction should either be 0 or 1')
    }

    if (this.common.gteHardfork('homestead') && this.s?.gt(N_DIV_2)) {
      throw new Error(
        'Invalid Signature: s-values greater than secp256k1n/2 are considered invalid'
      )
    }

    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  /**
   * The amount of gas paid for the data in this tx
   */
  getDataFee(): BN {
    const cost = super.getDataFee()
    cost.iaddn(AccessLists.getDataFeeEIP2930(this.accessList, this.common))
    return cost
  }

  /**
   * The up front amount that an account must have for this transaction to be valid
   * @param baseFee The base fee of the block
   */
  getUpfrontCost(baseFee?: BN): BN {
    const inclusionFeePerGas = BN.min(this.maxInclusionFeePerGas, this.maxFeePerGas.sub(baseFee!))
    const gasPrice = inclusionFeePerGas.add(baseFee!)
    return this.gasLimit.mul(gasPrice).add(this.value)
  }

  /**
   * Returns a Buffer Array of the raw Buffers of this transaction, in order.
   *
   * Use `serialize()` to add to block data for `Block.fromValuesArray()`.
   */
  raw(): FeeMarketEIP1559ValuesArray {
    return [
      bnToRlp(this.chainId),
      bnToRlp(this.nonce),
      bnToRlp(this.maxInclusionFeePerGas),
      bnToRlp(this.maxFeePerGas),
      bnToRlp(this.gasLimit),
      this.to !== undefined ? this.to.buf : Buffer.from([]),
      bnToRlp(this.value),
      this.data,
      this.accessList,
      this.v !== undefined ? bnToRlp(this.v) : Buffer.from([]),
      this.r !== undefined ? bnToRlp(this.r) : Buffer.from([]),
      this.s !== undefined ? bnToRlp(this.s) : Buffer.from([]),
    ]
  }

  /**
   * Returns the serialized encoding of the transaction.
   */
  serialize(): Buffer {
    const base = this.raw()
    return Buffer.concat([TRANSACTION_TYPE_BUFFER, rlp.encode(base as any)])
  }

  /**
   * Returns the serialized unsigned tx (hashed or raw), which is used to sign the transaction.
   *
   * @param hashMessage - Return hashed message if set to true (default: true)
   */
  getMessageToSign(hashMessage: false): Buffer[]
  getMessageToSign(hashMessage?: true): Buffer
  getMessageToSign(hashMessage = true): Buffer | Buffer[] {
    const base = this.raw().slice(0, 9)
    const message = Buffer.concat([TRANSACTION_TYPE_BUFFER, rlp.encode(base as any)])
    if (hashMessage) {
      return keccak256(message)
    } else {
      return message
    }
  }

  /**
   * Computes a sha3-256 hash of the serialized tx
   */
  public hash(): Buffer {
    if (!this.isSigned()) {
      throw new Error('Cannot call hash method if transaction is not signed')
    }

    return keccak256(this.serialize())
  }

  /**
   * Computes a sha3-256 hash which can be used to verify the signature
   */
  public getMessageToVerifySignature(): Buffer {
    return this.getMessageToSign()
  }

  /**
   * Returns the public key of the sender
   */
  public getSenderPublicKey(): Buffer {
    if (!this.isSigned()) {
      throw new Error('Cannot call this method if transaction is not signed')
    }

    const msgHash = this.getMessageToVerifySignature()

    // All transaction signatures whose s-value is greater than secp256k1n/2 are considered invalid.
    // TODO: verify if this is the case for EIP-2930
    if (this.common.gteHardfork('homestead') && this.s?.gt(N_DIV_2)) {
      throw new Error(
        'Invalid Signature: s-values greater than secp256k1n/2 are considered invalid'
      )
    }

    const { v, r, s } = this
    if (v === undefined || !r || !s) {
      throw new Error('Missing values to derive sender public key from signed tx')
    }

    try {
      return ecrecover(
        msgHash,
        v.addn(27), // Recover the 27 which was stripped from ecsign
        bnToRlp(r),
        bnToRlp(s)
      )
    } catch (e) {
      throw new Error('Invalid Signature')
    }
  }

  _processSignature(v: number, r: Buffer, s: Buffer) {
    const opts = {
      common: this.common,
    }

    return FeeMarketEIP1559Transaction.fromTxData(
      {
        chainId: this.chainId,
        nonce: this.nonce,
        maxInclusionFeePerGas: this.maxInclusionFeePerGas,
        maxFeePerGas: this.maxFeePerGas,
        gasLimit: this.gasLimit,
        to: this.to,
        value: this.value,
        data: this.data,
        accessList: this.accessList,
        v: new BN(v - 27), // This looks extremely hacky: ethereumjs-util actually adds 27 to the value, the recovery bit is either 0 or 1.
        r: new BN(r),
        s: new BN(s),
      },
      opts
    )
  }

  /**
   * Returns an object with the JSON representation of the transaction
   */
  toJSON(): JsonTx {
    const accessListJSON = AccessLists.getAccessListJSON(this.accessList)

    return {
      chainId: bnToHex(this.chainId),
      nonce: bnToHex(this.nonce),
      maxInclusionFeePerGas: bnToHex(this.maxInclusionFeePerGas),
      maxFeePerGas: bnToHex(this.maxFeePerGas),
      gasLimit: bnToHex(this.gasLimit),
      to: this.to !== undefined ? this.to.toString() : undefined,
      value: bnToHex(this.value),
      data: '0x' + this.data.toString('hex'),
      accessList: accessListJSON,
      v: this.v !== undefined ? bnToHex(this.v) : undefined,
      r: this.r !== undefined ? bnToHex(this.r) : undefined,
      s: this.s !== undefined ? bnToHex(this.s) : undefined,
    }
  }

  getEIP1559Data() {
    return {
      maxInclusionFeePerGas: this.maxInclusionFeePerGas,
      maxFeePerGas: this.maxFeePerGas,
    }
  }
}