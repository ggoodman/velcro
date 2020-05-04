export type Dirent = {
  isFile(): boolean;
  isDirectory(): boolean;
  name: string;
};

import('fs');

export interface FsInterface {
  promises: {
    readdir(path: string, options: { encoding: 'utf-8'; withFileTypes: true }): Promise<Dirent[]>;
    readFile(path: string): Promise<ArrayBuffer>;
    realpath(path: string): Promise<string>;
  };
}
