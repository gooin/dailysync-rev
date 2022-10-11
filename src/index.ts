import { getGaminCNClient } from './utils/garmin_cn';
import { initDB } from './utils/sqlite';

const { GarminConnect: GarminConnectCN } = require('@gooin/garmin-connect-cn');


const client = getGaminCNClient();


