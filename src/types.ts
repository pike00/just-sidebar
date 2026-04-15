import * as vscode from 'vscode';

export interface Parameter {
  name: string;
  default?: string;
  variadic: boolean;
}

export interface Recipe {
  name: string;
  parameters: Parameter[];
  doc?: string;
  isDefault: boolean;
  group?: string;
}

export interface JustfileLocation {
  uri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  relativePath: string;
}
