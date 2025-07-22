// Jest type definitions for TypeScript language server
// This file ensures VS Code TypeScript language server recognizes Jest globals

import 'jest';

declare global {
  var jest: typeof import('jest');
  var describe: jest.Describe;
  var it: jest.It;
  var test: jest.It;
  var expect: jest.Expect;
  var beforeAll: jest.Lifecycle;
  var beforeEach: jest.Lifecycle;
  var afterAll: jest.Lifecycle;
  var afterEach: jest.Lifecycle;
  var fail: jest.Fail;
  var pending: jest.Pending;
  var spyOn: jest.SpyOn;
  var xdescribe: jest.Describe;
  var xit: jest.It;
  var xtest: jest.It;
  var fdescribe: jest.Describe;
  var fit: jest.It;
  var ftest: jest.It;
}