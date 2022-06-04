import {
    RQ_USERID_DEFAULT,
    RQ_CSRF_TOKEN_DEFAULT,
    RQ_COOKIE_DEFAULT,
    RQ_HOST_DEFAULT,
    RQ_ROUTES_DEFAULT,
    GOOGLE_API_PRIVATE_KEY_DEFAULT,
    GOOGLE_SHEET_ID_DEFAULT,
    GOOGLE_API_CLIENT_EMAIL_DEFAULT,
    BARK_KEY_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
    GARMIN_PASSWORD_DEFAULT, GARMIN_URL_DEFAULT, UA_DEFAULT,
} from './constant';

const axios = require('axios');
const qs = require('qs');
const core = require('@actions/core');
const FormData = require('form-data');
const _ = require('lodash');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const { GarminConnect } = require('@gooin/garmin-connect-cn');

// console.log('testing: >>', process.env);

const RQ_USERID = process.env.RQ_USERID ?? RQ_USERID_DEFAULT;
const RQ_COOKIE = process.env.RQ_COOKIE ?? RQ_COOKIE_DEFAULT;
const RQ_CSRF_TOKEN = process.env.RQ_CSRF_TOKEN ?? RQ_CSRF_TOKEN_DEFAULT;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID ?? GOOGLE_SHEET_ID_DEFAULT;
const GOOGLE_API_CLIENT_EMAIL = process.env.GOOGLE_API_CLIENT_EMAIL ?? GOOGLE_API_CLIENT_EMAIL_DEFAULT;
const GOOGLE_API_PRIVATE_KEY = process.env.GOOGLE_API_PRIVATE_KEY ?? GOOGLE_API_PRIVATE_KEY_DEFAULT;
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;
const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT;

export async function getRQOverView() {
    const url = `${RQ_HOST_DEFAULT}${RQ_ROUTES_DEFAULT.UPDATE}${RQ_USERID}`;

    console.log('url', url);
    try {
        const res = await axios(url, {
            method: 'post',
            headers: {
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'accept-language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7,la;q=0.6,ja;q=0.5',
                'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="102", "Google Chrome";v="102"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-csrf-token': RQ_CSRF_TOKEN,
                'x-requested-with': 'XMLHttpRequest',
                'cookie': RQ_COOKIE,
                'Referer': 'https://www.runningquotient.cn/training/overview',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
            },
        });

        // console.log('getOverView ', res);
        if (res?.data?.data) {
            const rqdata = rqRegexp(res?.data?.data);
            return rqdata;
        } else {
            console.error('ERROR at 0, 检查TOKEN');
            await axios.get(
                `https://api.day.app/${BARK_KEY}/RQ运行失败了/ERROR检查TOKEN`);
            return {};
        }
    } catch (e) {
        console.error('ERROR, 检查TOKEN');
        await axios.get(
            `https://api.day.app/${BARK_KEY}/RQ运行失败了/${e.message}`);
        throw new Error(e);
    }

}

export const rqRegexp = (htmlData) => {
    const { conditionHtml, heartHtml, paceHtml, recordHtml, runlevelHtml } = htmlData;
    // console.log({ resJSON });
    // console.log({ recordHtml });
    const now = /<div class.*data-bit[^>]*>(.*?)<small>/.exec(recordHtml.substr(0, 3000)) as RegExpExecArray;
    const load = /<div class.*data-text[^>]*>(.*?)<small>点/.exec(recordHtml.substr(0, 3000)) as RegExpExecArray;
    const time = /<span class.*data-label[^>]*>(.*?)<\/span>/.exec(recordHtml.substr(0, 3000)) as RegExpExecArray;

    // console.log({ time });
    console.log('即时跑力', Number(now[1]));
    console.log('训练负荷', Number(load[1]));
    console.log('跑力更新时间', time[1]);

    const tired = /<b[^>]*>(.*?)<\/b>/.exec(conditionHtml) as RegExpExecArray;
    console.log('疲劳', tired[1]);

    const runLevel = /<span class.*myrunlevel[^>]*>(.*?)<\/span>/.exec(runlevelHtml) as RegExpExecArray;
    const up = /<font [^>]*>(.*?)<\/font>/.exec(runlevelHtml) as RegExpExecArray;
    const upValue = /<\/font[^>]*>(.*?)<\/small>/.exec(runlevelHtml) as RegExpExecArray;
    const runLevelDesc = /<div class.*col-xs-12 [^>]*>(.*?)<\/div>/.exec(runlevelHtml) as RegExpExecArray;
    console.log('跑力', runLevel[1]);
    console.log('跑力说明', runLevelDesc[1]);
    console.log('趋势', up[1]);
    console.log('趋势', upValue[1]);

    const result = {
        updateAt: Date.now(),
        rqTime: time[1],
        rqLoad: load[1],
        rqTired: tired[1],
        rqRunLevelNow: now[1],
        rqRunLevel: runLevel[1],
        runLevelDesc: runLevelDesc[1],
        rqTrend1: up[1],
        rqTrend2: upValue[1],
    };
    return result;
};

export const insertSheet = async (data) => {
    const client = new JWT({
        email: GOOGLE_API_CLIENT_EMAIL,
        key: GOOGLE_API_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({
        version: 'v4',
        auth: client,
    });
    const response2 = await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: '工作表1!A1:AD',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [
                ['导入时间', '跑力更新时间', '训练负荷', '疲劳', '即时跑力', '跑力', '跑力说明', '趋势1', '趋势2', '活动id', '活动名称', '活动开始时间', '距离', '持续时间', '速度 m/s', '配速 min/km', '配速文字 min/km', '平均心率', '最大心率', '平均每分钟步频', '有氧效果', '无氧效果', '触地时间', '步幅', 'VO2Max', '垂直振幅', '垂直振幅比', '触地平衡', '训练效果', '训练负荷'],
                data,
            ],
        },
    });
    const posts2 = response2.data;
    console.log(posts2);
};

// async function getGarminLoginCSRF() {
//     const preRequestURL = `${GARMIN_URL_DEFAULT.SIGNIN_URL}?${qs.stringify({
//         'cssUrl': GARMIN_URL_DEFAULT.CSS_URL,
//     })}`;
//     console.log('preRequestURL', preRequestURL);
//     const res = await axios({
//         url: preRequestURL,
//         method: 'GET',
//         headers: {
//             // 'referer': GARMIN_URL_DEFAULT.BASE_URL + '/en-US/signin',
//             'referer': GARMIN_URL_DEFAULT.SIGNIN_URL,
//         },
//     });
//     // console.log('res', res);
//     const csrf = (/name="_csrf" value="(\w*)"/.exec(res.data) as RegExpExecArray)[1];
//     console.log('csrf found: ', csrf);
//     // console.log('referer found: ', res.url);
//     return csrf;
// }

export const getGarminStatistics = async () => {
    const GCClient = new GarminConnect();
// Uses credentials from garmin.config.json or uses supplied params
    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
    const userInfo = await GCClient.getUserInfo();
    // console.log('userInfo', userInfo);

    // Get a list of default length with most recent activities
    const acts = await GCClient.getActivities(0, 10);
    // console.log('acts', acts);
    const recentRunningAct = _.filter(acts, { activityType: { typeKey: 'running' } })[0];
    // console.log('recentRunningAct', recentRunningAct);

    const {
        activityId, // 活动id
        activityName, // 活动名称
        startTimeLocal, // 活动开始时间
        distance, // 距离
        duration, // 时间
        averageSpeed, // 平均速度 m/s
        averageHR, // 平均心率
        maxHR, // 最大心率
        averageRunningCadenceInStepsPerMinute, // 平均每分钟步频
        aerobicTrainingEffect, // 有氧效果
        anaerobicTrainingEffect, // 无氧效果
        avgGroundContactTime, // 触地时间
        avgStrideLength, // 步幅
        vO2MaxValue, // VO2Max
        avgVerticalOscillation, // 垂直振幅
        avgVerticalRatio, // 垂直振幅比
        avgGroundContactBalance, // 触地平衡
        trainingEffectLabel, // 训练效果
        activityTrainingLoad, // 训练负荷
    } = recentRunningAct;

    const pace = 1 / (averageSpeed / 1000 * 60);
    const pace_min = Math.floor(1 / (averageSpeed / 1000 * 60));
    const pace_second = (pace - pace_min) * 60;
    // console.log('pace', pace);
    // console.log('pace_min', pace_min);
    // console.log('pace_second', pace_second);

    return {
        activityId, // 活动id
        activityName, // 活动名称
        startTimeLocal, // 活动开始时间
        distance, // 距离
        duration, // 持续时间
        // averageSpeed 是 m/s
        averageSpeed, // 速度
        averagePace: pace,  // min/km
        averagePaceText: `${pace_min}:${pace_second.toFixed(0)}`,  // min/km
        averageHR, // 平均心率
        maxHR, // 最大心率
        averageRunningCadenceInStepsPerMinute, // 平均每分钟步频
        aerobicTrainingEffect, // 有氧效果
        anaerobicTrainingEffect, // 无氧效果
        avgGroundContactTime, // 触地时间
        avgStrideLength, // 步幅
        vO2MaxValue, // 最大摄氧量
        avgVerticalOscillation, // 垂直振幅
        avgVerticalRatio, // 垂直振幅比
        avgGroundContactBalance, // 触地平衡
        trainingEffectLabel, // 训练效果
        activityTrainingLoad, // 训练负荷
    };
    // const detail = await GCClient.getActivity(recentRunningAct);
    // console.log('detail', detail);
};

export const run = async () => {
    const rqResult = await getRQOverView();
    const garminStatistics = await getGarminStatistics();
    // console.log('garminStatistics', garminStatistics);
    const data = _.assign(rqResult, garminStatistics);

    console.log('update all data', data);

    const finalResult = _.values(data);
    // console.log('finalResult', finalResult);

    await insertSheet(finalResult);
};

try {
    run();
} catch (e) {
    axios.get(
        `https://api.day.app/${BARK_KEY}/RQ运行失败了/${e.message}`);
    core.setFailed(e.message);
    throw new Error(e);
}




