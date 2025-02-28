// Script to download the latest schema from GitHub and save it to resources/schema.json

const https = require('https');
const fs = require('fs');
const path = require('path');

// Schema URL defined in SchemaService.ts
const SCHEMA_URL = 'https://raw.githubusercontent.com/IBM/customized-deployable-architecture/main/ibm_catalog-schema.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'resources', 'schema.json');

/**
 * Downloads the latest schema from GitHub
 * @returns {Promise<Object>} The schema object
 */
function fetchSchema() {
  return new Promise((resolve, reject) => {
    console.log(`Downloading schema from ${SCHEMA_URL}...`);
    
    const request = https.get(SCHEMA_URL, {
      timeout: 10000 // 10 second timeout
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch schema: ${res.statusCode} ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const schema = JSON.parse(data);
          console.log('Schema fetched successfully!');
          resolve(schema);
        } catch (error) {
          reject(new Error(`Failed to parse schema JSON: ${error.message}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(new Error(`Network error while fetching schema: ${error.message}`));
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Schema fetch request timed out'));
    });
  });
}

/**
 * Ensures the output directory exists
 */
function ensureDirectoryExists() {
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Writes the schema to disk
 * @param {Object} schema The schema to write
 */
function writeSchema(schema) {
  ensureDirectoryExists();
  
  console.log(`Writing schema to ${OUTPUT_PATH}`);
  fs.writeFileSync(
    OUTPUT_PATH, 
    JSON.stringify(schema, null, 2),
    'utf8'
  );
  console.log('Schema saved successfully!');
}

/**
 * Main function to update the schema
 */
async function updateSchema() {
  try {
    const schema = await fetchSchema();
    writeSchema(schema);
    console.log('Schema update complete!');
    process.exit(0);
  } catch (error) {
    console.error(`Error updating schema: ${error.message}`);
    process.exit(1);
  }
}

// Run the update
updateSchema(); 