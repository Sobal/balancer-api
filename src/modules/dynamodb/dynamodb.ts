/* Functions for writing and reading to DynamoDB database */
import { captureException } from '@sentry/serverless';
import AWS from 'aws-sdk';
import {
  MAX_BATCH_WRITE_SIZE,
} from '@/constants';
import {
  POOLS_TABLE_SCHEMA,
  TOKENS_TABLE_SCHEMA,
} from './schemas';
import { Token } from '@/modules/tokens';
import { Pool } from '@/modules/pools';
import {
  generateUpdateExpression,
  unmarshallPool,
} from './dynamodb-marshaller';
import { chunk } from 'lodash';
import debug from 'debug';

const log = debug('balancer:dynamodb');

export interface UpdatePoolOptions {
  ignoreStaticData: boolean; // Ignore fields that rarely ever change
}

function getDynamoDB() {
  const dynamoDBConfig = {
    maxRetries: 50,
    retryDelayOptions: {
      customBackoff: () => 1000,
    },
  };
  return new AWS.DynamoDB(dynamoDBConfig);
}

function getDocClient() {
  const dynamodb = getDynamoDB();
  return new AWS.DynamoDB.DocumentClient({ service: dynamodb });
}

export async function isAlive() {
  const dynamodb = getDynamoDB();
  try {
    await Promise.race([
      dynamodb.listTables().promise(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      ),
    ]);
  } catch (e) {
    return false;
  }
  return true;
}

export async function updatePools(pools: Partial<Pool>[], options?: UpdatePoolOptions) {
  const dynamodb = getDynamoDB();

  const allPoolUpdateRequests = pools.map(function (pool) {
    return {
      Update: Object.assign(
        {
          Key: {
            id: { S: pool.id },
            chainId: { N: pool.chainId.toString() },
          },
          TableName: 'pools',
        },
        generateUpdateExpression(pool, options)
      ),
    };
  });

  const poolUpdateRequestChunks = chunk(
    allPoolUpdateRequests,
    MAX_BATCH_WRITE_SIZE
  );
  return Promise.allSettled(
    poolUpdateRequestChunks.map(async poolUpdateRequests => {
      const params = {
        TransactItems: poolUpdateRequests,
      };
      await dynamodb
        .transactWriteItems(params, e => {
          if (e) {
            if (e.code === 'ProvisionedThroughputExceededException') {
              console.error(
                'Unable to update pools - Table Throughput exceeded'
              );
              return;
            }
            if (e.code === 'TransactionCanceledException' && e.message.includes('TransactionConflict')) {
              console.error(
                'Unable to update pools - Conflict with concurrent update'
              );
              return;
            }
            captureException(e, { extra: { poolUpdateRequests }});
            console.error(
              `Unable to update pools ${JSON.stringify(
                poolUpdateRequests
              )} Error JSON: ${JSON.stringify(e, null, 2)}`
            );
          }
        })
        .promise();
    })
  );
}

export async function getPools(
  chainId?: number,
  lastResult?: any
): Promise<Pool[]> {
  const dynamodb = getDynamoDB();
  const params: AWS.DynamoDB.ScanInput = {
    TableName: 'pools',
    ExclusiveStartKey: lastResult ? lastResult.LastEvaluatedKey : undefined,
  };

  if (chainId) {
    params.FilterExpression = 'chainId = :chainId';
    params.ExpressionAttributeValues = {
      ':chainId': { N: chainId.toString() },
    };
  }

  try {
    const pools = await dynamodb.scan(params).promise();

    if (lastResult) {
      pools.Items = lastResult.Items.concat(pools.Items);
    }
    if (pools.LastEvaluatedKey) {
      return await getPools(chainId, pools);
    }
    return pools.Items.map(ddbItem => unmarshallPool(ddbItem)) as Pool[];
  } catch (e) {
    console.error('Failed to get pools, error is: ', e);
    captureException(e, { extra: { chainId } })
    return [];
  }
}

export async function queryPools(
  additionalParams?: any,
  lastResult?: any
): Promise<Pool[]> {
  const dynamodb = getDynamoDB();
  const params = {
    TableName: 'pools',
    ExclusiveStartKey: lastResult ? lastResult.LastEvaluatedKey : undefined,
    ...(additionalParams || {}),
  };

  try {
    const pools = await dynamodb.query(params).promise();

    if (lastResult) {
      pools.Items = lastResult.Items.concat(pools.Items);
    }
    if (pools.LastEvaluatedKey) {
      return await queryPools(additionalParams, pools);
    }
    return pools.Items.map(ddbItem => unmarshallPool(ddbItem)) as Pool[];
  } catch (e) {
    console.error('Failed to get pools, error is: ', e);
    captureException(e, { extra: { additionalParams, lastResult } })
    return [];
  }
}

export async function getPool(chainId: number, id: string) {
  const dynamodb = getDynamoDB();
  const params: AWS.DynamoDB.GetItemInput = {
    TableName: 'pools',
    Key: {
      id: { S: id },
      chainId: { N: chainId.toString() },
    },
  };

  try {
    const pool = await dynamodb.getItem(params).promise();
    const unmarshalledPool = unmarshallPool(pool.Item);
    return unmarshalledPool;
  } catch (e) {
    console.error(`Failed to get pool: ${chainId}, ${id}. Error is:`, e);
    captureException(e, { extra: { chainId, id } })
  }
}

export async function getToken(
  chainId: number,
  address: string
): Promise<Token> {
  const docClient = getDocClient();
  address = address.toLowerCase();
  const params = {
    TableName: 'tokens',
    Key: { chainId, address },
  };

  try {
    const token = await docClient.get(params).promise();
    return token.Item as Token;
  } catch (e) {
    console.error(`Failed to get token: ${chainId}, ${address}. Error is:`, e);
    captureException(e, { extra: { chainId, address } })
  }
}

export async function getTokens(
  chainId?: number,
  lastResult?: any
): Promise<Token[]> {
  const docClient = getDocClient();
  const params: any = {
    TableName: 'tokens',
    ExclusiveStartKey: lastResult ? lastResult.LastEvaluatedKey : undefined,
  };
  if (chainId != null) {
    Object.assign(params, {
      FilterExpression: 'chainId = :chainId',
      ExpressionAttributeValues: {
        ':chainId': chainId,
      },
    });
  }
  try {
    const tokens = await docClient.scan(params).promise();
    if (lastResult) {
      tokens.Items = lastResult.Items.concat(tokens.Items);
    }
    if (tokens.LastEvaluatedKey) {
      return await getTokens(chainId, tokens);
    }
    return tokens.Items as Token[];
  } catch (e) {
    console.error('Failed to get tokens, error is: ', e);
    captureException(e, { extra: { chainId } })
    return [];
  }
}

export async function updateToken(tokenInfo: Token) {
  const docClient = getDocClient();
  tokenInfo.address = tokenInfo.address.toLowerCase();
  tokenInfo.lastUpdate = Date.now();
  const params = {
    TableName: 'tokens',
    Item: tokenInfo,
  };

  log(`Saving token: ${JSON.stringify(tokenInfo)}`);

  try {
    await docClient.put(params).promise();
  } catch (e) {
    log(`Unable to add token. Error JSON: ${JSON.stringify(e, null, 2)}`);
    captureException(e, { extra: { tokenInfo } })
  }
}

export async function updateTokens(tokens: Token[]) {
  const docClient = getDocClient();
  return Promise.all(
    tokens.map(function (token) {
      token.address = token.address.toLowerCase();
      token.lastUpdate = Date.now();
      const params = {
        TableName: 'tokens',
        Item: token,
      };

      return docClient
        .put(params, e => {
          if (e) {
            log(
              `Unable to add token ${
                token.address
              }. Error JSON: ${JSON.stringify(e, null, 2)}`
            );
            captureException(e, { extra: { address: token.address } })
          }
        })
        .promise();
    })
  );
}

export async function createPoolsTable() {
  await createTable(POOLS_TABLE_SCHEMA);
}

export async function updatePoolsTable() {
  const schema = POOLS_TABLE_SCHEMA;
  delete schema.KeySchema;
  await updateTable(schema);
}

export async function createTokensTable() {
  await createTable(TOKENS_TABLE_SCHEMA);
}

export async function updateTokensTable() {
  await updateTable(TOKENS_TABLE_SCHEMA);
}

export async function updateTable(params) {
  const dynamodb = getDynamoDB();
  log('Updating table with params: ', params);
  try {
    await dynamodb.updateTable(params).promise();
  } catch (e) {
    console.error(
      'Unable to update table. Error JSON:',
      JSON.stringify(e, null, 2)
    );
  }
  log('Updated table ', params.TableName);
}

export async function createTable(params) {
  const dynamodb = getDynamoDB();
  log('Creating table with params: ', params);
  try {
    await dynamodb.createTable(params).promise();
  } catch (e) {
    console.error(
      'Unable to create table. Error JSON:',
      JSON.stringify(e, null, 2)
    );
  }
  log('Created table ', params.TableName);
}

export async function deleteTable(name) {
  const dynamodb = getDynamoDB();
  try {
    await dynamodb.deleteTable({ TableName: name }).promise();
  } catch (e) {
    console.error('Unable to delete table ', name, ' error: ', e);
  }
  log('Deleted table ', name);
}
