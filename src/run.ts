import { Helius, AssetSortBy, AssetSortDirection, type DAS } from 'helius-sdk';
import { Network, ShyftSdk, type TransactionHistory } from '@shyft-to/js';
import { heliusApiKey, shyftApiKey } from './shared';
import * as path from 'path';
import * as fs from 'fs';
import type { Account, Mint } from './models';
import { StreamflowSolana, calculateUnlockedAmount, getBN, getNumberFromBN } from '@streamflow/stream';
import { mintIdToStreamMapping } from './mintIdToStreamMapping';
import { decodeStream } from '@streamflow/stream/solana';

const targetDir = path.resolve('./results');
const resultOriginAccountHistoryPath = path.resolve(targetDir, 'result-origin-account-history.json');
const resultAccountsPath = path.resolve(targetDir, 'result-accounts.json');
const resultMintsPath = path.resolve(targetDir, 'result-mints.json');
const resultMintsRawPath = path.resolve(targetDir, 'result-mints-raw.json');
const resultMintsWithStreamsPath = path.resolve(targetDir, 'result-mints-with-streams.json');
const resultMintsWithStreamDataPath = path.resolve(targetDir, 'result-mints-with-stream-data.json');
const resultProgramAccountsPath = path.resolve(targetDir, 'result-program-accounts.json');

const originAccount = 'wASAZL5nz5E9dFdeqvH75pjLEgGi5wAaKFV1XNPz5Ze';
const wormHoleTokenAddress = '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ';

const helius = new Helius(heliusApiKey);
const shyft = new ShyftSdk({ apiKey: shyftApiKey, network: Network.Mainnet });

const getFullTransactionHistory = async (): Promise<TransactionHistory> => {
  let history: TransactionHistory = fs.existsSync(resultOriginAccountHistoryPath)
    ? JSON.parse(fs.readFileSync(resultOriginAccountHistoryPath, 'utf8'))
    : [];

  // let done = false;
  // let lastTxSignature: string =
  //   history[history.length - 1]?.signatures[0] ||
  //   '4Pg7JjXfcFCoVBZNpZz4wLAREQ9igbfeYmegcDtQNsqR7r4kUhZXvQiGAoATXZmYYbnLocbDGz4LcXzrEszfWpXN';
  // let page = 1;
  // while (!done) {
  //   console.log(`fetching page ${page} with lastTxSignature`, lastTxSignature);
  //   const result = await shyft.transaction.history({
  //     account: originAccount,
  //     txNum: 100,
  //     beforeTxSignature: lastTxSignature,
  //   });

  //   history = history.concat(result);

  //   if (result.length % 100 === 0) {
  //     lastTxSignature = result[result.length - 1].signatures[0];
  //     await new Promise((resolve) => setTimeout(resolve, 500));
  //   } else {
  //     done = true;
  //   }
  //   page++;

  //   fs.mkdirSync(targetDir, { recursive: true });
  //   fs.writeFileSync(resultOriginAccountHistoryPath, JSON.stringify(history, null, 2));
  // }

  return history;
};

const getWormholeAccounts = async (history: TransactionHistory): Promise<Account[]> => {
  let accounts: Account[] = fs.existsSync(resultAccountsPath)
    ? JSON.parse(fs.readFileSync(resultAccountsPath, 'utf8'))
    : [];

  if (!accounts.length) {
    accounts = history
      .filter(
        (txn) =>
          txn.type === 'TOKEN_TRANSFER' &&
          txn.actions.some(
            (action) => action.info?.sender === originAccount && action.info?.token_address === wormHoleTokenAddress,
          ),
      )
      .map((txn) => {
        const { info } = txn.actions.find((action) => action.type === 'TOKEN_TRANSFER');
        return { id: info.receiver, amount: info.amount };
      });

    console.log(`filtered and transformed ${history.length} txns to ${accounts.length} wormhole accounts`);

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultAccountsPath, JSON.stringify(accounts, null, 2));
  }

  return accounts;
};

export const getHeliusSearchAssets = async (ownerAddress: string): Promise<DAS.GetAssetResponseList> => {
  const response = await helius.rpc.searchAssets({
    ownerAddress: ownerAddress,
    tokenType: 'fungible', // https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api/search-assets#fungible-token-extension
    limit: 10,
    page: 1,

    sortBy: {
      sortBy: AssetSortBy.Created,
      sortDirection: AssetSortDirection.Desc,
    },
  });

  return response;
};

const getWormholeAccountBalances = async (): Promise<Account[]> => {
  let accounts: Account[] = fs.existsSync(resultAccountsPath)
    ? JSON.parse(fs.readFileSync(resultAccountsPath, 'utf8'))
    : [];

  // const accountBalances: Account[] = (
  //   await Promise.allSettled(
  //     accounts.slice(0, 10).map(async (account, i) => {
  //       await new Promise((resolve) => setTimeout(resolve, i * 500));
  //       const { balance } = await shyft.wallet.getTokenBalance({ wallet: account.id, token: wormHoleTokenAddress });
  //       return { ...account, amount: balance };
  //     }),
  //   )
  // ).map((prom) => (prom.status === 'fulfilled' ? prom.value : undefined));
  // console.log(accountBalances);

  accounts = (
    await Promise.allSettled(
      accounts.map(async (account, i, arr) => {
        await new Promise((resolve) => setTimeout(resolve, i * 250));
        console.log(`calling getHeliusSearchAssets() for ${i + 1}/${arr.length}`, account.id);
        try {
          const item = (await getHeliusSearchAssets(account.id)).items.find((item) => item.id === wormHoleTokenAddress);
          return { ...account, amount: item.token_info.balance / Math.pow(10, item.token_info.decimals) };
        } catch (e) {
          console.error(e);
          return { ...account, amount: -1 };
        }
      }),
    )
  ).map((prom) => (prom.status === 'fulfilled' ? prom.value : undefined));

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(resultAccountsPath, JSON.stringify(accounts, null, 2));

  return accounts;
};

const getMadLadsMints = async (): Promise<Mint[]> => {
  let mints: Mint[] = fs.existsSync(resultMintsPath) ? JSON.parse(fs.readFileSync(resultMintsPath, 'utf8')) : [];

  if (!mints.length) {
    let mintsRaw: DAS.GetAssetResponse[] = fs.existsSync(resultMintsRawPath)
      ? JSON.parse(fs.readFileSync(resultMintsRawPath, 'utf8'))
      : [];
    let done = false;
    let page = 1;

    while (!done) {
      console.log(`getMadLadsMints page ${page}`);
      const result = await helius.rpc.getAssetsByGroup({
        groupKey: 'collection',
        groupValue: 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w',
        page,
        limit: 1000,
      });
      mintsRaw = mintsRaw.concat(result.items);

      if (result.total === 1000) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        page++;
      } else {
        done = true;
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultMintsRawPath, JSON.stringify(mintsRaw, null, 2));

    mints = mintsRaw.map((item) => ({ id: item.id, name: item.content.metadata.name }));
    fs.writeFileSync(resultMintsPath, JSON.stringify(mints, null, 2));
  }

  return mints;
};

const getMintsWithStreams = async (): Promise<Mint[]> => {
  let mintsWithStreams = fs.existsSync(resultMintsWithStreamsPath)
    ? JSON.parse(fs.readFileSync(resultMintsWithStreamsPath, 'utf8'))
    : [];

  if (!mintsWithStreams.length) {
    const mints = await getMadLadsMints();
    mintsWithStreams = mints
      .map((mint) => ({
        ...mint,
        ...mintIdToStreamMapping[mint.id],
      }))
      .filter((mint) => mint.streamId);

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultMintsWithStreamsPath, JSON.stringify(mintsWithStreams, null, 2));
  }

  return mintsWithStreams;
};

const base64ToUint8Array = (base64_string: string): Uint8Array => {
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

const getStreamflowProgramAccounts = async (): Promise<ProgramAccount[]> => {
  // let programAccounts: ProgramAccount[] = fs.existsSync(resultProgramAccountsPath)
  //   ? JSON.parse(fs.readFileSync(resultProgramAccountsPath, 'utf8'))
  //   : [];

  // if (!programAccounts.length) {
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

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(resultProgramAccountsPath, JSON.stringify(programAccounts, null, 2));
  // }

  return programAccounts;
};

const getMintsWithStreamData = async (): Promise<Mint[]> => {
  let mintsWithStreamData: Mint[] = fs.existsSync(resultMintsWithStreamDataPath)
    ? JSON.parse(fs.readFileSync(resultMintsWithStreamDataPath, 'utf8'))
    : [];

  if (!mintsWithStreamData.length) {
    const mints = await getMintsWithStreams();

    // could get it via client but only 1 by 1, therefore decoding result of getProgramAccounts is easier
    // const client = new StreamflowSolana.SolanaStreamClient('https://api.mainnet-beta.solana.com');
    // const stream = await client.getOne({
    //   id: '5xRSqXZMufqjFgFAZwXmHt3kY41ZC6SmWKXkSjVRXFkr',
    // });

    const programAccounts = await getStreamflowProgramAccounts();
    const programAccountsWithMapping = programAccounts.filter((item) =>
      mints.some((mint) => mint.streamId === item.pubkey),
    );

    const streams = programAccountsWithMapping
      .filter((item) => item.pubkey)
      .map((item) => ({ streamId: item.pubkey, data: item.account.data[0] }));

    const decodedStreams = streams.map((stream) => ({
      streamId: stream.streamId,
      data: decodeStream(base64ToUint8Array(stream.data) as Buffer),
    }));

    const now = new Date().getTime();

    mintsWithStreamData = mints
      .map<Mint>((mint) => {
        const { data } = decodedStreams.find((item) => item.streamId === mint.streamId);

        const cliffAmount = data.cliffAmount.toNumber();
        const lastWithdrawnDate = data.lastWithdrawnAt.gt(data.cliff);
        const claimedAmount = data.withdrawnAmount.toNumber();
        const vestedTime = now / 1000 - data.start.toNumber();
        const u = Math.floor(data.depositedAmount.toNumber() / data.amountPerPeriod.toNumber());
        const d = Math.floor(
          (Math.max(data.lastWithdrawnAt.toNumber(), data.start.toNumber()) - data.start.toNumber()) /
            data.period.toNumber(),
        );
        const f = Math.min(u, Math.floor(vestedTime / data.period.toNumber()));
        const h = Math.min(u, f - d);
        const vestedAmountPerDay = data.amountPerPeriod.toNumber() * (data.period.toNumber() / 86400);
        const claimableAmount = h * data.amountPerPeriod.toNumber() + (lastWithdrawnDate ? 0 : cliffAmount);

        const extendedMint: Mint = {
          ...mint,
          lockedWormhole: formatWormhole(data.depositedAmount.sub(data.withdrawnAmount).toNumber() - claimableAmount),
          claimedWormhole: formatWormhole(claimedAmount),
          vestingPerDay: formatWormhole(vestedAmountPerDay),
          claimableWormhole: formatWormhole(claimableAmount),
          remainingWormhole: formatWormhole(data.depositedAmount.toNumber() - claimedAmount),
        };
        return extendedMint;
      })
      .sort((a, b) => (a.remainingWormhole < b.remainingWormhole ? 1 : -1));

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultMintsWithStreamDataPath, JSON.stringify(mintsWithStreamData, null, 2));
  }

  return mintsWithStreamData;
};

const wormholeDecimals = Math.pow(10, 6);
const formatWormhole = (value: number): number => Math.floor((value / wormholeDecimals) * 100) / 100;

// what about unmapped token accounts (4073 mapped streams vs 6467 programAccounts vs 6471 wormhole accounts)?

const run = async (): Promise<void> => {
  // const history = await getFullTransactionHistory();
  // const accounts = await getWormholeAccountBalances(history);

  // const accounts = await getWormholeAccountBalances();
  // const mints = await getMadLadsMints();
  // const mints = await tryStreamflow();

  // const mintsWithStreams = await getMintsWithStreamData();
  // console.log(mintsWithStreams.length);

  // await getMintsWithStreams();
  await getMintsWithStreamData();
};

run();
