import { BARK_KEY_DEFAULT } from './constant';
import { migrateGarminGlobal2GarminCN } from './utils/garmin_global';
import { attachLogFile, MIGRATE_GLOBAL2CN_LOG_NAME } from './utils/migration_logger';

const axios = require('axios');
const core = require('@actions/core');
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

// 迁移日志镜像到 log/ 目录，失败明细单独落 _failed.log
attachLogFile(MIGRATE_GLOBAL2CN_LOG_NAME);

migrateGarminGlobal2GarminCN().catch((e) => {
    axios.get(
        `https://api.day.app/${BARK_KEY}/Garmin CN -> Garmin Global 同步数据运行失败了，快去检查！/${e.message}`).catch(() => {});
    core.setFailed(e.message);
    process.exit(1);
});




