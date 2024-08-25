import { Helius, AssetSortBy, AssetSortDirection, type DAS } from 'helius-sdk';
import { Network, ShyftSdk, type TransactionHistory } from '@shyft-to/js';
import { heliusApiKey, shyftApiKey } from './shared';
import * as path from 'path';
import * as fs from 'fs';
import type { Account } from './models';

const targetDir = path.resolve('./results');
const resultOriginAccountHistoryPath = path.resolve(targetDir, 'result-origin-account-history.json');
const resultAccountsPath = path.resolve(targetDir, 'result-accounts.json');

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

const run = async (): Promise<void> => {
  // const history = await getFullTransactionHistory();
  // const accounts = await getWormholeAccountBalances(history);

  const accounts = await getWormholeAccountBalances();

  // const accounts: Account[] = fs.existsSync(resultAccountsPath)
  //   ? JSON.parse(fs.readFileSync(resultAccountsPath, 'utf8'))
  //   : [];

  // // cache valuable result
  // fs.mkdirSync(targetDir, { recursive: true });
  // fs.writeFileSync(resultAccountsPath, JSON.stringify(accounts, null, 2));
};

run();
