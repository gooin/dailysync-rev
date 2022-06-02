import {
    COOKIE,
    CSRF_TOKEN,
    HOST,
    ROUTES,
    USERID,
    G_API_CLIENT_EMAIL,
    G_API_PRIVATE_KEY,
    G_SHEET_ID,
    BARK_KEY,
} from './constant';

const axios = require('axios');
const core = require('@actions/core');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// console.log('testing: >>', process.env);

const RQ_USERID = process.env.RQ_USERID ?? USERID;
const RQ_COOKIE = process.env.RQ_COOKIE ?? COOKIE;
const RQ_CSRF_TOKEN = process.env.RQ_CSRF_TOKEN ?? CSRF_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID ?? G_SHEET_ID;
const GOOGLE_API_CLIENT_EMAIL = process.env.GOOGLE_API_CLIENT_EMAIL ?? G_API_CLIENT_EMAIL;
const GOOGLE_API_PRIVATE_KEY = process.env.GOOGLE_API_PRIVATE_KEY ?? G_API_PRIVATE_KEY;
const BARK_MESSAGE_KEY = process.env.BARK_KEY ?? BARK_KEY;

export async function getOverView() {
    const url = `${HOST}${ROUTES.UPDATE}${RQ_USERID}`;

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
            const rqdata = regexp(res?.data?.data);
            await insertSheet(rqdata);
        } else {
            console.error('ERROR at 0, 检查TOKEN');
            await axios.get(
                `https://api.day.app/${BARK_MESSAGE_KEY}/RQ运行失败了/ERROR检查TOKEN`);
        }
    } catch (e) {
        console.error('ERROR, 检查TOKEN');
        await axios.get(
            `https://api.day.app/${BARK_MESSAGE_KEY}/RQ运行失败了/${e.message}`);
        throw new Error(e);
    }

}

export const regexp = (htmlData) => {

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

    return [
        Date.now(),
        time[1],
        now[1],
        load[1],
        tired[1],
        runLevel[1],
        runLevelDesc[1],
        up[1],
        upValue[1],
    ];

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
        range: '工作表1!A1:I1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [
                // ['日期', '跑力更新时间', '即时跑力', '训练负荷', '疲劳', '跑力', '跑力说明', '趋势1', '趋势2'],
                data,
            ],
        },
    });
    const posts2 = response2.data;
    console.log(posts2);
};

try {
    getOverView();
} catch (e) {
    axios.get(
        `https://api.day.app/${BARK_MESSAGE_KEY}/RQ运行失败了/${e.message}`);
    core.setFailed(e.message);
    throw new Error(e);
}




