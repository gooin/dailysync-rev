type GarminSessionRegion = 'CN' | 'GLOBAL';

export type GarminSessionToken = {
    oauth1: Record<string, any>;
    oauth2: Record<string, any>;
};

const sessionEnvNames: Record<GarminSessionRegion, [string, string]> = {
    CN: ['GARMIN_CN_OAUTH1', 'GARMIN_CN_OAUTH2'],
    GLOBAL: ['GARMIN_GLOBAL_OAUTH1', 'GARMIN_GLOBAL_OAUTH2'],
};

const parseSessionPart = (value: string): Record<string, any> => {
    const trimmedValue = value.trim();
    const jsonValue = trimmedValue.startsWith('base64:')
        ? Buffer.from(trimmedValue.slice('base64:'.length), 'base64').toString('utf8')
        : trimmedValue;
    return JSON.parse(jsonValue);
};

export const getSessionFromEnv = (region: GarminSessionRegion): GarminSessionToken | undefined => {
    const [oauth1EnvName, oauth2EnvName] = sessionEnvNames[region];
    const oauth1Value = process.env[oauth1EnvName];
    const oauth2Value = process.env[oauth2EnvName];

    if (!oauth1Value || !oauth2Value) {
        return undefined;
    }

    try {
        return {
            oauth1: parseSessionPart(oauth1Value),
            oauth2: parseSessionPart(oauth2Value),
        };
    } catch (error) {
        throw new Error(`Garmin ${region} session secrets are not valid JSON: ${oauth1EnvName}, ${oauth2EnvName}`);
    }
};

