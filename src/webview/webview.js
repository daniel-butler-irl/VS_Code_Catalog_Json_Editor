// src/webview/webview.js
(function () {
    const vscode = acquireVsCodeApi();
    let jsonData = {};
  
    // Centralized Logging Function
    function logToExtension(level, ...args) {
      vscode.postMessage({
        type: 'log',
        level: level,
        message: args.map(String).join(' '),
      });
    }
  
    // Override console methods to send logs to the extension
    console.log = (...args) => logToExtension('log', ...args);
    console.warn = (...args) => logToExtension('warn', ...args);
    console.error = (...args) => logToExtension('error', ...args);
  
    console.log('Webview script initialized.');
    vscode.postMessage({ type: 'ready' });
  
    window.addEventListener('message', (event) => {
      const message = event.data;
  
        switch (message.type) {
            case 'loadJson':
                console.log('Received loadJson message:', message.json);
                renderJsonTree(message.json, message.schema);
                break;
            case 'saveSuccess':
                console.log('JSON data saved successfully.');
                alert('JSON data saved successfully.');
                break;
            case 'noFileSelected':
                console.log('No file selected message received.');
                showNoFileSelected();
                break;
            case 'loginStatus':
                console.log('Login status:', message.isLoggedIn);
                updateLoginStatus(message.isLoggedIn);
                break;
            case 'offeringsData':
                console.log('Received offerings data:', message.offerings);
                populateOfferings(message.path, message.offerings);
                break;
            case 'fetchOfferingsError':
                console.error('Error fetching offerings:', message.message);
                alert(`Error fetching offerings: ${message.message}`);
                break;
            case 'cacheCleared':
                console.log('Cache cleared successfully.');
                alert('Cache cleared successfully.');
                break;
            case 'clearCacheError':
                console.error('Error clearing cache:', message.message);
                alert(`Error clearing cache: ${message.message}`);
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    });
  
    function updateLoginStatus(isLoggedIn) {
      const statusElement = document.getElementById('login-status');
      if (statusElement) {
        statusElement.textContent = isLoggedIn
          ? 'Logged In'
          : 'Not Logged In';
        statusElement.style.color = isLoggedIn ? 'green' : 'red';
      }
    }
  
    function renderJson(data) {
      const jsonViewer = document.getElementById('json-viewer');
      if (!jsonViewer) {
        console.error('json-viewer element not found.');
        return;
      }
  
      jsonViewer.innerHTML = '';
      const ul = document.createElement('ul');
      ul.className = 'json-tree';
      ul.setAttribute('role', 'tree');
      createTree(data, ul, 'products', 'Products');
      jsonViewer.appendChild(ul);
  
      restoreExpandedNodes();
    }
  

function createTree(obj, parent, path, currentKey) {
    if (Array.isArray(obj) || isObjectLikeArray(obj)) {
        console.log(`array-like object found, should be adding button...`);
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');

        const keyContainer = document.createElement('div');
        keyContainer.className = 'key-container';

        const keySpan = document.createElement('span');
        keySpan.className = 'key collapsible';
        keySpan.textContent = currentKey;
        keySpan.setAttribute('tabindex', '0');
        keySpan.setAttribute('aria-expanded', 'false');

        keyContainer.appendChild(keySpan);

        const addButton = document.createElement('button');
        addButton.textContent = 'Add Element';
        addButton.className = 'add-element-button';
        addButton.setAttribute('data-path', path);
        keyContainer.appendChild(addButton);
        // log button added
        console.log('Add Element button created:', addButton);

        li.appendChild(keyContainer);
        parent.appendChild(li);

        const ul = document.createElement('ul');
        ul.className = 'nested';
        ul.setAttribute('id', `nested-${sanitizePath(path)}`);
        ul.setAttribute('role', 'group');
        li.appendChild(ul);

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                const currentPath = path ? `${path}[${index}]` : `[${index}]`;
                createTree(item, ul, currentPath, index.toString());
            });
        } else if (isObjectLikeArray(obj)) {
            Object.keys(obj)
                .sort((a, b) => Number(a) - Number(b)) // Ensure numeric order
                .forEach(key => {
                    const currentPath = path ? `${path}[${key}]` : `[${key}]`;
                    createTree(obj[key], ul, currentPath, key);
                });
        }

        keySpan.addEventListener('click', () => {
            toggleNodeVisibility(ul, keySpan);
        });

        keySpan.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleNodeVisibility(ul, keySpan);
            }
        });
    } else if (typeof obj === 'object' && obj !== null) {
        // Existing logic for handling regular objects without buttons
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');

        const keyContainer = document.createElement('div');
        keyContainer.className = 'key-container';

        const keySpan = document.createElement('span');
        keySpan.className = 'key collapsible';
        keySpan.textContent = currentKey;
        keySpan.setAttribute('tabindex', '0');
        keySpan.setAttribute('aria-expanded', 'false');

        keyContainer.appendChild(keySpan);

        li.appendChild(keyContainer);
        parent.appendChild(li);

        const ul = document.createElement('ul');
        ul.className = 'nested';
        ul.setAttribute('id', `nested-${sanitizePath(path)}`);
        ul.setAttribute('role', 'group');
        li.appendChild(ul);

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                const currentPath = path ? `${path}.${key}` : key;
                createTree(obj[key], ul, currentPath, key);
            }
        }

        keySpan.addEventListener('click', () => {
            toggleNodeVisibility(ul, keySpan);
        });

        keySpan.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleNodeVisibility(ul, keySpan);
            }
        });
    } else {
        // Existing logic for handling primitive values
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');

        const keyContainer = document.createElement('div');
        keyContainer.className = 'key-container';

        const keySpan = document.createElement('span');
        keySpan.className = 'key';
        keySpan.textContent = currentKey;

        keyContainer.appendChild(keySpan);

        const valueInput = document.createElement('input');
        valueInput.className = 'value';
        valueInput.type = 'text';
        valueInput.value = String(obj);
        valueInput.setAttribute('data-path', path);
        valueInput.setAttribute('aria-label', `Value for ${currentKey}`);

        valueInput.addEventListener('input', (event) => {
            const newValue = event.target.value;
            console.log(`Value changed at path ${path}: ${newValue}`);
            updateJsonData(path, newValue);
            enableSaveButton();
            vscode.postMessage({ type: 'highlightKey', key: path });
        });

        keyContainer.appendChild(valueInput);
        li.appendChild(keyContainer);
        parent.appendChild(li);
    }
}

  
    function toggleNodeVisibility(ul, keySpan) {
      const li = keySpan.closest('li');
      const path = li ? li.getAttribute('data-path') : null;
  
      if (!path) {
        console.warn('Attempted to toggle node without a valid path.');
        return;
      }
  
      if (ul.classList.contains('visible')) {
        ul.classList.remove('visible');
        keySpan.setAttribute('aria-expanded', 'false');
        keySpan.classList.remove('expanded');
        console.log(`Collapsed node at path: ${path}`);
      } else {
        ul.classList.add('visible');
        keySpan.setAttribute('aria-expanded', 'true');
        keySpan.classList.add('expanded');
        console.log(`Expanded node at path: ${path}`);
      }
      updateExpandedNodes();
    }
  
    function sanitizePath(path) {
      return path.replace(/[\[\]\.]/g, '-');
    }
  
    function parsePath(path) {
      const regex = /[^.\[\]]+/g;
      const keys = path.match(regex);
      console.log(`Parsed path '${path}' into keys:`, keys);
      return keys;
    }
  
    function updateJsonData(path, newValue) {
      const keys = parsePath(path);
      let current = jsonData;
      for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] !== undefined) {
          current = current[keys[i]];
        } else {
          console.warn(`Key ${keys[i]} not found.`);
          return;
        }
      }
      const lastKey = keys[keys.length - 1];
      try {
        current[lastKey] = JSON.parse(newValue);
        console.log(
          `Updated path ${path} with parsed JSON value:`,
          current[lastKey]
        );
      } catch {
        current[lastKey] = newValue;
        console.log(
          `Updated path ${path} with string value: ${current[lastKey]}`
        );
      }
      updateExpandedNodes();
    }
  
    function addElementToList(listPath, newValue) {
      const keys = parsePath(listPath);
      let current = jsonData;
  
      for (let key of keys) {
        if (current[key] !== undefined) {
          current = current[key];
        } else {
          console.warn(`Key ${key} not found.`);
          return;
        }
      }
  
      if (Array.isArray(current)) {
        current.push(newValue);
        console.log(`Added new element to ${listPath}: ${newValue}`);
        renderJson(jsonData.products);
        enableSaveButton();
      } else {
        console.warn(`Cannot add element to non-array at ${listPath}`);
      }
    }
  
    function enableSaveButton() {
      const saveButton = document.getElementById('save-button');
      if (saveButton) {
        saveButton.disabled = false;
        console.log('Save button enabled.');
      } else {
        console.error('Save button not found.');
      }
    }
  
    function updateExpandedNodes() {
      const currentExpanded = Array.from(
        document.querySelectorAll('.key.collapsible.expanded')
      ).map((node) =>
        node.closest('li').getAttribute('data-path')
      );
      console.log('Current expanded nodes:', currentExpanded);
      vscode.setState({ expandedNodes: currentExpanded, jsonData });
    }
  
    function restoreExpandedNodes() {
      const state = vscode.getState();
      if (!state || !state.expandedNodes) {
        console.log('No expandedNodes found in state.');
        return;
      }
  
      const savedExpandedNodes = state.expandedNodes;
      console.log('Restoring expanded nodes:', savedExpandedNodes);
      savedExpandedNodes.forEach((path) => {
        if (!path) {
          console.warn(
            'Encountered null or undefined path during restoration.'
          );
          return;
        }
        const keySpan = document.querySelector(
          `[data-path="${path}"] .key`
        );
        if (keySpan) {
          const ul = keySpan.parentElement.nextElementSibling;
          if (ul && !ul.classList.contains('visible')) {
            ul.classList.add('visible');
            keySpan.setAttribute('aria-expanded', 'true');
            keySpan.classList.add('expanded');
            console.log(`Restored expansion for path: ${path}`);
          }
        } else {
          console.warn(`Could not find keySpan for path: ${path}`);
        }
      });
    }
  
    document.addEventListener('click', (event) => {
      if (
        event.target &&
        event.target.classList.contains('add-element-button')
      ) {
        const path = event.target.getAttribute('data-path');
        showAddElementModal(path);
      }
    });
  
    function showAddElementModal(listPath) {
      const modalOverlay = document.getElementById('modal-overlay');
      const elementInput = document.getElementById('element-input');
      const addButton = document.getElementById('modal-add-button');
      const cancelButton = document.getElementById('modal-cancel-button');
  
      modalOverlay.hidden = false;
      elementInput.value = '';
      elementInput.focus();
  
      addButton.onclick = () => {
        const newValue = elementInput.value.trim();
        if (newValue) {
          addElementToList(listPath, newValue);
          closeModal();
        }
      };
  
      cancelButton.onclick = closeModal;
      modalOverlay.onclick = (event) => {
        if (event.target === modalOverlay) {
          closeModal();
        }
      };
  
      function closeModal() {
        modalOverlay.hidden = true;
        addButton.onclick = null;
        cancelButton.onclick = null;
        modalOverlay.onclick = null;
      }
    }
  
    document.getElementById('save-button')?.addEventListener('click', () => {
      console.log('Save button clicked.');
      vscode.postMessage({ type: 'saveJson', json: jsonData });
      const saveButton = document.getElementById('save-button');
      if (saveButton) {
        saveButton.disabled = true;
        console.log('Save button disabled after click.');
      }
    });
  
    function displayNoFileSelected() {
      const jsonViewer = document.getElementById('json-viewer');
      if (!jsonViewer) {
        console.error('json-viewer element not found.');
        return;
      }
  
      jsonViewer.innerHTML = `
        <h1>Invalid File Selected</h1>
        <p>The IBM Catalog JSON Editor only works with the
        <code>ibm_catalog.json</code> file. Please open
        <code>ibm_catalog.json</code> to use this editor.</p>
        <button id="open-file-button">Open ibm_catalog.json</button>
      `;
  
      document
        .getElementById('open-file-button')
        .addEventListener('click', () => {
          vscode.postMessage({ type: 'openIbmCatalog' });
        });
    }
  
    // Restore state when the webview is reloaded
    const previousState = vscode.getState();
    if (previousState && previousState.jsonData) {
      jsonData = previousState.jsonData;
      renderJson(jsonData.products);
    }

    // src/webview/webview.js

/**
 * Determines if an object behaves like an array (i.e., has sequential numeric keys).
 * @param {any} obj - The object to check.
 * @returns {boolean} - True if the object is array-like, false otherwise.
 */
function isObjectLikeArray(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const keys = Object.keys(obj);
    return keys.length > 0 && keys.every(key => /^\d+$/.test(key));
}

/**
 * Populates the offerings combo box for a specific dependency path
 * @param {string} path - The JSON path of the dependency
 * @param {any[]} offerings - Array of offerings
 */
function populateOfferingsCombo(path, offerings) {
  // Find the dependency node based on the path
  const dependencyNode = document.querySelector(`[data-path="${path}"]`);
  if (!dependencyNode) {
    console.warn(`Dependency node not found for path: ${path}`);
    return;
  }

  // Create a container for the combo boxes
  const container = document.createElement('div');
  container.className = 'dependency-controls';

  // Create Name Combo Box
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name: ';
  const nameSelect = document.createElement('select');
  nameSelect.className = 'name-select';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = '-- Select Offering --';
  nameSelect.appendChild(defaultOption);

  offerings.forEach(offering => {
    const option = document.createElement('option');
    option.value = offering.id;
    option.textContent = offering.name;
    nameSelect.appendChild(option);
  });

  nameLabel.appendChild(nameSelect);
  container.appendChild(nameLabel);

  // Create Version Combo Box
  const versionLabel = document.createElement('label');
  versionLabel.textContent = ' Version: ';
  const versionSelect = document.createElement('select');
  versionSelect.className = 'version-select';
  const versionDefaultOption = document.createElement('option');
  versionDefaultOption.value = '';
  versionDefaultOption.textContent = '-- Select Version --';
  versionSelect.appendChild(versionDefaultOption);
  versionSelect.disabled = true; // Disabled until a name is selected
  versionLabel.appendChild(versionSelect);
  container.appendChild(versionLabel);

  // Create Optional Combo Box
  const optionalLabel = document.createElement('label');
  optionalLabel.textContent = ' Optional: ';
  const optionalSelect = document.createElement('select');
  optionalSelect.className = 'optional-select';
  ['true', 'false'].forEach(val => {
    const option = document.createElement('option');
    option.value = val;
    option.textContent = val;
    optionalSelect.appendChild(option);
  });
  optionalLabel.appendChild(optionalSelect);
  container.appendChild(optionalLabel);

  // Append the container to the dependency node
  dependencyNode.appendChild(container);

  // Event Listener for Name Selection
  nameSelect.addEventListener('change', (event) => {
    const selectedOfferingId = event.target.value;
    versionSelect.innerHTML = ''; // Clear previous options
    const versionDefault = document.createElement('option');
    versionDefault.value = '';
    versionDefault.textContent = '-- Select Version --';
    versionSelect.appendChild(versionDefault);

    if (selectedOfferingId) {
      const selectedOffering = offerings.find(off => off.id === selectedOfferingId);
      if (selectedOffering && selectedOffering.versions) {
        selectedOffering.versions.forEach(version => {
          const option = document.createElement('option');
          option.value = version.version_locator;
          option.textContent = version.version;
          versionSelect.appendChild(option);
        });
        versionSelect.disabled = false;
      } else {
        versionSelect.disabled = true;
      }
    } else {
      versionSelect.disabled = true;
    }
  });

  // Event Listener for Version Selection
  versionSelect.addEventListener('change', (event) => {
    const selectedVersionLocator = event.target.value;
    // Update the JSON data based on the selected version
    updateJsonData(`${path}.version`, selectedVersionLocator);
    enableSaveButton();
  });

  // Event Listener for Optional Selection
  optionalSelect.addEventListener('change', (event) => {
    const selectedOptional = event.target.value === 'true';
    updateJsonData(`${path}.optional`, selectedOptional);
    enableSaveButton();
  });
}
  })();
  