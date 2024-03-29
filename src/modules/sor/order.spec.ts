import config from '@/config';
import { TOKENS } from '@/constants';
import { parseFixed } from '@ethersproject/bignumber';
import { createSorOrder } from './order';

jest.mock('@sobal/sdk');
jest.mock('@/modules/dynamodb/dynamodb');

const networkId = 1;
let sorRequest;

describe('sor/order', () => {
  describe('createSorOrder', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      sorRequest = {
        sellToken: TOKENS[networkId].ETH.address,
        buyToken: TOKENS[networkId].BAL.address,
        amount: parseFixed('1', 18).toString(),
        orderKind: 'sell',
        gasPrice: parseFixed('10', 9).toString(),
        sender: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      };
      require('@sobal/sdk')._setEncodedBatchSwap(
        '0x945bcec9000000ffffffffffff444be97813ea77ac'
      );
      require('@/modules/dynamodb/dynamodb')._setToken(
        TOKENS[networkId].ETH.address,
        {
          ...TOKENS[networkId].ETH,
          price: {
            usd: '2500',
            eth: '1',
          },
        }
      );
      require('@/modules/dynamodb/dynamodb')._setToken(TOKENS[networkId].BAL.address, {
        ...TOKENS[networkId].BAL,
        price: {
          usd: '10',
          eth: '0.004'
        }
      })
      require('@sobal/sdk')._setMockSwapInfo({
        swaps: [],
        tokenAddresses: [],
        swapAmount: parseFixed('1', 18),
        returnAmount: parseFixed('250', 18),
        marketSp: '0.004',
        tokenIn: TOKENS[networkId].ETH.address,
        tokenOut: TOKENS[networkId].BAL.address
      })
    });

    describe('Price Response', () => {
      it('Generates correct price data for a sell order', async () => {
        const sorOrder = await createSorOrder(networkId, sorRequest);
        console.log(sorOrder.price);
        expect(sorOrder.price.sellAmount).toEqual(parseFixed('1', 18))
        expect(sorOrder.price.buyAmount).toEqual(parseFixed('250', 18));
        expect(sorOrder.price.allowanceTarget).toEqual(config[networkId].addresses.vault);
        expect(sorOrder.price.price).toEqual('0.004');
      });

      it('Generates correct price data for a buy order', async () => {
        sorRequest.orderKind = 'buy';
        require('@sobal/sdk')._setMockSwapInfo({
          swaps: [],
          tokenAddresses: [],
          tokenIn: TOKENS[networkId].ETH.address,
          tokenOut: TOKENS[networkId].BAL.address,
          swapAmount: parseFixed('250', 18),
          returnAmount: parseFixed('1', 18),
          marketSp: '0.004',
        })

        const sorOrder = await createSorOrder(networkId, sorRequest);
        console.log(sorOrder.price);
        expect(sorOrder.price.sellAmount).toEqual(parseFixed('1', 18))
        expect(sorOrder.price.buyAmount).toEqual(parseFixed('250', 18));
        expect(sorOrder.price.allowanceTarget).toEqual(config[networkId].addresses.vault);
        expect(sorOrder.price.price).toEqual('0.004');
      });
    })

    describe('Batch Swaps', () => {
      it('Should return a valid order', async () => {
        const sorOrder = await createSorOrder(networkId, sorRequest);
        expect(sorOrder.to).toEqual(config[networkId].addresses.vault);
        expect(sorOrder.data.length).toBeGreaterThan(10);
        expect(sorOrder.value).toBe('0');
      });
    });

    describe('Join/Exit Relayer Swaps', () => {
      it('Should return a valid batchRelayer order', async () => {
        require('@sobal/sdk')._setIsJoinExitSwap(true);
        const sorOrder = await createSorOrder(networkId, sorRequest);
        expect(sorOrder.to).toEqual(config[networkId].addresses.batchRelayer);
        expect(sorOrder.data.length).toBeGreaterThan(10);
        expect(sorOrder.value).toBe('0');
      });
    });

    describe('Error Handling', () => {
      it('Should throw an error if you do not pass a sender in the request', async () => {
        delete sorRequest.sender;
        expect(async () => {
          await createSorOrder(networkId, sorRequest);
        }).rejects.toThrow(
          'To create a SOR order you must pass a sender address in the request'
        );
      });

      it('Should throw an error if you pass slippagePercentage as a string', async () => {
        sorRequest.slippagePercentage = '0.02';
        expect(async () => {
          await createSorOrder(networkId, sorRequest);
        }).rejects.toThrow('slippagePercentage must be a number');
      });

      it('Should throw an error if you pass a slippagePercentage greater than one', async () => {
        sorRequest.slippagePercentage = 1.1;
        expect(async () => {
          await createSorOrder(networkId, sorRequest);
        }).rejects.toThrow('Invalid slippage percentage. Must be 0 < n < 1.');
      });

      it('Should throw an error if you pass a slippagePercentage less than zero', async () => {
        sorRequest.slippagePercentage = -0.3;
        expect(async () => {
          await createSorOrder(networkId, sorRequest);
        }).rejects.toThrow('Invalid slippage percentage. Must be 0 < n < 1.');
      });
    });
  });
});
