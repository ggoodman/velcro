export interface IProject {
  id: string;
  name: string;
  files: Record<string, string>;
  initialPath: string;
}
