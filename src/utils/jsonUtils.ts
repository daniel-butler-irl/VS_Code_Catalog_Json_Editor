// src/utils/jsonUtils.ts
import stripJsonComments from 'strip-json-comments';

export class JsonUtils {
  public static parseJson(jsonString: string): any {
    const jsonStr = stripJsonComments(jsonString);
    return JSON.parse(jsonStr);
  }

  public static stringifyJson(jsonData: any): string {
    return JSON.stringify(jsonData, null, 4);
  }
}
