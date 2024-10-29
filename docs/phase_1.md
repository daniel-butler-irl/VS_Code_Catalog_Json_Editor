### **Phase 1 Documentation: Minimum Viable Product (MVP) for IBM Cloud VS Code Extension**

---

#### **Table of Contents**

1. [Phase 1 Overview](#phase-1-overview)
2. [Project Setup](#project-setup)
   - [Prerequisites](#prerequisites)
   - [Initializing the Extension](#initializing-the-extension)
   - [Project Structure](#project-structure)
3. [Implementing the Tree View](#implementing-the-tree-view)
   - [Parsing `ibm_catalog.json`](#parsing-ibm_catalogjson)
   - [Creating Tree Items](#creating-tree-items)
   - [Rendering the Tree View](#rendering-the-tree-view)
4. [File Watcher Implementation](#file-watcher-implementation)
5. [Editing and Saving Functionality](#editing-and-saving-functionality)
   - [Editing Tree Nodes](#editing-tree-nodes)
   - [Saving Changes to JSON File](#saving-changes-to-json-file)
6. [State Persistence](#state-persistence)
   - [Saving Tree State](#saving-tree-state)
   - [Restoring Tree State](#restoring-tree-state)
7. [Highlighting Corresponding JSON Lines](#highlighting-corresponding-json-lines)
8. [Basic Error Handling](#basic-error-handling)
9. [Sample Code](#sample-code)
   - [Extension Entry Point (`extension.ts`)](#extension-entry-point-extensionts)
   - [Tree Data Provider (`catalogTreeProvider.ts`)](#tree-data-provider-catalogtreeproviderts)
   - [Tree Item (`catalogTreeItem.ts`)](#tree-item-catalogtreeitemts)
   - [File Watcher (`fileWatcher.ts`)](#file-watcher-filewatcherts)
10. [Conclusion](#conclusion)

---

### **Phase 1 Overview**

**Objective:**  
Develop the foundational features of the VS Code extension to render the `ibm_catalog.json` file in a tree view, allow basic editing and saving of JSON values, maintain the state of the tree across sessions, highlight corresponding JSON lines upon selection, and implement basic error handling.

**Key Deliverables:**

1. **Tree View Representation:** Display `ibm_catalog.json` in an expandable/collapsible tree structure.
2. **File Watcher:** Detect external changes to `ibm_catalog.json` and update the tree view accordingly.
3. **Editing and Saving:** Enable in-tree editing of JSON values and save changes back to the file.
4. **State Persistence:** Remember the expanded/collapsed state of tree nodes across sessions.
5. **Highlighting:** Highlight corresponding lines in the JSON editor when a tree node is selected.
6. **Basic Error Handling:** Manage file read/write errors gracefully.

---

### **Project Setup**

#### **Prerequisites**

Ensure that the development environment has the following installed:

- **Node.js (>=14.x):** [Download Node.js](https://nodejs.org/)
- **VS Code:** [Download VS Code](https://code.visualstudio.com/)
- **Yeoman and VS Code Extension Generator:** Install globally using npm.

  ```bash
  npm install -g yo generator-code
  ```

- **Git:** [Download Git](https://git-scm.com/)

#### **Initializing the Extension**

1. **Generate Extension Scaffold:**

   Open a terminal and run:

   ```bash
   yo code
   ```

   **Choose the following options:**

   - **Type of extension:** New Extension (TypeScript)
   - **Extension name:** ibm-catalog-extension
   - **Identifier:** ibm-catalog-extension
   - **Description:** VS Code extension to manage ibm_catalog.json files
   - **Publisher name:** YourPublisherName
   - **License:** MIT
   - **Initialize a git repository:** Yes

2. **Navigate to the Project Directory:**

   ```bash
   cd ibm-catalog-extension
   ```

3. **Install Dependencies:**

   ```bash
   npm install
   ```

4. **Open the Project in VS Code:**

   ```bash
   code .
   ```

#### **Project Structure**

After initialization, the project structure will resemble:

```
ibm-catalog-extension/
├── .vscode/
│   ├── launch.json
│   ├── tasks.json
├── src/
│   ├── extension.ts
│   ├── catalogTreeProvider.ts
│   ├── catalogTreeItem.ts
│   └── fileWatcher.ts
├── package.json
├── tsconfig.json
├── README.md
└── ...
```

---

### **Implementing the Tree View**

#### **Parsing `ibm_catalog.json`**

To render the JSON file in a tree view, we need to parse the JSON and convert it into a hierarchical structure.

**Steps:**

1. **Locate the `ibm_catalog.json` File:**

   - Assume the file is in the workspace root or a known relative path.

2. **Read and Parse the JSON File:**

   Use Node.js's `fs` module to read the file asynchronously.

   ```typescript
   import * as fs from 'fs';
   import * as path from 'path';

   const catalogFilePath = path.join(vscode.workspace.rootPath || '', 'ibm_catalog.json');

   function readCatalogFile(): Promise<any> {
     return new Promise((resolve, reject) => {
       fs.readFile(catalogFilePath, 'utf8', (err, data) => {
         if (err) {
           reject(err);
         } else {
           try {
             const json = JSON.parse(data);
             resolve(json);
           } catch (parseErr) {
             reject(parseErr);
           }
         }
       });
     });
   }
   ```

#### **Creating Tree Items**

Each key-value pair or object in the JSON will correspond to a tree item.

**Approach:**

- **Hierarchy Mapping:** Reflect the JSON structure in the tree view by nesting tree items.
- **Leaf Nodes:** Represent primitive values (strings, numbers, booleans).
- **Parent Nodes:** Represent objects and arrays.

#### **Rendering the Tree View**

Use VS Code’s Tree View API to render the parsed JSON as a tree.

**Implementation:**

1. **Create a Tree Data Provider:**

   Implement the `TreeDataProvider` interface to supply data to the tree view.

   ```typescript
   import * as vscode from 'vscode';
   import { CatalogTreeItem } from './catalogTreeItem';

   export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
     private _onDidChangeTreeData: vscode.EventEmitter<CatalogTreeItem | undefined | void> = new vscode.EventEmitter<CatalogTreeItem | undefined | void>();
     readonly onDidChangeTreeData: vscode.Event<CatalogTreeItem | undefined | void> = this._onDidChangeTreeData.event;

     private data: any;

     constructor(initialData: any) {
       this.data = initialData;
     }

     refresh(): void {
       this._onDidChangeTreeData.fire();
     }

     getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
       return element;
     }

     getChildren(element?: CatalogTreeItem): Thenable<CatalogTreeItem[]> {
       if (!this.data) {
         return Promise.resolve([]);
       }

       if (element) {
         return Promise.resolve(this.getChildrenFromElement(element));
       } else {
         // Root elements
         return Promise.resolve(this.parseObject(this.data, 'ibm_catalog.json'));
       }
     }

     private getChildrenFromElement(element: CatalogTreeItem): CatalogTreeItem[] {
       const value = element.value;
       if (typeof value === 'object' && value !== null) {
         if (Array.isArray(value)) {
           return value.map((item, index) => this.createTreeItem(`[${index}]`, item));
         } else {
           return Object.keys(value).map(key => this.createTreeItem(key, value[key]));
         }
       }
       return [];
     }

     private parseObject(obj: any, key: string): CatalogTreeItem[] {
       return Object.keys(obj).map(key => this.createTreeItem(key, obj[key]));
     }

     private createTreeItem(label: string, value: any): CatalogTreeItem {
       const collapsibleState = (typeof value === 'object' && value !== null) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
       return new CatalogTreeItem(label, collapsibleState, value);
     }
   }
   ```

2. **Define the Tree Item Class:**

   Create a class that extends `vscode.TreeItem` to represent each node.

   ```typescript
   import * as vscode from 'vscode';

   export class CatalogTreeItem extends vscode.TreeItem {
     constructor(
       public readonly label: string,
       public readonly collapsibleState: vscode.TreeItemCollapsibleState,
       public readonly value: any
     ) {
       super(label, collapsibleState);
       this.tooltip = `${this.label}: ${this.value}`;
       this.description = typeof value === 'object' ? '' : `${value}`;
       this.contextValue = typeof value === 'object' ? 'object' : 'value';
     }
   }
   ```

3. **Register the Tree View in `package.json`:**

   ```json
   "contributes": {
     "views": {
       "explorer": [
         {
           "id": "catalogTree",
           "name": "IBM Catalog"
         }
       ]
     }
   }
   ```

4. **Initialize the Tree View in `extension.ts`:**

   ```typescript
   import * as vscode from 'vscode';
   import { CatalogTreeProvider } from './catalogTreeProvider';

   export function activate(context: vscode.ExtensionContext) {
     readCatalogFile().then(data => {
       const treeDataProvider = new CatalogTreeProvider(data);
       vscode.window.createTreeView('catalogTree', { treeDataProvider });

       // Register refresh command if needed
       context.subscriptions.push(
         vscode.commands.registerCommand('catalogTree.refresh', () => treeDataProvider.refresh())
       );
     }).catch(err => {
       vscode.window.showErrorMessage(`Failed to load ibm_catalog.json: ${err.message}`);
     });
   }

   export function deactivate() {}
   ```

---

### **File Watcher Implementation**

To detect external changes to `ibm_catalog.json` and update the tree view accordingly.

**Implementation Steps:**

1. **Create a File Watcher Module (`fileWatcher.ts`):**

   ```typescript
   import * as vscode from 'vscode';
   import * as fs from 'fs';
   import { CatalogTreeProvider } from './catalogTreeProvider';

   export class FileWatcher {
     private watcher: vscode.FileSystemWatcher;
     private treeDataProvider: CatalogTreeProvider;

     constructor(treeDataProvider: CatalogTreeProvider) {
       this.treeDataProvider = treeDataProvider;
       const pattern = new vscode.RelativePattern(vscode.workspace.rootPath || '', '**/ibm_catalog.json');
       this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

       this.watcher.onDidChange(this.onFileChange, this);
       this.watcher.onDidCreate(this.onFileChange, this);
       this.watcher.onDidDelete(this.onFileDelete, this);
     }

     private onFileChange(uri: vscode.Uri) {
       fs.readFile(uri.fsPath, 'utf8', (err, data) => {
         if (err) {
           vscode.window.showErrorMessage(`Error reading ibm_catalog.json: ${err.message}`);
           return;
         }
         try {
           const json = JSON.parse(data);
           this.treeDataProvider['data'] = json;
           this.treeDataProvider.refresh();
         } catch (parseErr) {
           vscode.window.showErrorMessage(`Error parsing ibm_catalog.json: ${parseErr.message}`);
         }
       });
     }

     private onFileDelete(uri: vscode.Uri) {
       vscode.window.showWarningMessage('ibm_catalog.json has been deleted.');
       this.treeDataProvider['data'] = null;
       this.treeDataProvider.refresh();
     }

     dispose() {
       this.watcher.dispose();
     }
   }
   ```

2. **Integrate the File Watcher in `extension.ts`:**

   ```typescript
   import { FileWatcher } from './fileWatcher';

   export function activate(context: vscode.ExtensionContext) {
     readCatalogFile().then(data => {
       const treeDataProvider = new CatalogTreeProvider(data);
       vscode.window.createTreeView('catalogTree', { treeDataProvider });

       const fileWatcher = new FileWatcher(treeDataProvider);
       context.subscriptions.push(fileWatcher);

       // Register refresh command if needed
       context.subscriptions.push(
         vscode.commands.registerCommand('catalogTree.refresh', () => treeDataProvider.refresh())
       );
     }).catch(err => {
       vscode.window.showErrorMessage(`Failed to load ibm_catalog.json: ${err.message}`);
     });
   }
   ```

---

### **Editing and Saving Functionality**

#### **Editing Tree Nodes**

Enable users to edit JSON values directly within the tree view.

**Implementation Steps:**

1. **Make Tree Items Editable:**

   Modify the `CatalogTreeItem` class to indicate which items are editable.

   ```typescript
   export class CatalogTreeItem extends vscode.TreeItem {
     constructor(
       public readonly label: string,
       public readonly collapsibleState: vscode.TreeItemCollapsibleState,
       public readonly value: any
     ) {
       super(label, collapsibleState);
       this.tooltip = `${this.label}: ${this.value}`;
       this.description = typeof value === 'object' ? '' : `${value}`;
       this.contextValue = typeof value === 'object' ? 'object' : 'value';

       if (typeof value !== 'object') {
         this.command = {
           command: 'catalogTree.editItem',
           title: 'Edit Item',
           arguments: [this]
         };
         this.collapsibleState = vscode.TreeItemCollapsibleState.None;
         this.iconPath = vscode.ThemeIcon.File;
       }
     }
   }
   ```

2. **Register the Edit Command in `extension.ts`:**

   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('catalogTree.editItem', (item: CatalogTreeItem) => {
       vscode.window.showInputBox({
         prompt: `Edit value for ${item.label}`,
         value: item.value
       }).then(newValue => {
         if (newValue !== undefined) {
           // Update the JSON data
           updateJsonValue(item, newValue).then(() => {
             // Refresh the tree view
             treeDataProvider.refresh();
           }).catch(err => {
             vscode.window.showErrorMessage(`Failed to update value: ${err.message}`);
           });
         }
       });
     })
   );
   ```

3. **Implement the `updateJsonValue` Function:**

   This function updates the JSON object in memory and writes it back to the file.

   ```typescript
   function updateJsonValue(item: CatalogTreeItem, newValue: string): Promise<void> {
     return new Promise((resolve, reject) => {
       // Read the current JSON data
       fs.readFile(catalogFilePath, 'utf8', (err, data) => {
         if (err) {
           reject(err);
           return;
         }
         try {
           const json = JSON.parse(data);
           // Navigate the JSON object to update the value
           const path = getPathToItem(item, json);
           if (path) {
             let current = json;
             for (let i = 0; i < path.length - 1; i++) {
               current = current[path[i]];
             }
             current[path[path.length - 1]] = newValue;
             // Write back to the file
             fs.writeFile(catalogFilePath, JSON.stringify(json, null, 2), 'utf8', (writeErr) => {
               if (writeErr) {
                 reject(writeErr);
               } else {
                 resolve();
               }
             });
           } else {
             reject(new Error('Path to item not found.'));
           }
         } catch (parseErr) {
           reject(parseErr);
         }
       });
     });
   }

   function getPathToItem(item: CatalogTreeItem, json: any): string[] | null {
     // Implement a method to find the path to the item in the JSON object
     // This can be achieved by traversing the JSON and matching the item's label and value
     // For simplicity, this function returns null. It needs to be properly implemented.
     return null;
   }
   ```

   **Note:**  
   Implementing `getPathToItem` requires traversing the JSON structure to find the path to the specific item. This can be complex depending on the JSON's depth and structure. For the MVP, you may simplify by assuming unique labels or using identifiers.

#### **Saving Changes to JSON File**

Ensure that any changes made through the tree view are persisted back to `ibm_catalog.json`.

**Implementation Steps:**

1. **Ensure Atomic Writes:**

   Use write operations that ensure the file is not left in a corrupt state in case of failures.

2. **Trigger File Watcher on Save:**

   Once the file is written, the file watcher will detect the change and refresh the tree view.

---

### **State Persistence**

Maintain the expanded/collapsed state of tree nodes across sessions using VS Code’s Memento storage.

#### **Saving Tree State**

1. **Store Expanded Nodes:**

   When a node is expanded or collapsed, store its path or identifier.

   ```typescript
   export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
     // ... existing code ...

     constructor(initialData: any, private context: vscode.ExtensionContext) {
       this.data = initialData;
       this.loadTreeState();
     }

     private loadTreeState() {
       const storedState = this.context.globalState.get<string[]>('catalogTreeExpandedNodes', []);
       this.expandedNodes = new Set(storedState);
     }

     refresh(): void {
       this._onDidChangeTreeData.fire();
       this.saveTreeState();
     }

     private saveTreeState() {
       const expanded = Array.from(this.expandedNodes);
       this.context.globalState.update('catalogTreeExpandedNodes', expanded);
     }

     getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
       if (element.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
         this.expandedNodes.add(element.label);
       } else {
         this.expandedNodes.delete(element.label);
       }
       return element;
     }

     // ... rest of the code ...
   }
   ```

2. **Restore Expanded Nodes on Load:**

   Modify the `createTreeItem` method to set the `collapsibleState` based on stored state.

   ```typescript
   private createTreeItem(label: string, value: any): CatalogTreeItem {
     const isExpanded = this.expandedNodes.has(label);
     const collapsibleState = (typeof value === 'object' && value !== null)
       ? (isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
       : vscode.TreeItemCollapsibleState.None;
     return new CatalogTreeItem(label, collapsibleState, value);
   }
   ```

#### **Restoring Tree State**

Upon activation, the tree provider retrieves the stored expanded nodes and applies the state accordingly.

---

### **Highlighting Corresponding JSON Lines**

When a tree node is selected, highlight the corresponding line in the JSON editor.

**Implementation Steps:**

1. **Register Selection Listener:**

   Listen for selection changes in the tree view.

   ```typescript
   vscode.window.onDidChangeTextEditorSelection(event => {
     // Implement logic to highlight tree node based on cursor position
   });
   ```

   However, for our use case, we need to listen for tree view selections.

2. **Register Tree Selection Listener:**

   ```typescript
   const treeView = vscode.window.createTreeView('catalogTree', { treeDataProvider });

   treeView.onDidChangeSelection(selection => {
     const selectedItem = selection.selection[0];
     if (selectedItem) {
       highlightJsonLine(selectedItem);
     }
   });
   ```

3. **Implement `highlightJsonLine`:**

   Use the VS Code API to open the JSON file, find the line number, and highlight it.

   ```typescript
   function highlightJsonLine(item: CatalogTreeItem) {
     vscode.workspace.openTextDocument(catalogFilePath).then(doc => {
       vscode.window.showTextDocument(doc).then(editor => {
         const position = findLinePosition(doc, item);
         if (position) {
           const range = new vscode.Range(position, position);
           editor.selection = new vscode.Selection(position, position);
           editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
           // Optionally, add decoration to highlight the line
           const decorationType = vscode.window.createTextEditorDecorationType({
             backgroundColor: 'rgba(255,255,0,0.3)'
           });
           editor.setDecorations(decorationType, [new vscode.Range(position, position)]);
         }
       });
     }).catch(err => {
       vscode.window.showErrorMessage(`Error opening ibm_catalog.json: ${err.message}`);
     });
   }

   function findLinePosition(doc: vscode.TextDocument, item: CatalogTreeItem): vscode.Position | null {
     // Implement a method to find the line number of the item in the JSON file
     // This can be achieved by searching for the item's key and value in the document
     // For simplicity, this function returns null. It needs to be properly implemented.
     return null;
   }
   ```

   **Note:**  
   Implementing `findLinePosition` accurately requires parsing the JSON file and mapping tree items to their positions in the text. This can be achieved using a JSON parser that tracks line numbers or by using regex-based searches. For the MVP, a simplified approach may be used with the understanding that it may not cover all edge cases.

---

### **Basic Error Handling**

Ensure that the extension handles errors gracefully, providing informative messages to the user without crashing.

**Implementation Steps:**

1. **Try-Catch Blocks:**

   Wrap asynchronous operations with `try-catch` or promise rejection handlers to catch and handle errors.

2. **User Notifications:**

   Use VS Code’s `showErrorMessage` and `showWarningMessage` to inform users of issues.

   ```typescript
   vscode.window.showErrorMessage('An error occurred while reading ibm_catalog.json.');
   ```

3. **Logging:**

   Optionally, log errors to the console for debugging purposes.

   ```typescript
   console.error('Error message:', err);
   ```

4. **Fallback Mechanisms:**

   When critical operations fail (e.g., unable to parse JSON), provide a fallback or disable certain features to maintain stability.

---

### **Sample Code**

Below are sample code snippets for key components in Phase 1.

#### **Extension Entry Point (`extension.ts`)**

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CatalogTreeProvider } from './catalogTreeProvider';
import { FileWatcher } from './fileWatcher';

export function activate(context: vscode.ExtensionContext) {
  const catalogFilePath = path.join(vscode.workspace.rootPath || '', 'ibm_catalog.json');

  function readCatalogFile(): Promise<any> {
    return new Promise((resolve, reject) => {
      fs.readFile(catalogFilePath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (parseErr) {
            reject(parseErr);
          }
        }
      });
    });
  }

  readCatalogFile().then(data => {
    const treeDataProvider = new CatalogTreeProvider(data, context);
    const treeView = vscode.window.createTreeView('catalogTree', { treeDataProvider });

    const fileWatcher = new FileWatcher(treeDataProvider);
    context.subscriptions.push(fileWatcher);

    // Register refresh command
    context.subscriptions.push(
      vscode.commands.registerCommand('catalogTree.refresh', () => treeDataProvider.refresh())
    );

    // Register edit command
    context.subscriptions.push(
      vscode.commands.registerCommand('catalogTree.editItem', (item: any) => {
        vscode.window.showInputBox({
          prompt: `Edit value for ${item.label}`,
          value: item.value
        }).then(newValue => {
          if (newValue !== undefined) {
            updateJsonValue(item, newValue).then(() => {
              treeDataProvider.refresh();
            }).catch(err => {
              vscode.window.showErrorMessage(`Failed to update value: ${err.message}`);
            });
          }
        });
      })
    );

    function updateJsonValue(item: any, newValue: string): Promise<void> {
      return new Promise((resolve, reject) => {
        fs.readFile(catalogFilePath, 'utf8', (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          try {
            const json = JSON.parse(data);
            const path = getPathToItem(item, json);
            if (path) {
              let current = json;
              for (let i = 0; i < path.length - 1; i++) {
                current = current[path[i]];
              }
              current[path[path.length - 1]] = newValue;
              fs.writeFile(catalogFilePath, JSON.stringify(json, null, 2), 'utf8', (writeErr) => {
                if (writeErr) {
                  reject(writeErr);
                } else {
                  resolve();
                }
              });
            } else {
              reject(new Error('Path to item not found.'));
            }
          } catch (parseErr) {
            reject(parseErr);
          }
        });
      });
    }

    function getPathToItem(item: any, json: any): string[] | null {
      // Implement path finding logic
      // Placeholder implementation
      return null;
    }

  }).catch(err => {
    vscode.window.showErrorMessage(`Failed to load ibm_catalog.json: ${err.message}`);
  });
}

export function deactivate() {}
```

#### **Tree Data Provider (`catalogTreeProvider.ts`)**

```typescript
import * as vscode from 'vscode';
import { CatalogTreeItem } from './catalogTreeItem';

export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CatalogTreeItem | undefined | void> = new vscode.EventEmitter<CatalogTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<CatalogTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private data: any;
  private expandedNodes: Set<string> = new Set();

  constructor(initialData: any, private context: vscode.ExtensionContext) {
    this.data = initialData;
    this.loadTreeState();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
    this.saveTreeState();
  }

  getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
    if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
      this.expandedNodes.add(element.label);
    } else if (element.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
      this.expandedNodes.delete(element.label);
    }
    return element;
  }

  getChildren(element?: CatalogTreeItem): Thenable<CatalogTreeItem[]> {
    if (!this.data) {
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve(this.getChildrenFromElement(element));
    } else {
      // Root elements
      return Promise.resolve(this.parseObject(this.data, 'ibm_catalog.json'));
    }
  }

  private getChildrenFromElement(element: CatalogTreeItem): CatalogTreeItem[] {
    const value = element.value;
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item, index) => this.createTreeItem(`[${index}]`, item));
      } else {
        return Object.keys(value).map(key => this.createTreeItem(key, value[key]));
      }
    }
    return [];
  }

  private parseObject(obj: any, key: string): CatalogTreeItem[] {
    return Object.keys(obj).map(key => this.createTreeItem(key, obj[key]));
  }

  private createTreeItem(label: string, value: any): CatalogTreeItem {
    const isExpanded = this.expandedNodes.has(label);
    const collapsibleState = (typeof value === 'object' && value !== null)
      ? (isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    return new CatalogTreeItem(label, collapsibleState, value);
  }

  private loadTreeState() {
    const storedState = this.context.globalState.get<string[]>('catalogTreeExpandedNodes', []);
    this.expandedNodes = new Set(storedState);
  }

  private saveTreeState() {
    const expanded = Array.from(this.expandedNodes);
    this.context.globalState.update('catalogTreeExpandedNodes', expanded);
  }
}
```

#### **Tree Item (`catalogTreeItem.ts`)**

```typescript
import * as vscode from 'vscode';

export class CatalogTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly value: any
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}: ${this.value}`;
    this.description = typeof value === 'object' ? '' : `${value}`;
    this.contextValue = typeof value === 'object' ? 'object' : 'value';

    if (typeof value !== 'object') {
      this.command = {
        command: 'catalogTree.editItem',
        title: 'Edit Item',
        arguments: [this]
      };
      this.iconPath = vscode.ThemeIcon.File;
    } else {
      this.iconPath = vscode.ThemeIcon.Folder;
    }
  }
}
```

#### **File Watcher (`fileWatcher.ts`)**

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import { CatalogTreeProvider } from './catalogTreeProvider';

export class FileWatcher {
  private watcher: vscode.FileSystemWatcher;
  private treeDataProvider: CatalogTreeProvider;

  constructor(treeDataProvider: CatalogTreeProvider) {
    this.treeDataProvider = treeDataProvider;
    const pattern = new vscode.RelativePattern(vscode.workspace.rootPath || '', '**/ibm_catalog.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidChange(this.onFileChange, this);
    this.watcher.onDidCreate(this.onFileChange, this);
    this.watcher.onDidDelete(this.onFileDelete, this);
  }

  private onFileChange(uri: vscode.Uri) {
    fs.readFile(uri.fsPath, 'utf8', (err, data) => {
      if (err) {
        vscode.window.showErrorMessage(`Error reading ibm_catalog.json: ${err.message}`);
        return;
      }
      try {
        const json = JSON.parse(data);
        this.treeDataProvider['data'] = json;
        this.treeDataProvider.refresh();
      } catch (parseErr) {
        vscode.window.showErrorMessage(`Error parsing ibm_catalog.json: ${parseErr.message}`);
      }
    });
  }

  private onFileDelete(uri: vscode.Uri) {
    vscode.window.showWarningMessage('ibm_catalog.json has been deleted.');
    this.treeDataProvider['data'] = null;
    this.treeDataProvider.refresh();
  }

  dispose() {
    this.watcher.dispose();
  }
}
```

---

### **Conclusion**

Phase 1 lays the groundwork for the IBM Cloud VS Code extension by implementing the core functionalities required to visualize and edit the `ibm_catalog.json` file. The developers are provided with detailed instructions, code samples, and implementation steps to ensure a smooth development process. This phase focuses on establishing a robust and user-friendly interface, ensuring that users can interact with the JSON data effectively while maintaining stability and responsiveness.
