import * as path from 'path';
import * as fs from 'fs';
import { favTensorNFT, getTensorFavNFTsForWallet, unfavTensorNFT } from './tensor';
import { Mint } from './models';

const targetDir = path.resolve('./results');
const resultMintsWithStreamDataPath = path.resolve(targetDir, 'result-mints-with-stream-data.json');

const favTensorNFTs = async () => {
  const mints: Mint[] = fs.existsSync(resultMintsWithStreamDataPath)
    ? JSON.parse(fs.readFileSync(resultMintsWithStreamDataPath, 'utf8'))
    : [];
  console.log('mints:', mints.length);

  const valuableMints = mints.filter((mint) => mint.claimableWormhole > 2000);
  console.log('valuableMints:', valuableMints.length);

  const currentFavs = await getTensorFavNFTsForWallet('Et6B96uSx2wSGLSdj95q1iYncpf43tTPU2mWvCv5s9Ad');
  // const favsToUnfav = currentFavs.filter((mintId) => !valuableMints.some((item) => item.id === mintId));
  // console.log('favsToUnfav:', favsToUnfav.length);

  // if (favsToUnfav.length) {
  //   const results = await Promise.all(
  //     favsToUnfav.map(async (mintId, i, arr) => {
  //       await new Promise((resolve) => setTimeout(resolve, i * 200));
  //       console.log(`calling unfavTensorNFT ${i + 1}/${arr.length} for mint: ${mintId}`);
  //       return await unfavTensorNFT(mintId);
  //     }),
  //   );

  //   console.log(results.map((item) => item[0].data.removeFavMint));
  // }

  const itemsToFav = valuableMints.filter((item) => !currentFavs.includes(item.id)).map((item) => item.id);
  console.log('itemsToFav:', itemsToFav.length);

  if (itemsToFav.length) {
    const results = await Promise.all(
      valuableMints.map(async (item, i, arr) => {
        await new Promise((resolve) => setTimeout(resolve, i * 200));
        console.log(`calling ${i + 1}/${arr.length} for mint: ${item.id}`);
        return await favTensorNFT(item.id);
      }),
    );
    console.log(results.map((item) => item[0].data.addFavMint));
  }
};

favTensorNFTs();
