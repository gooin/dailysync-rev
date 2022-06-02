import { COOKIE, CSRF_TOKEN, HOST, ROUTES, USERID } from './constant';

const axios = require('axios');

export async function getOverView() {
    const url = `${HOST}${ROUTES.UPDATE}${USERID}`;

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
                'x-csrf-token': CSRF_TOKEN,
                'x-requested-with': 'XMLHttpRequest',
                'cookie': COOKIE,
                'Referer': 'https://www.runningquotient.cn/training/overview',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
            },
        });

        // console.log('getOverView ', res);
        if (res?.data?.data) {
            regexp(res?.data?.data);
        } else {
            console.log('ERROR, 检查TOKEN');
        }
    } catch (e) {
        // console.log(e);
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

};

try {
    getOverView();
} catch (e) {
    throw new Error(e);
}




