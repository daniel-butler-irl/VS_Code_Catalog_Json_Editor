// src/services/schemaFetcher.ts
import * as vscode from 'vscode';
import * as https from 'https';

export async function readSchema(): Promise<any> {
  const schemaUrl = 'https://raw.githubusercontent.com/IBM/customized-deployable-architecture/main/ibm_catalog-schema.json';

  return new Promise((resolve, reject) => {
    https
      .get(schemaUrl, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            vscode.window.showErrorMessage('Failed to parse JSON schema.');
            reject(error);
          }
        });
      })
      .on('error', (err) => {
        vscode.window.showErrorMessage('Failed to fetch JSON schema.');
        reject(err);
      });
  });
}
