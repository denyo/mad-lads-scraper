export type Account = {
  id: string;
  amount: number;
};

export type Mint = {
  id: string;
  name: string;
  streamId?: string;
  streamRecipient?: string;
  unlockedWormhole?: number;
  claimableWormhole?: number;
  claimedWormhole?: number;
  lockedWormhole?: number;
  remainingWormhole?: number;
  vestingPerDay?: number;
};
