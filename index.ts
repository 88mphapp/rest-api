import { request, gql } from 'graphql-request'
const express = require("express");
import BigNumber from 'bignumber.js';
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(express.json());

const graphqlEndpoint = 'https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph';
const YEAR_IN_SEC = 31556952;
const MPH_ADDR = '0x8888801aF4d980682e47f1A9036e589479e835C5';
const CREDENTIALS = {
  key: fs.readFileSync('/etc/letsencrypt/live/api.88mph.app/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/api.88mph.app/fullchain.pem')
};

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

const httpsGet = async (apiStr, cacheMaxAge: number = 60) => {
  const request = await fetch(apiStr, { headers: { 'Cache-Control': `max-age=${cacheMaxAge}` } });
  return await request.json();
}

const getTokenPriceUSD = async (address: string): Promise<number> => {
  const apiStr = `https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}/market_chart/?vs_currency=usd&days=0`;
  const rawResult = await httpsGet(apiStr, 300);
  return rawResult.prices[0][1];
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
        // get MPH APY
        const stablecoinPrice = await getTokenPriceUSD(pool.stablecoin);
        const mphDepositorRewardMintMultiplier = new BigNumber(pool.mphDepositorRewardMintMultiplier);
        const mphDepositorRewardTakeBackMultiplier = new BigNumber(pool.mphDepositorRewardTakeBackMultiplier);
        const tempMPHAPY = mphDepositorRewardMintMultiplier.times(mphPriceUSD).times(YEAR_IN_SEC).div(stablecoinPrice).times(100);
        const mphAPY = tempMPHAPY.times(new BigNumber(1).minus(mphDepositorRewardTakeBackMultiplier));

        const poolInfo = getPoolInfoFromAddress(pool.address);

        const poolObj = {
          address: pool.address,
          stablecoin: pool.stablecoin,
          stablecoinSymbol: poolInfo.stablecoinSymbol,
          protocol: poolInfo.protocol,
          oneYearInterestRate: new BigNumber(pool.oneYearInterestRate).times(100).toString(),
          mphAPY: mphAPY.toString()
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
const httpsServer = https.createServer(CREDENTIALS, app);

httpServer.listen(80);
httpsServer.listen(443);