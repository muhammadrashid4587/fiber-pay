/**
 * CKB Address Encoding (Bech32m)
 * Encode CKB lock scripts to human-readable addresses
 */

// Bech32m charset
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32mPolymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32mHrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function bech32mCreateChecksum(hrp: string, data: number[]): number[] {
  const values = bech32mHrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32mPolymod(values) ^ 0x2bc830a3; // Bech32m constant
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }

  return ret;
}

function bech32mEncode(hrp: string, data: number[]): string {
  const checksum = bech32mCreateChecksum(hrp, data);
  const combined = data.concat(checksum);
  let result = `${hrp}1`;
  for (const d of combined) {
    result += BECH32_CHARSET[d];
  }
  return result;
}

export interface Script {
  code_hash: string;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: string;
}

/**
 * Convert a CKB lock script to a bech32m-encoded address
 * @param script - The lock script to encode
 * @param network - The CKB network ('testnet' or 'mainnet')
 * @returns Bech32m-encoded CKB address
 */
export function scriptToAddress(script: Script, network: 'testnet' | 'mainnet'): string {
  const hrp = network === 'mainnet' ? 'ckb' : 'ckt';

  // CKB full address format (2021)
  // Format: 0x00 | code_hash | hash_type | args
  const hashTypeByte =
    script.hash_type === 'type'
      ? 0x01
      : script.hash_type === 'data'
        ? 0x00
        : script.hash_type === 'data1'
          ? 0x02
          : 0x04; // data2

  const codeHash = script.code_hash.startsWith('0x') ? script.code_hash.slice(2) : script.code_hash;
  const args = script.args.startsWith('0x') ? script.args.slice(2) : script.args;

  // Construct the payload: format_type(0x00) + code_hash(32) + hash_type(1) + args
  const payload = new Uint8Array(1 + 32 + 1 + args.length / 2);
  payload[0] = 0x00; // Full format type

  // code_hash
  for (let i = 0; i < 32; i++) {
    payload[1 + i] = parseInt(codeHash.slice(i * 2, i * 2 + 2), 16);
  }

  // hash_type
  payload[33] = hashTypeByte;

  // args
  for (let i = 0; i < args.length / 2; i++) {
    payload[34 + i] = parseInt(args.slice(i * 2, i * 2 + 2), 16);
  }

  // Convert to 5-bit groups and encode with bech32m
  const data = convertBits(payload, 8, 5, true);
  return bech32mEncode(hrp, data);
}
