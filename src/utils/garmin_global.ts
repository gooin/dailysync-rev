import {
    GARMIN_GLOBAL_PASSWORD_DEFAULT,
    GARMIN_GLOBAL_USERNAME_DEFAULT,
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT, GARMIN_SYNC_NUM_DEFAULT,
} from '../constant';
import { getGaminCNClient } from './garmin_cn';
import { GarminClientType } from './type';
import { downloadGarminActivity, printMigrationProgress, uploadGarminActivity } from './garmin_common';
import { logMigrationFailure, MIGRATE_GLOBAL2CN_LOG_NAME } from './migration_logger';
import { number2capital, toSafeInt } from './number_tricks';
const core = require('@actions/core');
import _ from 'lodash';
import { getSessionFromDB, initDB, saveSessionToDB, updateSessionToDB } from './sqlite';
import { getSessionFromEnv } from './garmin_session_env';
import { migrateGarminWellnessByDateRange, syncGarminWellnessRecentDays } from './garmin_wellness';

const { GarminConnect } = require('@gooin/garmin-connect');

const GARMIN_GLOBAL_USERNAME = process.env.GARMIN_GLOBAL_USERNAME ?? GARMIN_GLOBAL_USERNAME_DEFAULT;
const GARMIN_GLOBAL_PASSWORD = process.env.GARMIN_GLOBAL_PASSWORD ?? GARMIN_GLOBAL_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;
const GARMIN_SYNC_NUM = process.env.GARMIN_SYNC_NUM ?? GARMIN_SYNC_NUM_DEFAULT;
// 自动翻页开关：GARMIN_MIGRATE_AUTO_PAGE=0 时只跑一批（从 GARMIN_MIGRATE_START 开始、数量 GARMIN_MIGRATE_NUM），方便调试
const AUTO_PAGE_ENABLED = !['0', 'false', 'off'].includes(String(process.env.GARMIN_MIGRATE_AUTO_PAGE ?? '').toLowerCase());

export const getGaminGlobalClient = async (): Promise<GarminClientType> => {
    if (_.isEmpty(GARMIN_GLOBAL_USERNAME) || _.isEmpty(GARMIN_GLOBAL_PASSWORD)) {
        const errMsg = '请填写国际区用户名及密码：GARMIN_GLOBAL_USERNAME,GARMIN_GLOBAL_PASSWORD';
        core.setFailed(errMsg);
        return Promise.reject(errMsg);
    }

    const GCClient = new GarminConnect({username: GARMIN_GLOBAL_USERNAME, password: GARMIN_GLOBAL_PASSWORD});

    try {
        await initDB();

        const envSession = getSessionFromEnv('GLOBAL');
        if (envSession) {
            console.log('GarminGlobal: login by env session');
            await GCClient.loadToken(envSession.oauth1, envSession.oauth2);
            const currentSession = await getSessionFromDB('GLOBAL');
            if (currentSession) {
                await updateSessionToDB('GLOBAL', GCClient.exportToken());
            } else {
                await saveSessionToDB('GLOBAL', GCClient.exportToken());
            }
        } else {
            const currentSession = await getSessionFromDB('GLOBAL');
            if (!currentSession) {
                await GCClient.login();
                await saveSessionToDB('GLOBAL', GCClient.exportToken());
            } else {
                //  Wrap error message in GCClient, prevent terminate in github actions.
                try {
                    console.log('GarminGlobal: login by saved session');
                    await GCClient.loadToken(currentSession.oauth1, currentSession.oauth2);
                } catch (e) {
                    // 只在登录默认session登录失败，catch到登录错误，需要重新登录时注册sessionChange事件
                    console.log('Warn: renew GarminGlobal session..');
                    await GCClient.login(GARMIN_GLOBAL_USERNAME, GARMIN_GLOBAL_PASSWORD);
                    await updateSessionToDB('GLOBAL', GCClient.exportToken());

                }

            }
        }
        const userInfo = await GCClient.getUserProfile();
        const { fullName, userName: emailAddress, location } = userInfo;
        if (!emailAddress) {
            throw Error('佳明国际区登录失败，请检查填入的账号密码或您的网络环境')
        }
        console.log('Garmin userInfo global', { fullName, emailAddress, location });
        return GCClient;
    } catch (err) {
        console.error(err);
        core.setFailed(err);
    }
};

export const migrateGarminGlobalActivities2GarminCN = async (
    clientGlobal: GarminClientType,
    clientCn: GarminClientType,
    count = 200,
) => {
    // GARMIN_MIGRATE_NUM 作为每页条数，GARMIN_MIGRATE_START 作为起始偏移
    const batchSize = toSafeInt(GARMIN_MIGRATE_NUM, count);
    const startOffset = toSafeInt(GARMIN_MIGRATE_START, 0);

    if (!clientGlobal || !clientCn) {
        throw new Error('佳明登录失败，无法开始迁移');
    }


    // 先拉一次全量列表拿总数用于进度展示（该接口对 limit 不截断，999 足够大）
    const totalActs = await clientGlobal.getActivities(startOffset, 999);
    const totalCount = totalActs?.length ?? 0;
    if (totalCount === 0) {
        console.log('国际区没有待迁移的活动');
        return;
    }
    // 预先拉取国区已有活动用于快速查重：重复的直接跳过，不再下载+上传（全量重复时整个校验只需几秒）
    // 查重键用 开始时间|取整时长：两侧 activityName 语言不同（CN 中文 / Global 英文），不能拿活动名比对
    const cnExisting = await clientCn.getActivities(0, 999);
    const existingKeys = new Set<string>((cnExisting ?? []).map((a: any) => `${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`));
    const preDupCount = totalActs.filter((a: any) => existingKeys.has(`${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`)).length;
    const modeNote = AUTO_PAGE_ENABLED ? '' : `（单批调试模式：仅处理从 ${startOffset} 起的 ${batchSize} 条）`;
    console.log(`国际区待迁移活动共 ${totalCount} 条，其中重复跳过 ${preDupCount} 条，需上传 ${totalCount - preDupCount} 条，预计耗时 ${Math.round(((totalCount - preDupCount) * 4) / 60)}~${Math.round(((totalCount - preDupCount) * 6) / 60)} 分钟${modeNote}`);

    let pageIndex = startOffset;
    let processedTotal = 0;
    let uploadedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    // 防止接口异常时死循环：自动翻页最多 500 页；关闭自动翻页时只跑一批
    const MAX_PAGES = AUTO_PAGE_ENABLED ? 500 : 1;
    for (let page = 0; page < MAX_PAGES; page++) {
        // 从佳明国际区读取活动数据
        const actSlices = await clientGlobal.getActivities(pageIndex, batchSize);
        if (!actSlices || actSlices.length === 0) {
            break;
        }

        for (let j = 0; j < actSlices.length; j++) {
            const act = actSlices[j];
            const actKey = `${act.startTimeLocal}|${Math.round(act.duration ?? 0)}`;
            if (existingKeys.has(actKey)) {
                // 国区已存在同时间+同时长的活动，直接跳过（不下载不上传）
                processedTotal++;
                duplicateCount++;
                printMigrationProgress(processedTotal, totalCount, act, 'duplicate');
                continue;
            }
            // 下载佳明原始数据
            const filePath = await downloadGarminActivity(act.activityId, clientGlobal);
            // 上传到佳明中国区
            const { status, error } = await uploadGarminActivity(filePath, clientCn);
            processedTotal++;
            if (status === 'uploaded') {
                uploadedCount++;
                existingKeys.add(actKey); // 本次上传成功，纳入查重集合，避免源列表内重复条目二次上传
            } else if (status === 'duplicate') {
                duplicateCount++;
            } else {
                failedCount++;
                logMigrationFailure(MIGRATE_GLOBAL2CN_LOG_NAME, `上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 文件: ${filePath} 错误: ${error?.message ?? error}`);
                // 非 TTY 模式进度条静默，失败条目单独打印保证可见
                console.log(`上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 错误: ${error?.message ?? error}`);
            }
            printMigrationProgress(processedTotal, totalCount, act, status, j === actSlices.length - 1);
            // 等待2秒，避免API请求太过频繁
            // await new Promise(resolve => setTimeout(resolve, 2000));
        }

        pageIndex += actSlices.length;
        // 取到的数量不足一页，说明已到最早一条活动
        if (actSlices.length < batchSize) {
            break;
        }
    }
    console.log(`迁移结束：共处理 ${processedTotal} 条（成功 ${uploadedCount}，重复跳过 ${duplicateCount}，失败 ${failedCount}），失败明细见 log/${MIGRATE_GLOBAL2CN_LOG_NAME}_*_failed.log`);
};

export const migrateGarminGlobal2GarminCN = async (count = 200) => {
    const clientGlobal = await getGaminGlobalClient();
    const clientCn = await getGaminCNClient();

    await migrateGarminGlobalActivities2GarminCN(clientGlobal, clientCn, count);
};

export const migrateAllGarminGlobal2GarminCN = async (count = 200) => {
    const clientGlobal = await getGaminGlobalClient();
    const clientCn = await getGaminCNClient();

    await migrateGarminGlobalActivities2GarminCN(clientGlobal, clientCn, count);
    await migrateGarminWellnessByDateRange(clientGlobal, clientCn);
};

export const syncGarminGlobalActivities2GarminCN = async (
    clientGlobal: GarminClientType,
    clientCN: GarminClientType,
) => {
    const cnActs = await clientCN.getActivities(0, 1);
    let globalActs = await clientGlobal.getActivities(0, Number(GARMIN_SYNC_NUM));

    const latestGlobalActStartTime = globalActs[0]?.startTimeLocal ?? '0';
    const latestCnActStartTime = cnActs[0]?.startTimeLocal ?? '0';

    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${globalActs[0]?.activityName} 】, 开始于: 【 ${latestGlobalActStartTime} 】`);
    } else {
        // fix: #18
        _.reverse(globalActs);
        let actualNewActivityCount = 1;
        for (let i = 0; i < globalActs.length; i++) {
            const globalAct = globalActs[i];
            if (globalAct.startTimeLocal > latestCnActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(globalAct.activityId, clientGlobal);
                // 上传到佳明中国区的
                console.log(`本次开始向中国区上传第 ${number2capital(actualNewActivityCount)} 条数据，【 ${globalAct.activityName} 】，开始于 【 ${globalAct.startTimeLocal} 】，活动ID: 【 ${globalAct.activityId} 】`);
                await uploadGarminActivity(filePath, clientCN);
                await new Promise(resolve => setTimeout(resolve, 1000));
                actualNewActivityCount++;
            }
        }
    }
};

export const syncGarminGlobal2GarminCN = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await syncGarminGlobalActivities2GarminCN(clientGlobal, clientCN);
};

export const syncAllGarminGlobal2GarminCN = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await syncGarminGlobalActivities2GarminCN(clientGlobal, clientCN);
    await syncGarminWellnessRecentDays(clientGlobal, clientCN);
};
