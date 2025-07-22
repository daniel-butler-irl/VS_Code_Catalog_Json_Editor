// Simple test to verify Jest configuration is working
/// <reference types="jest" />
/// <reference path="./jest.d.ts" />
describe('Jest Configuration', () => {
  it('should have Jest globals available', () => {
    expect(jest).toBeDefined();
    expect(describe).toBeDefined();
    expect(it).toBeDefined();
    expect(expect).toBeDefined();
  });

  it('should have access to vscode mocks', () => {
    const vscode = require('vscode');
    expect(vscode).toBeDefined();
    expect(vscode.window).toBeDefined();
    expect(vscode.workspace).toBeDefined();
    expect(vscode.commands).toBeDefined();
  });

  it('should be able to create and use mock functions', () => {
    const mockFn = jest.fn();
    mockFn('test');
    expect(mockFn).toHaveBeenCalledWith('test');
  });
});