import fs from 'fs';

const loadDotEnv = () => {
    if (!fs.existsSync('.env')) {
        return;
    }

    const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
    lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            return;
        }

        const separatorIndex = trimmedLine.indexOf('=');
        if (separatorIndex === -1) {
            return;
        }

        const name = trimmedLine.slice(0, separatorIndex).trim();
        const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/;$/, '');
        if (!process.env[name]) {
            process.env[name] = value;
        }
    });
};

const printSecret = (name: string, value: Record<string, any>) => {
    console.log(`${name}=${JSON.stringify(value)}`);
};

const exportSessions = async () => {
    loadDotEnv();
    const { getSessionFromDB } = require('./utils/sqlite');
    const cnSession = await getSessionFromDB('CN');
    const globalSession = await getSessionFromDB('GLOBAL');

    if (!cnSession && !globalSession) {
        console.log('No saved Garmin sessions found. Run yarn sync_cn successfully once on a trusted machine first.');
        return;
    }

    if (cnSession) {
        printSecret('GARMIN_CN_OAUTH1', cnSession.oauth1);
        printSecret('GARMIN_CN_OAUTH2', cnSession.oauth2);
    }

    if (globalSession) {
        printSecret('GARMIN_GLOBAL_OAUTH1', globalSession.oauth1);
        printSecret('GARMIN_GLOBAL_OAUTH2', globalSession.oauth2);
    }
};

exportSessions().catch((error) => {
    console.error(error);
    process.exit(1);
});
