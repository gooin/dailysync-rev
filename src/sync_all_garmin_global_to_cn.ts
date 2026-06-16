import { BARK_KEY_DEFAULT } from './constant';
import { syncAllGarminGlobal2GarminCN } from './utils/garmin_global';

const axios = require('axios');
const core = require('@actions/core');
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

const main = async () => {
    try {
        await syncAllGarminGlobal2GarminCN();
    } catch (e) {
        axios.get(
            `https://api.day.app/${BARK_KEY}/Garmin Global -> Garmin CN 全量同步数据运行失败了，快去检查！/${e.message}`);
        core.setFailed(e.message);
        throw new Error(e);
    }
};

main();
