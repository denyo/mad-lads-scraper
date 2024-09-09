import { Helius, AssetSortBy, AssetSortDirection, type DAS } from 'helius-sdk';
import { Network, ShyftSdk, type TransactionHistory } from '@shyft-to/js';
import { heliusApiKey, shyftApiKey } from './shared';
import * as path from 'path';
import * as fs from 'fs';
import type { Account, Mint } from './models';
import { StreamflowSolana, calculateUnlockedAmount, getBN, getNumberFromBN } from '@streamflow/stream';
import { mintIdToStreamMapping } from './mintIdToStreamMapping';
import { decodeStream } from '@streamflow/stream/solana';
import { base64ToUint8Array, decodeStreamflowProgramAccount, getStreamflowProgramAccounts } from './utils';

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
  let mintsWithStreams: Mint[] = fs.existsSync(resultMintsWithStreamsPath)
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

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultProgramAccountsPath, JSON.stringify(programAccountsWithMapping, null, 2));

    mintsWithStreamData = mints
      .map<Mint>((mint) => {
        const programAccount = programAccountsWithMapping.find((item) => item.pubkey === mint.streamId);

        const extendedMint: Mint = {
          ...mint,
          ...decodeStreamflowProgramAccount(programAccount),
        };
        return extendedMint;
      })
      .sort((a, b) => (a.claimableWormhole < b.claimableWormhole ? 1 : -1));

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(resultMintsWithStreamDataPath, JSON.stringify(mintsWithStreamData, null, 2));
  }

  return mintsWithStreamData;
};

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
