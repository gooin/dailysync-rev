import { BARK_KEY_DEFAULT } from './constant';
import { doRQGoogleSheets } from './utils/runningquotient';

const axios = require('axios');
const core = require('@actions/core');

const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;


try {
    doRQGoogleSheets();
} catch (e) {
    axios.get(
        `https://api.day.app/${BARK_KEY}/同步数据运行失败了，快去检查！/${e.message}`);
    core.setFailed(e.message);
    throw new Error(e);
}




