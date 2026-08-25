import { getGaminGlobalClient } from './garmin_global';
import {
    AESKEY_DEFAULT,
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
    GARMIN_PASSWORD_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
    GARMIN_SYNC_NUM_DEFAULT
} from '../constant';
import { downloadGarminActivity, printMigrationProgress, uploadGarminActivity } from './garmin_common';
import { logMigrationFailure, MIGRATE_CN2GLOBAL_LOG_NAME } from './migration_logger';
import { GarminClientType } from './type';
import { number2capital, toSafeInt } from './number_tricks';
const core = require('@actions/core');
import _ from 'lodash';
import { getSessionFromDB, getSyncCursor, initDB, saveSessionToDB, setSyncCursor, updateSessionToDB } from './sqlite';
import { getSessionFromEnv } from './garmin_session_env';
import { migrateGarminWellnessByDateRange, syncGarminWellnessRecentDays } from './garmin_wellness';

const CryptoJS = require('crypto-js');
const fs = require('fs');

const { GarminConnect } = require('@gooin/garmin-connect');

const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;
const GARMIN_SYNC_NUM = process.env.GARMIN_SYNC_NUM ?? GARMIN_SYNC_NUM_DEFAULT;
// 自动翻页开关：GARMIN_MIGRATE_AUTO_PAGE=0 时只跑一批（从 GARMIN_MIGRATE_START 开始、数量 GARMIN_MIGRATE_NUM），方便调试
const AUTO_PAGE_ENABLED = !['0', 'false', 'off'].includes(String(process.env.GARMIN_MIGRATE_AUTO_PAGE ?? '').toLowerCase());

export const getGaminCNClient = async (): Promise<GarminClientType> => {
    if (_.isEmpty(GARMIN_USERNAME) || _.isEmpty(GARMIN_PASSWORD)) {
        const errMsg = '请填写中国区用户名及密码：GARMIN_USERNAME,GARMIN_PASSWORD';
        core.setFailed(errMsg);
        return Promise.reject(errMsg);
    }

    const GCClient = new GarminConnect({username: GARMIN_USERNAME, password: GARMIN_PASSWORD}, 'garmin.cn');

    try {
        await initDB();

        const envSession = getSessionFromEnv('CN');
        if (envSession) {
            console.log('GarminCN: login by env session');
            await GCClient.loadToken(envSession.oauth1, envSession.oauth2);
            const currentSession = await getSessionFromDB('CN');
            if (currentSession) {
                await updateSessionToDB('CN', GCClient.exportToken());
            } else {
                await saveSessionToDB('CN', GCClient.exportToken());
            }
        } else {
            const currentSession = await getSessionFromDB('CN');
            if (!currentSession) {
                await GCClient.login();
                await saveSessionToDB('CN', GCClient.exportToken());
            } else {
                //  Wrap error message in GCClient, prevent terminate in github actions.
                try {
                    console.log('GarminCN: login by saved session');
                    await GCClient.loadToken(currentSession.oauth1, currentSession.oauth2);
                } catch (e) {
                    console.log('Warn: renew  GarminCN Session..');
                    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
                    await updateSessionToDB('CN', GCClient.exportToken());
                }

            }
        }

        const userInfo = await GCClient.getUserProfile();
        const { fullName, userName: emailAddress, location } = userInfo;
        if (!fullName) {
            throw Error('佳明中国区登录失败')
        }
        console.log('Garmin userInfo CN: ', { fullName, emailAddress, location });

        return GCClient;
    } catch (err) {
        console.error(err);
        core.setFailed(err);
    }
};

export const migrateGarminCNActivities2GarminGlobal = async (
    clientCN: GarminClientType,
    clientGlobal: GarminClientType,
    count = 200,
) => {
    // GARMIN_MIGRATE_NUM 作为每页条数，GARMIN_MIGRATE_START 作为起始偏移
    const batchSize = toSafeInt(GARMIN_MIGRATE_NUM, count);
    const startOffset = toSafeInt(GARMIN_MIGRATE_START, 0);

    if (!clientCN || !clientGlobal) {
        throw new Error('佳明登录失败，无法开始迁移');
    }


    // 先拉一次全量列表拿总数用于进度展示（该接口对 limit 不截断，999 足够大）
    const totalActs = await clientCN.getActivities(startOffset, 999);
    const totalCount = totalActs?.length ?? 0;
    if (totalCount === 0) {
        console.log('国区没有待迁移的活动');
        return;
    }
    // 预先拉取国际区已有活动用于快速查重：重复的直接跳过，不再下载+上传（全量重复时整个校验只需几秒）
    // 查重键用 开始时间|取整时长：两侧 activityName 语言不同（CN 中文 / Global 英文），不能拿活动名比对
    const globalExisting = await clientGlobal.getActivities(0, 999);
    const existingKeys = new Set<string>((globalExisting ?? []).map((a: any) => `${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`));
    const preDupCount = totalActs.filter((a: any) => existingKeys.has(`${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`)).length;
    const modeNote = AUTO_PAGE_ENABLED ? '' : `（单批调试模式：仅处理从 ${startOffset} 起的 ${batchSize} 条）`;
    console.log(`国区待迁移活动共 ${totalCount} 条，其中重复跳过 ${preDupCount} 条，需上传 ${totalCount - preDupCount} 条，预计耗时 ${Math.round(((totalCount - preDupCount) * 4) / 60)}~${Math.round(((totalCount - preDupCount) * 6) / 60)} 分钟${modeNote}`);

    let pageIndex = startOffset;
    let processedTotal = 0;
    let uploadedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    // 防止接口异常时死循环：自动翻页最多 500 页；关闭自动翻页时只跑一批
    const MAX_PAGES = AUTO_PAGE_ENABLED ? 500 : 1;
    for (let page = 0; page < MAX_PAGES; page++) {
        const actSlices = await clientCN.getActivities(pageIndex, batchSize);
        if (!actSlices || actSlices.length === 0) {
            break;
        }

        for (let j = 0; j < actSlices.length; j++) {
            const act = actSlices[j];
            const actKey = `${act.startTimeLocal}|${Math.round(act.duration ?? 0)}`;
            if (existingKeys.has(actKey)) {
                // 国际区已存在同时间+同时长的活动，直接跳过（不下载不上传）
                processedTotal++;
                duplicateCount++;
                printMigrationProgress(processedTotal, totalCount, act, 'duplicate');
                continue;
            }
            // 下载佳明原始数据
            const filePath = await downloadGarminActivity(act.activityId, clientCN);
            // 上传到佳明国际区
            const { status, error } = await uploadGarminActivity(filePath, clientGlobal);
            processedTotal++;
            if (status === 'uploaded') {
                uploadedCount++;
                existingKeys.add(actKey); // 本次上传成功，纳入查重集合，避免源列表内重复条目二次上传
            } else if (status === 'duplicate') {
                duplicateCount++;
            } else {
                failedCount++;
                logMigrationFailure(MIGRATE_CN2GLOBAL_LOG_NAME, `上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 文件: ${filePath} 错误: ${error?.message ?? error}`);
                // 非 TTY 模式进度条静默，失败条目单独打印保证可见
                console.log(`上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 错误: ${error?.message ?? error}`);
            }
            printMigrationProgress(processedTotal, totalCount, act, status, j === actSlices.length - 1);
        }

        pageIndex += actSlices.length;
        // 取到的数量不足一页，说明已到最早一条活动
        if (actSlices.length < batchSize) {
            break;
        }
    }
    console.log(`迁移结束：共处理 ${processedTotal} 条（成功 ${uploadedCount}，重复跳过 ${duplicateCount}，失败 ${failedCount}），失败明细见 log/${MIGRATE_CN2GLOBAL_LOG_NAME}_*_failed.log`);
};

export const migrateGarminCN2GarminGlobal = async (count = 200) => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await migrateGarminCNActivities2GarminGlobal(clientCN, clientGlobal, count);
};

export const migrateAllGarminCN2GarminGlobal = async (count = 200) => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await migrateGarminCNActivities2GarminGlobal(clientCN, clientGlobal, count);
    await migrateGarminWellnessByDateRange(clientCN, clientGlobal);
};

export const syncGarminCNActivities2GarminGlobal = async (
    clientCN: GarminClientType,
    clientGlobal: GarminClientType,
) => {
    // 增量同步游标：上次成功同步到的国区活动开始时间（存于 db/garmin.db）；
    // 无游标（首次运行）时以目标端最新活动为基准；之后从游标位置翻页取新增活动，不再有"只检查最近 N 条"的限制
    const cursor = await getSyncCursor('CN2GLOBAL');
    const latestSyncedStartTime = cursor?.lastSyncStartTime
        ?? (await clientGlobal.getActivities(0, 1))[0]?.startTimeLocal
        ?? '0';
    if (!cursor?.lastSyncStartTime) {
        console.log(`首次同步，基准为目标端最新活动开始时间: 【 ${latestSyncedStartTime} 】`);
    }

    // GARMIN_SYNC_NUM 作为每页条数；自动翻页直到游标位置，一次新增任意多条都不会漏同步
    const batchSize = toSafeInt(GARMIN_SYNC_NUM, 10);
    let pageIndex = 0;
    let actualNewActivityCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    let lastProcessedStartTime: string | undefined;
    let latestSourceAct: any;
    // 防止接口异常时死循环：最多 500 页
    outer:
    for (let page = 0; page < 500; page++) {
        const cnActs = await clientCN.getActivities(pageIndex, batchSize);
        if (!cnActs || cnActs.length === 0) {
            break;
        }
        if (!latestSourceAct) {
            latestSourceAct = cnActs[0]; // 列表按时间倒序，第一页第一条即最新活动
        }
        // 页内最旧一条已 <= 游标：更早的活动都已同步过，不用再取下一页
        const reachedCursor = (cnActs[cnActs.length - 1]?.startTimeLocal ?? '0') <= latestSyncedStartTime;
        // fix: #18 —— 列表按时间倒序，翻回正序从旧到新上传
        _.reverse(cnActs);
        for (const cnAct of cnActs) {
            if (cnAct.startTimeLocal <= latestSyncedStartTime) {
                // 页内混合了已同步过的旧活动，跳过
                continue;
            }
            // 下载佳明原始数据
            const filePath = await downloadGarminActivity(cnAct.activityId, clientCN);
            // 上传到佳明国际区
            console.log(`本次开始向国际区上传第 ${number2capital(actualNewActivityCount + 1)} 条数据，【 ${cnAct.activityName} 】，开始于 【 ${cnAct.startTimeLocal} 】，活动ID: 【 ${cnAct.activityId} 】`);
            const { status } = await uploadGarminActivity(filePath, clientGlobal);
            if (status === 'uploaded') {
                actualNewActivityCount++;
                // 正序处理（旧→新），最后一条非失败即本批最新，作为新的同步游标
                lastProcessedStartTime = cnAct.startTimeLocal;
            } else if (status === 'duplicate') {
                duplicateCount++;
                // 目标端已有同时间+同时长的活动，视为已同步
                lastProcessedStartTime = cnAct.startTimeLocal;
            } else {
                failedCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        pageIndex += cnActs.length;
        if (reachedCursor || cnActs.length < batchSize) {
            break;
        }
    }

    if (failedCount === 0 && lastProcessedStartTime) {
        await setSyncCursor('CN2GLOBAL', lastProcessedStartTime);
        console.log(`同步完成：新增 ${actualNewActivityCount} 条（重复 ${duplicateCount} 条），已记录同步游标 【 ${lastProcessedStartTime} 】`);
    } else if (failedCount === 0) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${latestSourceAct?.activityName ?? '未知'} 】, 开始于: 【 ${latestSourceAct?.startTimeLocal ?? '-'} 】`);
    } else {
        console.log(`同步结束：新增 ${actualNewActivityCount} 条，重复 ${duplicateCount} 条，失败 ${failedCount} 条；存在失败，同步游标未推进，下次同步将重试失败条目`);
    }
};

export const syncGarminCN2GarminGlobal = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await syncGarminCNActivities2GarminGlobal(clientCN, clientGlobal);
};

export const syncAllGarminCN2GarminGlobal = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    await syncGarminCNActivities2GarminGlobal(clientCN, clientGlobal);
    await syncGarminWellnessRecentDays(clientCN, clientGlobal);
};
