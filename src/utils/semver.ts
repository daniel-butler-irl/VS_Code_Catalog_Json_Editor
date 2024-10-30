// src/utils/semver.ts

/**
* Compares two semantic version strings
* @returns Negative if a < b, 0 if equal, positive if a > b
*/
export function compareSemVer(a: string, b: string): number {
    const extractNumbers = (version: string) => {
        return version.replace(/^[\^~><=v]/, '').split(/[\.-]/)[0].split('.').map(num => parseInt(num, 10));
    };

    const partsA = extractNumbers(a);
    const partsB = extractNumbers(b);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] || 0;
        const partB = partsB[i] || 0;
        if (partA !== partB) {
            return partA - partB;
        }
    }
    return 0;
}

/**
* Extracts major version from semver string
*/
export function getMajorVersion(version: string): number {
    return parseInt(version.replace(/^[\^~><=]/, '').split('.')[0], 10);
}

/**
* Extracts minor version from semver string
*/
export function getMinorVersion(version: string): number {
    return parseInt(version.replace(/^[\^~><=]/, '').split('.')[1] || '0', 10);
}