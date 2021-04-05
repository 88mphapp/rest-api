import { request, gql } from 'graphql-request'
const express = require("express");
import BigNumber from 'bignumber.js';
const fetch = require('node-fetch');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const graphqlEndpoint = 'https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph';
const YEAR_IN_SEC = 31556952;
const MPH_ADDR = '0x8888801aF4d980682e47f1A9036e589479e835C5';

interface PoolInfo {
  name: string;
  address: string;
  stablecoin: string;
  stablecoinSymbol: string;
  stablecoinDecimals: number;
  protocol: string;
  iconPath: string;
  moneyMarket: string;
}

interface CachedPrice {
  price: number;
  lastUpdateTime: number;
}

let tokenPriceCache = [];
const cacheUpdateInterval = 300e3;

const httpsGet = async (apiStr, cacheMaxAge: number = 60) => {
  const request = await fetch(apiStr, { headers: { 'Cache-Control': `max-age=${cacheMaxAge}` } });
  return await request.json();
}

const getTokenPriceUSD = async (address: string): Promise<number> => {
  if (address.toLowerCase() === '0x5B5CFE992AdAC0C9D48E05854B2d91C73a003858'.toLowerCase()) {
    // crvHUSD
    return 1;
  } else if (address.toLowerCase() === '0xb19059ebb43466C323583928285a49f558E572Fd'.toLowerCase()) {
    // crvHBTC
    address = '0x0316EB71485b0Ab14103307bf65a021042c6d380';
  } else if (address.toLowerCase() === '0x2fE94ea3d5d4a175184081439753DE15AeF9d614'.toLowerCase()) {
    // crvOBTC
    address = '0x8064d9Ae6cDf087b1bcd5BDf3531bD5d8C537a68';
  } else if (address.toLowerCase() === '0x06325440D014e39736583c165C2963BA99fAf14E'.toLowerCase()) {
    // CRV:STETH
    address = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  } else if (address.toLowerCase() === '0x49849C98ae39Fff122806C06791Fa73784FB3675'.toLowerCase()) {
    // CRV:RENWBTC
    address = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
  } else if (address.toLowerCase() === '0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3'.toLowerCase()) {
    // CRV:RENWSBTC
    address = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
  }

  const cachedPrice: CachedPrice = tokenPriceCache[address];
  if (cachedPrice && Date.now() <= cachedPrice.lastUpdateTime + cacheUpdateInterval) {
    // use cached price
    return cachedPrice.price;
  }

  const apiStr = `https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}/market_chart/?vs_currency=usd&days=0`;
  const rawResult = await httpsGet(apiStr, 300);
  const price = rawResult.prices[0][1];
  tokenPriceCache[address] = {
    price,
    lastUpdateTime: Date.now()
  } as CachedPrice;
  return price;
}

const getMPHPriceUSD = async (): Promise<BigNumber> => {
  return new BigNumber(await getTokenPriceUSD(MPH_ADDR));
}

const getPoolInfo = (name: string): PoolInfo => {
  return require('./pools.json')[name];
}

const getPoolInfoList = (): PoolInfo[] => {
  return Object.keys(require('./pools.json'))
    .map(pool => getPoolInfo(pool));
}

const getPoolInfoFromAddress = (address: string): PoolInfo => {
  return getPoolInfoList()
    .find(poolInfo => poolInfo.address.toLowerCase() === address.toLowerCase());
}

app.get('/pools', (req, res) => {
  const query = gql`
    {
      dpools {
        id
        address
        stablecoin
        totalActiveDeposit
        oneYearInterestRate
        mphDepositorRewardMintMultiplier
        mphDepositorRewardTakeBackMultiplier
      }
    }
  `;

  request(graphqlEndpoint, query).then(async (data) => {
    const dpools = data.dpools;
    const response = [];
    if (dpools) {
      const mphPriceUSD = await getMPHPriceUSD();
      await Promise.all(dpools.map(async pool => {
        const poolInfo = getPoolInfoFromAddress(pool.address);

        // get MPH APY
        const stablecoinPrice = await getTokenPriceUSD(pool.stablecoin);
        const mphDepositorRewardMintMultiplier = new BigNumber(pool.mphDepositorRewardMintMultiplier);
        const mphDepositorRewardTakeBackMultiplier = new BigNumber(pool.mphDepositorRewardTakeBackMultiplier);
        const tempMPHAPY = mphDepositorRewardMintMultiplier.times(mphPriceUSD).times(YEAR_IN_SEC).div(stablecoinPrice).times(100);
        const mphAPY = tempMPHAPY.times(new BigNumber(1).minus(mphDepositorRewardTakeBackMultiplier));

        const totalValueLockedInToken = new BigNumber(pool.totalActiveDeposit);
        const totalValueLockedInUSD = totalValueLockedInToken.times(stablecoinPrice);

        const poolObj = {
          address: pool.address,
          token: pool.stablecoin,
          tokenSymbol: poolInfo.stablecoinSymbol,
          protocol: poolInfo.protocol,
          oneYearInterestRate: new BigNumber(pool.oneYearInterestRate).times(100).toString(),
          mphAPY: mphAPY.toString(),
          totalValueLockedInToken: totalValueLockedInToken.toString(),
          totalValueLockedInUSD: totalValueLockedInUSD.toString()
        };
        response.push(poolObj);
      }));
    }

    // send response
    res.send(response);
  });
});

// start the Express server
const httpServer = http.createServer(app);

let port = process.env.PORT;
if (port == null || port == "") {
  port = 80;
}
httpServer.listen(port);