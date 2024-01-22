import { JsonRpcProvider } from '@ethersproject/providers';
import { BigNumber, ethers } from 'ethers';
import { GroupedToken, Token } from './types';
import { Contract } from '@ethersproject/contracts';
import PriceFetcher from '@/modules/prices/price-fetcher';
// import BeetsPriceFetcher from '@/modules/prices/beets-price-fetcher';
import { getToken, updateTokens } from '@/modules/dynamodb';
import { TokenPrices } from '@sobal/sdk';
import { getRpcUrl } from '@/modules/network';
import configs from '@/config';

const log = console.log;

export async function updateTokenPrices(
  tokens: Token[],
  abortOnRateLimit = false
) {
  // const beetsPriceFetcher = new BeetsPriceFetcher();
  // log(`fetching prices for ${tokens.length} tokens from beets API`);
  // const beetsTokensWithPrices = await beetsPriceFetcher.fetch(tokens);
  // log(`Saving ${beetsTokensWithPrices.length} updated tokens to DB`);
  // await updateTokens(beetsTokensWithPrices);
  const priceFetcher = new PriceFetcher(abortOnRateLimit);
  log(`fetching prices for ${tokens.length} tokens from coingecko`);
  const tokensWithPrices = await priceFetcher.fetch(tokens);
  log(`Saving ${tokensWithPrices.length} updated tokens to DB`);
  await updateTokens(tokensWithPrices);
  log('finished updating token prices');
}

export async function updateCoingeckoFullTokenList(
  Network: Record<string, number>,
  abortOnRateLimit = false
) {

  const priceFetcher = new PriceFetcher(abortOnRateLimit);
  log(`Fetching tokens for all chains from coingecko.`);
  const tokens = await priceFetcher.getCoingeckoFullTokenListByChains(Network);
  log(`Fetched full list of ${tokens.length} tokens from coingecko for all chains`);
  const tokensWithPrices = await priceFetcher.fetch(tokens);
  log('Preparing',tokensWithPrices.length,'tokens to save to DB');

  const sortedTokensWithPrices: GroupedToken = tokensWithPrices.reduce((res, obj, index) => {
    const key = obj.chainId;
    const newObj = { symbol: obj.symbol, chainId: obj.chainId, address: obj.address, price: obj.price, decimals: obj.decimals, id: obj.id, key: index};
    if (res[key])
      res[key].push(newObj);
    else
      res[key] = [newObj];
    return res;
  }, {})

  for (const [chainId, token] of Object.entries(sortedTokensWithPrices)) {
    log('Preparing to fetch tokeninfo for chain', chainId)
    const infuraUrl = getRpcUrl(Number(chainId));
    const provider: any = new JsonRpcProvider(infuraUrl);

  log(`Getting decimals for tokens which are missing`)
    const tokenInfo = await Promise.all(
      token.map(async (token) => {
        if (!token.decimals) {
          const tokenResult = await getTokenInfo(provider, token.chainId, token.address, true);
          return { key: token.key, address: token.address, decimals: tokenResult.decimals, symbol: tokenResult.symbol }
        }
      }));

    log('Merging decimals to',tokenInfo.length,'token objects for chain', chainId);
    tokenInfo.forEach(result => {
      tokensWithPrices[result.key].decimals = result.decimals;
      tokensWithPrices[result.key].symbol = result.symbol;
    })
  }

  log('Building native asset token data');
  Object.values(configs)
  .reduce((res, obj) => {
    if(!priceFetcher.nativeAssetPrices[obj.coingecko.nativeAssetPriceSymbol]) return;
    const key = obj.networkId;
    const newObj = { address: obj.addresses.nativeAsset.toLowerCase(), symbol: obj.coingecko.nativeAssetPriceSymbol, decimals: obj.coingecko.nativeAssetDecimals, id: obj.coingecko.nativeAssetId, chainId: key, price: {usd: priceFetcher.nativeAssetPrices[obj.coingecko.nativeAssetPriceSymbol].toString(), [obj.coingecko.nativeAssetPriceSymbol]: '1'} };
    log ('Adding Native Token Entry:',newObj)
    tokensWithPrices.push(newObj);
    return res;
  }, {});

  await updateTokens(tokensWithPrices);
  log('Finished updating all token prices on database');
}

export function tokensToTokenPrices(tokens: Token[]): TokenPrices {
  const tokenPrices: TokenPrices = {};
  tokens.forEach(token => {
    if (token.price) {
      tokenPrices[token.address] = token.price;
    }
  });

  return tokenPrices;
}

export async function getTokenInfo(
  provider,
  chainId: number,
  address: string,
  skipCachedCheck?: boolean,
): Promise<Token> {
  const tokenAddress = ethers.utils.getAddress(address);

  const cachedInfo = await getToken(chainId, tokenAddress);

  if (cachedInfo !== undefined) {
    if ((skipCachedCheck && cachedInfo.decimals) || !skipCachedCheck) {
      return cachedInfo;
    }
  }


  const contract = new Contract(
    tokenAddress,
    [
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
    ],
    provider
  );

  let symbol = `${tokenAddress.substr(0, 4)}..${tokenAddress.substr(40)}`;
  try {
    symbol = await contract.symbol();
    // eslint-disable-next-line no-empty
  } catch { }

  let decimals = 18;
  try {
    decimals = await contract.decimals();
    decimals = BigNumber.from(decimals).toNumber();
    // eslint-disable-next-line no-empty
  } catch { }

  const tokenInfo = {
    chainId,
    address: tokenAddress,
    symbol,
    decimals,
    price: {},
  };

  return tokenInfo;
}

export async function getSymbol(
  provider,
  chainId: number,
  tokenAddress: string,
  skipCachedCheck?: boolean,
) {
  const tokenInfo = await getTokenInfo(provider, chainId, tokenAddress, skipCachedCheck);
  return tokenInfo.symbol;
}
export async function getDecimals(
  provider,
  chainId: number,
  tokenAddress: string,
  skipCachedCheck?: boolean,
) {
  const tokenInfo = await getTokenInfo(provider, chainId, tokenAddress, skipCachedCheck);
  return tokenInfo.decimals;
}
