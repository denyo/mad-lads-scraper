import { Helius } from 'helius-sdk';
import { heliusApiKey, originAccount, wormHoleTokenAddress } from './shared';
import { decodeStream } from '@streamflow/stream/solana';
import { Mint } from './models';

const helius = new Helius(heliusApiKey);

export const base64ToUint8Array = (base64_string: string): Uint8Array => {
  return Uint8Array.from(atob(base64_string), (c) => c.charCodeAt(0));
};

type ProgramAccount = typeof programAccount;
const programAccount = {
  account: {
    data: [
      'AAAAAAAAAAADhuAMZgAAAAAAAAAAAAAAAAAAAAAAAAAAOHHuZwAAAAAAAAAAAAAAAA3gB9Xe6p7/5baCiT9KPSEVnw/vXjSv9l+smY6Sanfd4TLJZ7wvMyiX2nfBaCOkryzq/QhexbJ4CHoKfI/ssDF3adGe/6AeMbSdGQt4drT/YIc5MglH7DR9YR6+56XafjJuIzCTTARPn4pZzovb2QzF2qNSFqcepPSlX3Y7gqo9aSf9wB6pBvltcTeHTN162tAMo1dkYZMQ5UGWx4HYTVvrxgdhaM2aktsqdKuEipGpQfFW01ZqYINgooB9BGDsPkHl5R1mQ0ba9Ai8PKVNKf8XMsMfSRvbApBNvbh6jHDCvEI55RNCGAMMAs8csdNVL28oVMUHRkQPAi5D81M1AtkAAAAAAAAAAAAAAAAAAAAAAAAAAA3gB9Xe6p7/5baCiT9KPSEVnw/vXjSv9l+smY6Sanfd4TLJZ7wvMyiX2nfBaCOkryzq/QhexbJ4CHoKfI/ssDEAAAAAAAAAAAAAAAAAAAAAAAAAALg9DWYAAAAAAKCsuQMAAACAUQEAAAAAAKOSGAIAAAAAuD0NZgAAAAAAILy+AAAAAAAAAQAAAFdvcm1ob2xlIEFpcmRyb3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'base64',
    ],
    executable: false,
    lamports: 8574720,
    owner: 'strmdbLr6w7QNmsiEXyFwWg3VSfg1GiELgU27P8aCGw',
    rentEpoch: 18446744073709552000,
    space: 1104,
  },
  pubkey: '3PMwuJMq5uBKDZn9eJHwrfb8XALSEbYjzgrcfo5Y3Kfm',
};

export const getStreamflowProgramAccounts = async (): Promise<ProgramAccount[]> => {
  const data = (await fetch(helius.endpoint, {
    body: JSON.stringify({
      method: 'getProgramAccounts',
      jsonrpc: '2.0',
      params: [
        'strmdbLr6w7QNmsiEXyFwWg3VSfg1GiELgU27P8aCGw',
        {
          encoding: 'base64',
          commitment: 'confirmed',
          filters: [
            { memcmp: { offset: 49, bytes: originAccount } },
            { memcmp: { offset: 177, bytes: wormHoleTokenAddress } },
          ],
        },
      ],
      id: '3d207021-0c53-45de-ad07-8bed7a8b492d',
    }),
    method: 'POST',
  }).then((res) => res.json())) as { result: ProgramAccount[] };

  const programAccounts: ProgramAccount[] = data.result;

  return programAccounts;
};

export const decodeStreamflowProgramAccount = (programAccount: ProgramAccount): Omit<Mint, 'id' | 'name'> => {
  const now = new Date().getTime();
  const data = decodeStream(base64ToUint8Array(programAccount.account.data[0]) as Buffer);

  const cliffAmount = data.cliffAmount.toNumber();
  const lastWithdrawnDate = data.lastWithdrawnAt.gt(data.cliff);
  const claimedAmount = data.withdrawnAmount.toNumber();
  const vestedTime = now / 1000 - data.start.toNumber();
  const u = Math.floor(data.depositedAmount.toNumber() / data.amountPerPeriod.toNumber());
  const d = Math.floor(
    (Math.max(data.lastWithdrawnAt.toNumber(), data.start.toNumber()) - data.start.toNumber()) / data.period.toNumber(),
  );
  const f = Math.min(u, Math.floor(vestedTime / data.period.toNumber()));
  const h = Math.min(u, f - d);
  const vestedAmountPerDay = data.amountPerPeriod.toNumber() * (data.period.toNumber() / 86400);
  const claimableAmount = h * data.amountPerPeriod.toNumber() + (lastWithdrawnDate ? 0 : cliffAmount);

  const lockedAmount = data.depositedAmount.sub(data.withdrawnAmount).toNumber() - claimableAmount;

  return {
    lockedWormhole: formatWormhole(lockedAmount),
    unlockedWormhole: formatWormhole(data.depositedAmount.toNumber() - lockedAmount),
    claimedWormhole: formatWormhole(claimedAmount),
    vestingPerDay: formatWormhole(vestedAmountPerDay),
    claimableWormhole: formatWormhole(claimableAmount),
    remainingWormhole: formatWormhole(data.depositedAmount.toNumber() - claimedAmount),
  };
};

const wormholeDecimals = Math.pow(10, 6);
export const formatWormhole = (value: number): number => Math.floor((value / wormholeDecimals) * 100) / 100;
