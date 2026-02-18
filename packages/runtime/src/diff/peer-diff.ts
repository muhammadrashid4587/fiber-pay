import type { PeerInfo } from '@fiber-pay/sdk';

export type PeerDiffEvent =
  | { type: 'peer_connected'; peer: PeerInfo }
  | { type: 'peer_disconnected'; peer: PeerInfo };

export function diffPeers(previous: PeerInfo[], current: PeerInfo[]): PeerDiffEvent[] {
  const events: PeerDiffEvent[] = [];
  const prevById = new Map(previous.map((peer) => [peer.peer_id, peer]));
  const currById = new Map(current.map((peer) => [peer.peer_id, peer]));

  for (const [peerId, peer] of currById.entries()) {
    if (!prevById.has(peerId)) {
      events.push({ type: 'peer_connected', peer });
    }
  }

  for (const [peerId, peer] of prevById.entries()) {
    if (!currById.has(peerId)) {
      events.push({ type: 'peer_disconnected', peer });
    }
  }

  return events;
}
