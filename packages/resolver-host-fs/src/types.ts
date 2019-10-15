interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FsInterface {
  readdir(path: string, callback: (err: Error | null, files: string[]) => void): void;
  readFile(path: string, callback: (err: Error, data: ArrayBuffer) => void): void;
  realpath(path: string, callback: (err: Error, resolvedPath: string) => void): void;
  stat(path: string, callback: (err: Error, stats: Stats) => void): void;
}
