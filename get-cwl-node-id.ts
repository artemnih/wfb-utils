import { cleanString } from './clean-string';

export function getCwlNodeId(cleanName: string, id: number) {
    const doubleCleanName = cleanString(cleanName);

    if (cleanName !== doubleCleanName) {
        throw new Error(`cleanName "${cleanName}" is not clean`);
    }

    if (isNaN(id)) {
        throw new Error(`id "${id}" is not a number`);
    }

    return `${cleanName}_${id}`;
}
