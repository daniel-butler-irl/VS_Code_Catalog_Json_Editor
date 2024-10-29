### **Design Document and Implementation Plan for IBM Cloud VS Code Extension**

---

#### **Table of Contents**

1. [Project Overview](#project-overview)
2. [Key Features](#key-features)
3. [Architecture](#architecture)
4. [Technologies and Tools](#technologies-and-tools)
5. [Implementation Plan](#implementation-plan)
   - [Phase 1: Minimum Viable Product (MVP)](#phase-1-minimum-viable-product-mvp)
   - [Phase 2: Enhanced Functionality](#phase-2-enhanced-functionality)
   - [Phase 3: Advanced Features and Extensibility](#phase-3-advanced-features-and-extensibility)
6. [Handling Schema and Dynamic Features](#handling-schema-and-dynamic-features)
7. [Validation and IBM Cloud Integration](#validation-and-ibm-cloud-integration)
8. [State Management and Persistence](#state-management-and-persistence)
9. [User Experience Considerations](#user-experience-considerations)
10. [Caching Strategy](#caching-strategy)
11. [Error Handling and Offline Mode](#error-handling-and-offline-mode)
12. [Extensibility and Customization](#extensibility-and-customization)
13. [Security Considerations](#security-considerations)
14. [Conclusion](#conclusion)

---

### **Project Overview**

Develop a Visual Studio Code (VS Code) extension tailored for IBM Cloud architects and developers to manage and edit complex `ibm_catalog.json` files across repositories efficiently. The extension will provide a user-friendly side panel that visualizes the JSON structure in a tree format, allowing for intuitive navigation, editing, and validation of JSON data with real-time synchronization and IBM Cloud integration.

### **Key Features**

1. **Tree View Representation:**
   - Render `ibm_catalog.json` in an expandable and collapsible tree structure.
   - Maintain the state of the tree (expanded/collapsed nodes) across sessions.

2. **Editing Capabilities:**
   - Editable fields directly within the tree.
   - Support for various input types (text boxes, combo boxes with filtering, etc.).
   - Save functionality to update the JSON file upon changes.

3. **Synchronization:**
   - Real-time updates when the JSON file is modified externally.
   - Highlight corresponding JSON lines when tree nodes are selected.

4. **Adding Elements:**
   - Dialog boxes for adding new elements to lists within the JSON.
   - Dynamic form generation based on the JSON schema and additional custom fields.

5. **Validation and IBM Cloud Integration:**
   - Validate fields such as `catalog_id` using IBM Cloud SDK lookups.
   - Highlight invalid entries in red.
   - Cache lookup results to optimize performance.

6. **Schema Handling:**
   - Utilize the provided JSON schema for form generation.
   - Support adding new features not present in the schema.

7. **User Authentication:**
   - Detect IBM Cloud API key for authenticated operations.
   - Operate in a basic mode without authentication, ensuring core functionalities remain accessible.

8. **Extensibility:**
   - Modular architecture to allow future enhancements and integrations.

### **Architecture**

The extension will follow a modular architecture comprising the following components:

1. **Frontend (Tree View and UI Components):**
   - Utilize VS Code’s Tree View API to render the JSON structure.
   - Webviews or custom editors for dialog boxes and detailed views.

2. **Backend (Extension Host):**
   - Manage file operations, state persistence, and interactions with IBM Cloud SDKs.
   - Handle validation, caching, and synchronization logic.

3. **Integration Layer:**
   - Interface with IBM Cloud SDKs for data validation and lookups.
   - Manage authentication states and API interactions.

4. **State Management:**
   - Utilize VS Code’s Memento storage for persisting tree states and cached data.

### **Technologies and Tools**

- **Language:** TypeScript
- **Framework:** VS Code Extension API
- **IBM Cloud SDK:** Latest version from [IBM Cloud SDK Documentation](https://cloud.ibm.com/docs?tab=api-docs)
- **JSON Schema:** For form generation and validation
- **Caching Library:** In-memory caching or suitable caching strategy
- **Version Control:** Git
- **Testing:** Jest or Mocha for unit and integration tests

### **Implementation Plan**

#### **Phase 1: Minimum Viable Product (MVP)**

*Objective:* Develop a basic version of the extension that renders the `ibm_catalog.json` in a tree view with basic editing and saving capabilities.

1. **Setup Extension Scaffold:**
   - Initialize the VS Code extension project using `yo code`.
   - Configure necessary dependencies and project structure.

2. **Tree View Implementation:**
   - Utilize VS Code’s Tree View API to parse and display `ibm_catalog.json`.
   - Implement expandable and collapsible nodes representing the JSON hierarchy.

3. **File Watcher:**
   - Implement a file watcher to detect changes in `ibm_catalog.json`.
   - Update the tree view accordingly when external modifications occur.

4. **Editing and Saving:**
   - Allow users to edit values directly within the tree nodes.
   - Implement a Save button to write changes back to `ibm_catalog.json`.

5. **State Persistence:**
   - Save the expanded/collapsed state of tree nodes using VS Code’s Memento.
   - Restore the state upon reopening the tree view.

6. **Highlighting Corresponding JSON Lines:**
   - When a tree node is selected, highlight the corresponding line in the JSON editor.

7. **Basic Error Handling:**
   - Implement basic error handling for file read/write operations.

#### **Phase 2: Enhanced Functionality**

*Objective:* Introduce advanced features such as dynamic form generation, validation, and adding new elements.

1. **Schema Integration:**
   - Fetch and parse the JSON schema from `https://github.com/IBM/customized-deployable-architecture/blob/main/ibm_catalog-schema.json`.
   - Use the schema to generate forms for adding or editing fields.

2. **Dynamic Dialog Boxes:**
   - Implement dialog boxes for adding new elements to lists (e.g., adding a new flavor).
   - Populate form fields based on the schema, including handling fields not present in the schema.

3. **Combo Boxes and Input Types:**
   - Replace text boxes with combo boxes for fields with predefined options.
   - Implement filtering and allow custom values where applicable.

4. **Validation with IBM Cloud SDK:**
   - Integrate IBM Cloud SDK to validate fields such as `catalog_id`.
   - Mark invalid entries in red and provide tooltips or error messages.

5. **Caching Mechanism:**
   - Implement caching for lookup results to minimize redundant API calls.
   - Manage cache invalidation policies.

6. **User Authentication Handling:**
   - Detect if the user is logged into IBM Cloud using an API key.
   - Enable validation features only when authenticated; operate in basic mode otherwise.

7. **Tooltips and Additional Information:**
   - Provide tooltips for fields like `catalog_id` to display additional information (e.g., offering names).

#### **Phase 3: Advanced Features and Extensibility**

*Objective:* Enhance the extension with advanced functionalities, ensure robustness, and prepare for future extensions.

1. **Advanced Validation:**
   - Implement additional validation rules using JSONPath and custom functions.
   - Allow dynamic population of fields based on related data (e.g., adding flavors based on `catalog_id`).

2. **Extensibility Framework:**
   - Design the extension to support plugins or modules for future feature additions.
   - Provide APIs or hooks for developers to extend functionalities.

3. **Performance Optimization:**
   - Optimize tree rendering for large JSON files.
   - Enhance caching strategies for better performance.

4. **Comprehensive Error Handling:**
   - Implement detailed error handling and user notifications for various failure scenarios.
   - Ensure the extension remains stable in offline mode or when API calls fail.

5. **Testing and Quality Assurance:**
   - Develop unit tests and integration tests to ensure reliability.
   - Perform user acceptance testing (UAT) with real-world scenarios.

6. **Documentation and User Guides:**
   - Create comprehensive documentation for users, including usage guides and troubleshooting.
   - Provide inline help within the extension (e.g., tooltips, information icons).

7. **Continuous Integration and Deployment (CI/CD):**
   - Set up CI/CD pipelines for automated testing and deployment of extension updates.

### **Handling Schema and Dynamic Features**

- **Schema Parsing:**
  - Utilize the JSON schema to determine the structure, required fields, data types, and allowed values.
  - Generate dynamic forms and input controls based on schema definitions.

- **Dynamic Feature Support:**
  - Since new features like `dependencies` are not included in the schema, implement mechanisms to handle and render such fields gracefully.
  - Allow users to add new fields with custom input controls when the schema does not define them.

- **JSONPath Integration:**
  - Use JSONPath expressions to attach custom functions or validation rules to specific fields.
  - Enable dynamic population or transformation of data based on the JSON structure.

### **Validation and IBM Cloud Integration**

- **IBM Cloud SDK Integration:**
  - Utilize the latest IBM Cloud SDKs to perform lookups and validations (e.g., validating `catalog_id`).
  - Implement API calls to fetch necessary data for validation purposes.

- **Field Validation Workflow:**
  1. **User Inputs a Value:** User enters or modifies a value in the tree.
  2. **Trigger Validation:** On input change, trigger validation for the specific field.
  3. **Perform Lookup:** Use IBM Cloud SDK to validate the entered value (e.g., check if `catalog_id` exists).
  4. **Update UI:** If validation fails, highlight the field in red and display an error message or tooltip. If successful, remove any error indicators.

- **Handling Optional Fields:**
  - For optional boolean fields like `optional`, use combo boxes with `true` or `false` values.
  - Ensure that the validation logic accounts for optionality.

### **State Management and Persistence**

- **Tree State Persistence:**
  - Use VS Code’s Memento API to store the expanded/collapsed state of each tree node.
  - Serialize the state upon changes and deserialize it when the tree view is loaded.

- **Cache Persistence:**
  - Implement in-memory caching for lookup results during a session.
  - Optionally, persist cache data across sessions using Memento or a lightweight storage mechanism to reduce API calls.

### **User Experience Considerations**

- **Intuitive UI:**
  - Ensure the tree view is easy to navigate with clear labels and hierarchical representation.
  - Provide visual indicators (icons, colors) to represent different data types or validation statuses.

- **Responsive Interactions:**
  - Ensure that editing, adding, and saving operations are smooth and provide immediate feedback.

- **Accessibility:**
  - Adhere to accessibility standards to make the extension usable for all users, including those using screen readers or keyboard navigation.

- **Performance:**
  - Optimize the extension to handle large and complex JSON files without lag or delays.

### **Caching Strategy**

- **Lookup Results Caching:**
  - Implement an in-memory cache to store results from IBM Cloud SDK lookups (e.g., validated `catalog_id`s).
  - Define cache expiration policies (e.g., time-based expiration) to ensure data freshness.

- **Cache Invalidation:**
  - Provide mechanisms to invalidate or refresh cache entries manually or automatically when underlying data changes.

- **Fallback Mechanism:**
  - In case of cache misses or failures, gracefully degrade by performing fresh lookups or informing the user.

### **Error Handling and Offline Mode**

- **Graceful Degradation:**
  - When not authenticated or when API calls fail, allow the extension to operate in a basic mode without validation features.
  - Inform users of limited functionalities due to authentication or connectivity issues.

- **User Notifications:**
  - Display non-intrusive notifications or status messages to inform users of errors, validation failures, or connectivity issues.

- **Retry Mechanisms:**
  - Implement retry logic for transient API call failures to enhance reliability.

### **Extensibility and Customization**

- **Modular Design:**
  - Structure the extension into modules or components that can be independently developed or replaced.
  - Use interfaces or abstract classes to define extension points for future enhancements.

- **Plugin Support:**
  - Allow third-party developers to create plugins that extend the extension’s capabilities.
  - Provide APIs or documentation for plugin development.

- **Configuration Options:**
  - Offer user-configurable settings to customize the extension’s behavior (e.g., cache size, validation rules).

### **Security Considerations**

- **API Key Management:**
  - Securely handle and store IBM Cloud API keys, ensuring they are not exposed or logged.
  - Use VS Code’s secure storage APIs to manage sensitive information.

- **Data Validation:**
  - Sanitize and validate all user inputs to prevent injection attacks or malformed data entries.

- **Permission Management:**
  - Request only the necessary permissions required for the extension to function, adhering to the principle of least privilege.

### **Conclusion**

This design and implementation plan outlines a comprehensive approach to developing a robust and user-friendly VS Code extension for managing `ibm_catalog.json` files within IBM Cloud environments. By following an incremental development strategy, starting with essential functionalities and progressively adding advanced features, the extension will cater to both immediate needs and future scalability. Emphasis on user experience, performance, security, and extensibility ensures that the extension will be a valuable tool for IBM Cloud architects and developers.
