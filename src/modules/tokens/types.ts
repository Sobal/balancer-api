import { Token as SDKToken } from '@sobal/sdk';
import { BigNumberish } from '@ethersproject/bignumber';

export interface Token extends SDKToken {
  chainId: number;
  lastUpdate?: number;
  noPriceData?: boolean;
  key?: number;
}

export interface GroupedToken {
  [chainId: number]: Token[];
}

export enum SwapTokenType {
  fixed,
  min,
  max,
}

export interface SwapToken {
  address: string;
  amount: BigNumberish;
  type: SwapTokenType;
}
