import { ShyftSdk, Network, TxnAction } from '@shyft-to/js';
import { shyftApiKey } from './shared';
import * as path from 'path';
import * as fs from 'fs';
import { Mint } from './models';

const targetDir = path.resolve('./results');
const resultMintsWithStreamDataPath = path.resolve(targetDir, 'result-mints-with-stream-data.json');

const shyft = new ShyftSdk({ apiKey: shyftApiKey, network: Network.Mainnet });
const webhookUrl = 'https://solana-nft-webhook.vercel.app/api/webhook-shyft-madlads';

const registerCallback = async (mintIds: string[]): ReturnType<typeof shyft.callback.register> => {
  console.log(`registerCallback for ${mintIds.length} addresses`);

  const result = await shyft.callback.register({
    addresses: mintIds,
    callbackUrl: webhookUrl,
    enableRaw: false,
    enableEvents: true,
    events: [TxnAction.NFT_LIST, TxnAction.NFT_LIST_UPDATE],
  });

  return result;
};

const updateCallback = async (callbackId: string, mintIds: string[]): ReturnType<typeof shyft.callback.update> => {
  console.log(`updateCallback ${callbackId} for ${mintIds.length} addresses`);
  const result = await shyft.callback.update({
    id: callbackId,
    addresses: mintIds,
    callbackUrl: webhookUrl,
    enableEvents: false,
    enableRaw: true,
    events: [TxnAction.NFT_LIST, TxnAction.NFT_LIST_UPDATE],
  });

  return result;
};

const deleteCallback = async (callbackId: string): ReturnType<typeof shyft.callback.remove> => {
  console.log(`deleteCallback ${callbackId}`);
  const result = await shyft.callback.remove({ id: callbackId });

  return result;
};

(async () => {
  const callbacks = await shyft.callback.list();
  console.log(callbacks);

  // delete and register seems to work more reliable than calling update
  // if (callbacks.length) {
  //   const result = await deleteCallback(callbacks[0].id);
  //   console.log(result);
  // }

  const mints: Mint[] = fs.existsSync(resultMintsWithStreamDataPath)
    ? JSON.parse(fs.readFileSync(resultMintsWithStreamDataPath, 'utf8'))
    : [];
  
  if (mints.length) {
    // TODO: check claimable?
    const mintIds = mints.filter(mint => mint.remainingWormhole > 10000).map(mint => mint.id)

    const result = await registerCallback(mintIds);
    console.log(result);
  } else {
    throw new Error(`couldn't read mints from ${resultMintsWithStreamDataPath}`)
  }
})();
