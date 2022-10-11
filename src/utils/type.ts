const { GarminConnect: GarminConnectCN } = require('@gooin/garmin-connect-cn');
const { GarminConnect: GarminConnectGlobal } = require('@gooin/garmin-connect');

export type GarminClientType = typeof GarminConnectCN | typeof GarminConnectGlobal;
