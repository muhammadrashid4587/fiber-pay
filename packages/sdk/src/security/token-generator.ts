import {
  Biscuit,
  fact,
  KeyPair,
  PrivateKey,
  PublicKey,
  SignatureAlgorithm,
} from '@biscuit-auth/biscuit-wasm';
import type {
  AmountLimits,
  CountLimits,
  KeyPair as GrantKeyPair,
  GrantRestrictions,
  PermissionGrant,
} from './grant-types.js';

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/i, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function escapeDatalogString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createPrivateKeyFromHex(hexKey: string): PrivateKey {
  const keyBytes = hexToBytes(hexKey);
  return PrivateKey.fromBytes(keyBytes, SignatureAlgorithm.Ed25519);
}

function addAmountCaveats(
  builder: import('@biscuit-auth/biscuit-wasm').BiscuitBuilder,
  limits: AmountLimits,
): void {
  if (limits.perPayment) {
    const amount = BigInt(limits.perPayment);
    builder.addCode(`check if payment_amount($amount), $amount <= ${amount.toString()};`);
  }

  if (limits.dailyTotal) {
    const amount = BigInt(limits.dailyTotal);
    builder.addCode(`check if daily_amount_total($total), $total <= ${amount.toString()};`);
  }

  if (limits.hourlyTotal) {
    const amount = BigInt(limits.hourlyTotal);
    builder.addCode(`check if hourly_amount_total($total), $total <= ${amount.toString()};`);
  }
}

function addCountCaveats(
  builder: import('@biscuit-auth/biscuit-wasm').BiscuitBuilder,
  limits: CountLimits,
): void {
  if (limits.daily !== undefined) {
    builder.addCode(`check if daily_tx_count($count), $count <= ${limits.daily};`);
  }

  if (limits.hourly !== undefined) {
    builder.addCode(`check if hourly_tx_count($count), $count <= ${limits.hourly};`);
  }
}

function addTimeWindowCaveats(
  builder: import('@biscuit-auth/biscuit-wasm').BiscuitBuilder,
  restrictions: GrantRestrictions,
): void {
  if (restrictions.timeWindow?.start) {
    const startTime = new Date(restrictions.timeWindow.start);
    builder.addCode(`check if time($now), $now >= ${startTime.toISOString()};`);
  }

  if (restrictions.timeWindow?.end) {
    const endTime = new Date(restrictions.timeWindow.end);
    builder.addCode(`check if time($now), $now <= ${endTime.toISOString()};`);
  }

  if (restrictions.expiresAt) {
    const expiryTime = new Date(restrictions.expiresAt);
    builder.addCode(`check if time($now), $now <= ${expiryTime.toISOString()};`);
  }
}

function addRecipientCaveats(
  builder: import('@biscuit-auth/biscuit-wasm').BiscuitBuilder,
  restrictions: GrantRestrictions,
): void {
  if (restrictions.recipients?.allowlist?.length) {
    const recipients = restrictions.recipients.allowlist
      .map((r) => `"${escapeDatalogString(r)}"`)
      .join(', ');
    builder.addCode(`check if recipient($r), $r in [${recipients}];`);
  }

  if (restrictions.recipients?.blocklist?.length) {
    for (const blocked of restrictions.recipients.blocklist) {
      builder.addCode(`check if recipient($r), $r != "${escapeDatalogString(blocked)}";`);
    }
  }
}

function addChannelCaveats(
  builder: import('@biscuit-auth/biscuit-wasm').BiscuitBuilder,
  restrictions: GrantRestrictions,
): void {
  if (restrictions.channels?.allowedChannels?.length) {
    const channels = restrictions.channels.allowedChannels
      .map((c) => `"${escapeDatalogString(c)}"`)
      .join(', ');
    builder.addCode(`check if channel($c), $c in [${channels}];`);
  }

  if (restrictions.channels?.blockedChannels?.length) {
    for (const blocked of restrictions.channels.blockedChannels) {
      builder.addCode(`check if channel($c), $c != "${escapeDatalogString(blocked)}";`);
    }
  }
}

export async function generatePermissionToken(
  grant: PermissionGrant,
  keyPair: GrantKeyPair,
): Promise<string> {
  const builder = Biscuit.builder();

  builder.addFact(fact`node("${escapeDatalogString(grant.nodeId)}");`);
  builder.addFact(fact`app("${escapeDatalogString(grant.appId)}");`);
  builder.addFact(fact`grant_id("${escapeDatalogString(grant.grantId)}");`);

  for (const permission of grant.permissions) {
    const escapedResource = escapeDatalogString(permission.resource);
    builder.addCode(`${permission.action}("${escapedResource}");`);
  }

  if (grant.restrictions) {
    const restrictions = grant.restrictions;

    if (restrictions.amount) {
      addAmountCaveats(builder, restrictions.amount);
    }

    if (restrictions.count) {
      addCountCaveats(builder, restrictions.count);
    }

    addTimeWindowCaveats(builder, restrictions);
    addRecipientCaveats(builder, restrictions);
    addChannelCaveats(builder, restrictions);
  }

  const privateKey = createPrivateKeyFromHex(keyPair.privateKey);
  const kp = KeyPair.fromPrivateKey(privateKey);

  const token = builder.build(kp.getPrivateKey());
  const base64Token = token.toBase64();

  token.free();
  builder.free();
  privateKey.free();
  kp.free();

  return base64Token;
}

export function parsePermissionToken(tokenBase64: string, publicKeyHex: string): Biscuit {
  const cleanHex = publicKeyHex.replace(/^0x/i, '');
  const pubKeyBytes = hexToBytes(cleanHex);
  const publicKey = PublicKey.fromBytes(pubKeyBytes, SignatureAlgorithm.Ed25519);
  return Biscuit.fromBase64(tokenBase64, publicKey);
}
